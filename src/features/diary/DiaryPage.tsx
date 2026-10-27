import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, BookOpen, CalendarDays, Check, Feather, LoaderCircle, Search, Sparkles } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { ApiRequestError } from '../../lib/api.js';
import { useToast } from '../../components/ToastContext';
import { clearDiaryDraft, getDiaryDraft, putDiaryDraft, reconcileDiaryDraft } from '../../lib/diaryDrafts.js';
import { createAutosaver, type SaveState } from './autosave.js';
import { formatDate, localDate, shiftDate } from './dates.js';
import { useAppDialogs } from '../../components/AppDialogsContext';

type Entry = { _id: string; dateKey: string; content: string; updatedAt: string };
type Archive = { items: Entry[]; page: number; limit: number; total: number; hasMore: boolean };

const stateLabels: Record<SaveState, string> = { saved: 'Saved', saving: 'Saving…', unsaved: 'Unsaved changes', error: 'Offline · draft kept here' };

export function DiaryPage({ userId }: { userId: string }) {
  const { showToast } = useToast();
  const dialogs = useAppDialogs();
  const navigate = useNavigate();
  const client = useQueryClient();
  const [date, setDate] = useState(localDate());
  const [content, setContent] = useState('');
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [initializedDate, setInitializedDate] = useState('');
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [archivePage, setArchivePage] = useState(1);
  const [suggestion, setSuggestion] = useState<{ original: string; corrected: string } | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const setNotice = useCallback((message: string, kind: 'success' | 'error' | 'info' = 'info') => { if (message) showToast(message, kind); }, [showToast]);
  const [revisionConflict, setRevisionConflict] = useState<{ local: string; server: string; updatedAt: string | null } | null>(null);
  const saveStateRef = useRef(saveState);
  const dateRef = useRef(date);
  const contentRef = useRef(content);
  const baseUpdatedAtRef = useRef<string | null>(null);
  const baseContentRef = useRef('');
  dateRef.current = date;
  contentRef.current = content;
  const setState = useCallback((state: SaveState) => { saveStateRef.current = state; setSaveState(state); }, []);
  const currentSaveState = () => saveStateRef.current;
  const entryQuery = useQuery({ queryKey: ['diary', date], queryFn: async () => (await api<{ entry: Entry | null }>(`/diary/${date}`)).data.entry });
  const archiveQuery = useQuery({ queryKey: ['diary-archive', search, archivePage], queryFn: async () => (await api<Archive>(`/diary?search=${encodeURIComponent(search)}&page=${archivePage}&limit=30`)).data });
  const refetchEntry = entryQuery.refetch;

  const autosaver = useMemo(() => createAutosaver(async (text) => {
    try {
      const result = await api<{ entry: Entry }>(`/diary/${date}`, { method: 'PUT', body: JSON.stringify({ content: text, expectedUpdatedAt: baseUpdatedAtRef.current }) });
      baseUpdatedAtRef.current = result.data.entry.updatedAt;
      baseContentRef.current = result.data.entry.content;
      setRevisionConflict(null);
      if (contentRef.current === text) await clearDiaryDraft(userId, date);
      client.setQueryData(['diary', date], result.data.entry);
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 409) {
        const latest = await api<{ entry: Entry | null }>(`/diary/${date}`);
        setRevisionConflict({ local: text, server: latest.data.entry?.content ?? '', updatedAt: latest.data.entry?.updatedAt ?? null });
        setNotice('The server has a newer version. Your local draft is safe; choose which version to keep.');
      }
      throw error;
    }
  }, setState), [client, date, setNotice, setState, userId]);
  useEffect(() => () => autosaver.cancel(), [autosaver]);

  useEffect(() => {
    if (entryQuery.isPending || (entryQuery.isError && navigator.onLine) || initializedDate === date || (entryQuery.data === undefined && navigator.onLine)) return;
    let active = true;
    void getDiaryDraft(userId, date).then((draft) => {
      if (!active || dateRef.current !== date) return;
      const serverText = entryQuery.data?.content ?? '';
      const reconciliation = reconcileDiaryDraft(draft, entryQuery.data ?? null);
      const recovered = reconciliation.content;
      baseUpdatedAtRef.current = entryQuery.data?.updatedAt ?? null;
      baseContentRef.current = serverText;
      setContent(recovered);
      contentRef.current = recovered;
      setInitializedDate(date);
      if (reconciliation.kind === 'draft') {
        setState('unsaved');
        if (navigator.onLine) autosaver.schedule(recovered);
        else setNotice('Working offline. This entry will stay as a local draft until the server is available.');
      } else if (reconciliation.kind === 'conflict') {
        setState('unsaved');
        setRevisionConflict({ local: reconciliation.local, server: reconciliation.server, updatedAt: reconciliation.updatedAt });
      } else setState('saved');
    });
    return () => { active = false; };
  }, [entryQuery.data, entryQuery.isError, entryQuery.isPending, initializedDate, date, autosaver, setNotice, setState, userId]);

  useEffect(() => {
    const onOnline = () => { if (navigator.onLine) void refetchEntry().then(() => setInitializedDate('')); };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [refetchEntry]);

  useEffect(() => {
    const onInternalNavigation = (event: MouseEvent) => {
      if (saveStateRef.current === 'saved' || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest('a[href]');
      if (!(anchor instanceof HTMLAnchorElement) || anchor.origin !== window.location.origin || anchor.pathname === window.location.pathname) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      void dialogs.confirm('Leave this diary page?', 'Your changes may still be saving. A local draft is kept on this device.', { confirmText: 'Leave page' }).then((confirmed) => {
        if (confirmed) navigate(`${anchor.pathname}${anchor.search}${anchor.hash}`);
      });
    };
    document.addEventListener('click', onInternalNavigation, true);
    return () => document.removeEventListener('click', onInternalNavigation, true);
  }, [dialogs, navigate]);

  async function navigateTo(nextDate: string) {
    if (nextDate === date) return;
    if (currentSaveState() !== 'saved') {
      await autosaver.flush();
      if (currentSaveState() !== 'saved' && !await dialogs.confirm('Leave this date?', 'This entry is not on the server yet, but its draft is saved in this browser.', { confirmText: 'Leave date' })) return;
    }
    autosaver.cancel();
    setSuggestion(null);
    setNotice('');
    setInitializedDate('');
    setDate(nextDate);
  }

  async function handleChange(value: string) {
    contentRef.current = value;
    setContent(value);
    setNotice('');
    setSuggestion(null);
    setState('unsaved');
    await putDiaryDraft({ userId, date, content: value, savedAt: Date.now(), baseUpdatedAt: baseUpdatedAtRef.current, baseContent: baseContentRef.current });
    autosaver.schedule(value);
  }

  async function improveGrammar() {
    if (!content.trim()) return;
    setAiBusy(true);
    setNotice('');
    try {
      await autosaver.flush();
      const result = await api<{ correctedText: string }>('/diary/improve-grammar', { method: 'POST', body: JSON.stringify({ text: content }) });
      setSuggestion({ original: content, corrected: result.data.correctedText });
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Could not request a suggestion. Your writing is unchanged.', 'error'); }
    finally { setAiBusy(false); }
  }

  async function applySuggestion() {
    if (!suggestion) return;
    try {
      const result = await api<{ entry: Entry }>(`/diary/${date}/apply-correction`, { method: 'POST', body: JSON.stringify({ expectedOriginal: suggestion.original, correctedText: suggestion.corrected }) });
      setContent(suggestion.corrected);
      contentRef.current = suggestion.corrected;
      baseUpdatedAtRef.current = result.data.entry.updatedAt;
      baseContentRef.current = result.data.entry.content;
      setSuggestion(null);
      setState('saved');
      await clearDiaryDraft(userId, date);
      client.setQueryData(['diary', date], result.data.entry);
      setNotice('Correction applied and saved.', 'success');
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Could not apply the correction. Your original is unchanged.', 'error'); }
  }

  async function keepServerVersion() {
    if (!revisionConflict) return;
    contentRef.current = revisionConflict.server;
    setContent(revisionConflict.server);
    baseUpdatedAtRef.current = revisionConflict.updatedAt;
    baseContentRef.current = revisionConflict.server;
    await clearDiaryDraft(userId, date);
    void client.invalidateQueries({ queryKey: ['diary', date] });
    setRevisionConflict(null);
    setState('saved');
    setNotice('Server version restored.', 'success');
  }

  async function keepLocalVersion() {
    if (!revisionConflict) return;
    baseUpdatedAtRef.current = revisionConflict.updatedAt;
    baseContentRef.current = revisionConflict.server;
    await putDiaryDraft({ userId, date, content: revisionConflict.local, savedAt: Date.now(), baseUpdatedAt: revisionConflict.updatedAt, baseContent: revisionConflict.server });
    setContent(revisionConflict.local);
    contentRef.current = revisionConflict.local;
    setRevisionConflict(null);
    setState('unsaved');
    if (navigator.onLine) autosaver.schedule(revisionConflict.local);
    else setNotice('Your choice is saved locally. It will be sent when you reconnect.');
  }

  const today = date === localDate();
  const heading = formatDate(date, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  return <main className="diary-shell mx-auto max-w-[1420px] px-3 py-6 sm:px-7 sm:py-9">
    <div className="mb-5 flex flex-wrap items-end justify-between gap-4 px-1">
      <div><div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-[.22em] text-[#867b68]"><BookOpen size={14} /> My diary</div><h1 className="font-serif text-3xl text-[#342d25] sm:text-[2.45rem]">A place to keep the day.</h1><p className="mt-1 text-sm text-[#82796e]">One page at a time, just for you.</p></div>
      <button className="diary-mobile-archive rounded-full border border-[#d5c8ac] bg-[#fffaf0] px-4 py-2 text-sm text-[#554a3b] md:hidden" onClick={() => setArchiveOpen(!archiveOpen)}><span className="inline-flex items-center gap-2"><BookOpen size={15} />{archiveOpen ? 'Close archive' : 'Browse archive'}</span></button>
    </div>
    <div className="diary-book">
      <aside className={`diary-archive ${archiveOpen ? 'diary-archive-open' : ''}`}>
        <div className="mb-5 flex items-center justify-between"><div><p className="text-[11px] font-semibold uppercase tracking-[.2em] text-[#8c806c]">The archive</p><h2 className="mt-1 font-serif text-2xl text-[#3c342a]">Past pages</h2></div><BookOpen className="text-[#a3957c]" size={19} /></div>
        <label className="relative block"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[#958a79]" size={15} /><input className="diary-search w-full rounded-lg border border-[#ddd2bc] bg-[#fffdf7] py-2.5 pl-9 pr-3 text-sm outline-none focus:border-[#a5916d]" value={search} onChange={(event) => { setSearch(event.target.value); setArchivePage(1); }} placeholder="Search your entries" aria-label="Search diary entries" /></label>
        <label className="mt-3 flex items-center gap-2 rounded-lg border border-[#ddd2bc] bg-[#fffdf7] px-3 py-2 text-xs text-[#776c5a]"><CalendarDays size={15} /><span>Jump to date</span><input type="date" className="ml-auto min-w-0 bg-transparent text-sm text-[#433b30] outline-none" value={date} onChange={(event) => { if (event.target.value) void navigateTo(event.target.value); }} /></label>
        <div className="mt-5 flex items-center justify-between text-[11px] font-semibold uppercase tracking-[.16em] text-[#978c79]"><span>Pages written</span><span>{archiveQuery.data?.total ?? '—'}</span></div>
        <div className="diary-archive-list mt-2">
          {archiveQuery.isPending ? <div className="px-3 py-5 text-sm text-[#8c806c]">Opening archive…</div> : archiveQuery.isError ? <div className="px-3 py-5 text-sm text-[#8c554a]">Could not load the archive. Try again.</div> : archiveQuery.data.items.length === 0 ? <div className="rounded-xl border border-dashed border-[#d9ceb9] px-4 py-6 text-center"><Feather className="mx-auto mb-2 text-[#ad9f84]" size={18} /><p className="font-serif text-lg text-[#5b5040]">{search ? 'No pages found' : 'Your story starts here'}</p><p className="mt-1 text-xs leading-relaxed text-[#8e8372]">{search ? 'Try a different word.' : 'Write a few lines and this page will join your archive.'}</p></div> : archiveQuery.data.items.map((entry) => <button key={entry._id} onClick={() => { void navigateTo(entry.dateKey); setArchiveOpen(false); }} className={`diary-archive-entry w-full rounded-lg px-3 py-3 text-left transition hover:bg-[#f3ead8] ${date === entry.dateKey ? 'bg-[#f0e6d2]' : ''}`}><span className="block text-sm font-semibold text-[#4b4031]">{formatDate(entry.dateKey, { month: 'short', day: 'numeric', year: 'numeric' })}</span><span className="mt-1 block line-clamp-2 font-serif text-[13px] leading-5 text-[#877b68]">{entry.content || 'A quiet, blank page'}</span></button>)}
        </div>
        {archiveQuery.data && (archivePage > 1 || archiveQuery.data.hasMore) && <div className="flex items-center justify-between border-t border-[#dfd3bc] py-3 text-xs text-[#786b56]"><button disabled={archivePage <= 1} onClick={() => setArchivePage((page) => Math.max(1, page - 1))} className="disabled:opacity-40">← Recent</button><span>Page {archivePage}</span><button disabled={!archiveQuery.data.hasMore} onClick={() => setArchivePage((page) => page + 1)} className="disabled:opacity-40">Older →</button></div>}
        <div className="mt-auto border-t border-[#dfd3bc] pt-4 text-xs text-[#918571]">Private pages · only visible to you</div>
      </aside>
      <div className="diary-spine" aria-hidden="true"><div /></div>
      <section className="diary-paper" aria-label="Diary page">
        <div className="diary-paper-grain" aria-hidden="true" />
        <div className="diary-page-header"><div className="flex items-center gap-2"><span className="diary-date-kicker">{today ? 'TODAY' : 'A PAGE FROM'}</span><span className={`diary-save-state diary-state-${saveState}`}><span className="diary-state-dot" />{saveState === 'saving' ? <LoaderCircle size={12} className="animate-spin" /> : saveState === 'saved' ? <Check size={12} /> : null}{stateLabels[saveState]}</span></div><div className="mt-1 flex items-center justify-between gap-3"><h2 className="diary-date-heading font-serif">{heading}</h2><div className="flex shrink-0 items-center gap-1"><button aria-label="Previous date" className="diary-icon-button" onClick={() => void navigateTo(shiftDate(date, -1))}><ArrowLeft size={16} /></button><button aria-label="Next date" className="diary-icon-button" onClick={() => void navigateTo(shiftDate(date, 1))}><ArrowRight size={16} /></button></div></div></div>
        {entryQuery.isError && navigator.onLine ? <div className="diary-load-error"><p>Could not open this page. Your other pages are safe.</p><button onClick={() => void entryQuery.refetch()}>Try again</button></div> : entryQuery.isPending || initializedDate !== date ? <div className="diary-loading"><LoaderCircle className="animate-spin" size={20} /><span>Opening your page…</span></div> : <>
          {revisionConflict && <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950"><p className="font-semibold">This page changed on the server.</p><p className="mt-1">Your local writing and the current server version are both preserved. Choose which one to keep.</p><div className="mt-3 grid gap-3 sm:grid-cols-2"><div className="max-h-24 overflow-auto rounded-lg bg-white/70 p-2 text-xs"><strong>Local draft</strong><p className="mt-1 whitespace-pre-wrap">{revisionConflict.local.slice(0, 400)}</p></div><div className="max-h-24 overflow-auto rounded-lg bg-white/70 p-2 text-xs"><strong>Server version</strong><p className="mt-1 whitespace-pre-wrap">{revisionConflict.server.slice(0, 400) || '(empty)'}</p></div></div><div className="mt-3 flex flex-wrap gap-2"><button className="diary-cancel-button" onClick={() => void keepServerVersion()}>Use server version</button><button className="diary-apply-button" onClick={() => void keepLocalVersion()}>Keep my draft</button></div></div>}
          <div className="diary-editor-wrap"><textarea className="diary-writing" value={content} readOnly={Boolean(revisionConflict)} onChange={(event) => void handleChange(event.target.value)} maxLength={20000} aria-label={`Diary entry for ${heading}`} placeholder="Dear diary,\n\nWhat would you like to remember about today?" spellCheck /></div>
          <div className="diary-footer"><button onClick={() => void improveGrammar()} disabled={!navigator.onLine || !content.trim() || aiBusy || saveState === 'saving'} className="diary-improve-button"><Sparkles size={15} />{!navigator.onLine ? 'Grammar help needs internet' : aiBusy ? 'Considering your words…' : 'Improve grammar'}</button></div>
        </>}
      </section>
    </div>
    {suggestion && <div className="diary-modal-backdrop" role="presentation"><section className="diary-modal" role="dialog" aria-modal="true" aria-labelledby="correction-title"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[.18em] text-[#8f7953]">A gentle edit</p><h2 id="correction-title" className="mt-1 font-serif text-2xl text-[#3d342a]">Review the suggestion</h2><p className="mt-1 text-sm text-[#807565]">Your original stays safe until you apply this version.</p></div><button className="diary-icon-button" aria-label="Cancel suggestion" onClick={() => setSuggestion(null)}>×</button></div><div className="diary-comparison mt-5"><article><h3>Original</h3><pre>{suggestion.original}</pre></article><article><h3>Suggested</h3><pre>{suggestion.corrected}</pre></article></div><div className="mt-5 flex flex-wrap justify-end gap-2"><button className="diary-cancel-button" onClick={() => setSuggestion(null)}>Cancel</button><button className="diary-apply-button" onClick={() => void applySuggestion()}><Check size={15} />Apply correction</button></div></section></div>}
  </main>;
}
