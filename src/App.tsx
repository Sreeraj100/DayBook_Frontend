import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, CalendarDays, CheckCheck, Download, ListTodo, LoaderCircle, LogOut, Moon, RefreshCw, Sun, Umbrella, Wallet, Wifi, WifiOff, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { NavLink, Route, Routes } from 'react-router-dom';
import { AuthScreen } from './features/auth/AuthScreen';
import { TodoPage } from './features/todos/TodoPage';
import { DiaryPage } from './features/diary/DiaryPage';
import { FinancePage } from './features/finance/FinancePage';
import { CalendarPage } from './features/calendar/CalendarPage';
import { LeavesPage } from './features/leaves/LeavesPage';
import { api, type User } from './lib/api';
import { clearUserOfflineData, getOfflineIdentity, hasPendingLogout, rememberIdentity, retryFailedTodoOperations, setPendingLogout, syncTodoQueue } from './lib/offline';
import { listTodoOperations } from './lib/diaryDrafts';

export default function App() {
  const queryClient = useQueryClient();
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try { return localStorage.getItem('daybook-theme') === 'dark' ? 'dark' : 'light'; } catch { return 'light'; }
  });
  const [authNotice, setAuthNotice] = useState('');
  const [online, setOnline] = useState(navigator.onLine);
  const [queued, setQueued] = useState<{ pending: number; failed: number; conflict: number } | null>(null);
  const loggingOut = useRef(false);
  const auth = useQuery({ queryKey: ['auth', 'me'], queryFn: async () => {
    if (hasPendingLogout() && navigator.onLine) {
      try { await api('/auth/logout', { method: 'POST' }); setPendingLogout(false); } catch { /* Keep the device signed out until the server session can be revoked. */ }
      return null;
    }
    if (hasPendingLogout() && !navigator.onLine) return null;
    try { return (await api<{ user: User | null }>('/auth/me')).data.user; }
    catch (error) { if (!navigator.onLine) return getOfflineIdentity(); throw error; }
  }, retry: false });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    try { localStorage.setItem('daybook-theme', theme); } catch { /* Theme remains active for this session. */ }
  }, [theme]);

  useEffect(() => {
    const update = () => { setOnline(navigator.onLine); if (navigator.onLine && hasPendingLogout()) void queryClient.invalidateQueries({ queryKey: ['auth', 'me'] }); };
    window.addEventListener('online', update); window.addEventListener('offline', update); window.addEventListener('focus', update);
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); window.removeEventListener('focus', update); };
  }, [queryClient]);
  useEffect(() => {
    if (auth.data) { rememberIdentity(auth.data); loggingOut.current = false; }
    if (auth.data) setPendingLogout(false);
  }, [auth.data]);
  useEffect(() => {
    const refreshQueue = async () => {
      if (loggingOut.current) return;
      const user = auth.data ?? getOfflineIdentity();
      if (!user) { setQueued(null); return; }
      if (online) await syncTodoQueue(user.id).catch(() => undefined);
      const operations = await listTodoOperations(user.id).catch(() => []);
      setQueued({ pending: operations.filter((item) => item.state === 'pending').length, failed: operations.filter((item) => item.state === 'failed').length, conflict: operations.filter((item) => item.state === 'conflict').length });
      if (online) await queryClient.invalidateQueries({ queryKey: ['todos'] });
    };
    void refreshQueue();
    window.addEventListener('online', refreshQueue);
    window.addEventListener('daybook-queue-updated', refreshQueue);
    return () => { window.removeEventListener('online', refreshQueue); window.removeEventListener('daybook-queue-updated', refreshQueue); };
  }, [auth.data, online, queryClient]);

  if (auth.isPending) return <div className="grid min-h-screen place-items-center bg-[#f6f7f4]"><LoaderCircle className="animate-spin text-teal-700" /></div>;
  if (auth.isError && !getOfflineIdentity()) return <div className="grid min-h-screen place-items-center bg-[#f6f7f4] p-6 text-center text-slate-600"><div><div className="mx-auto grid size-12 place-items-center rounded-full bg-amber-100 text-amber-800"><WifiOff size={20} /></div><h1 className="mt-4 text-xl font-semibold text-slate-900">{online ? 'Daybook could not connect' : 'You’re offline'}</h1><p className="mx-auto mt-2 max-w-md text-sm">{online ? 'Check that the API is running and try again.' : 'This device has no saved sign-in identity yet. Reconnect to sign in. Diary drafts and queued task actions saved on this device will remain available after you sign in again.'}</p><button className="mt-4 rounded-xl bg-[#163c36] px-4 py-2 text-sm text-white" onClick={() => window.location.reload()}>Try again</button><a className="ml-4 text-sm font-medium text-teal-800 underline" href="/offline.html">Offline help</a></div></div>;
  const user = auth.data ?? (!online ? getOfflineIdentity() : null);
  return <Routes><Route path="*" element={user ? <div className="app-root min-h-screen bg-[#f6f7f4]"><Header theme={theme} onToggleTheme={() => setTheme((current) => current === 'light' ? 'dark' : 'light')} email={user.email} offline={!online} queued={queued} onRetry={() => { if (!loggingOut.current) void retryFailedTodoOperations(user.id).then(() => queryClient.invalidateQueries({ queryKey: ['todos'] })).catch(() => undefined); }} onLogout={async () => {
      loggingOut.current = true;
      await clearUserOfflineData(user.id);
      setPendingLogout(true);
      queryClient.clear();
      queryClient.setQueryData(['auth', 'me'], null);
      if (navigator.onLine) { try { await api('/auth/logout', { method: 'POST' }); setPendingLogout(false); } catch { setAuthNotice('Signed out on this device. The server session will be revoked when you reconnect.'); } }
    }} /><Routes><Route path="/diary" element={<DiaryPage userId={user.id} />} /><Route path="/finance" element={<FinancePage />} /><Route path="/calendar" element={<CalendarPage />} /><Route path="/leaves" element={<LeavesPage />} /><Route path="*" element={<TodoPage userId={user.id} />} /></Routes></div> : <div className="app-root min-h-screen"><Header theme={theme} onToggleTheme={() => setTheme((current) => current === 'light' ? 'dark' : 'light')} email="" offline={!online} queued={null} onRetry={() => undefined} onLogout={() => undefined} /><AuthScreen onAuthenticated={() => { loggingOut.current = false; setPendingLogout(false); return queryClient.invalidateQueries({ queryKey: ['auth', 'me'] }); }} notice={authNotice} setNotice={setAuthNotice} /></div>} /></Routes>;
}

function Header({ email, offline, queued, onRetry, onLogout, theme, onToggleTheme }: { email: string; offline: boolean; queued: { pending: number; failed: number; conflict: number } | null; onRetry: () => void; onLogout: () => void; theme: 'light' | 'dark'; onToggleTheme: () => void }) {
  const [installEvent, setInstallEvent] = useState<{ prompt: () => Promise<void>; userChoice?: Promise<{ outcome: string }> } | null>(null);
  const [installHelp, setInstallHelp] = useState(false);
  useEffect(() => {
    const listener = (event: Event) => { event.preventDefault(); setInstallEvent(event as Event & { prompt: () => Promise<void>; userChoice?: Promise<{ outcome: string }> }); };
    window.addEventListener('beforeinstallprompt', listener);
    return () => window.removeEventListener('beforeinstallprompt', listener);
  }, []);
  async function install() { if (!installEvent) { setInstallHelp(true); return; } await installEvent.prompt(); await installEvent.userChoice; setInstallEvent(null); }
  return <header className="app-header sticky top-0 z-20 border-b border-[#e8ebe5] bg-[#fbfcfa]/95 backdrop-blur"><div className="app-header-inner mx-auto max-w-[1440px] px-4 sm:px-8">
    <a className="app-brand flex items-center gap-3" href="/" aria-label="Daybook home"><span className="grid size-9 place-items-center rounded-xl bg-[#163c36] text-white"><CheckCheck size={18} /></span><span className="font-semibold tracking-tight text-slate-900">daybook<span className="text-teal-700">.</span></span></a>
    {email && <nav className="app-primary-nav" aria-label="Main navigation">
      <NavLink end to="/" className={({ isActive }) => `app-nav-link ${isActive ? 'is-active' : ''}`}><ListTodo size={16} aria-hidden="true" /><span>Tasks</span></NavLink>
      <NavLink to="/calendar" className={({ isActive }) => `app-nav-link ${isActive ? 'is-active' : ''}`}><CalendarDays size={16} aria-hidden="true" /><span>Calendar</span></NavLink>
      <NavLink to="/leaves" className={({ isActive }) => `app-nav-link ${isActive ? 'is-active' : ''}`}><Umbrella size={16} aria-hidden="true" /><span>Leaves</span></NavLink>
      <NavLink to="/diary" className={({ isActive }) => `app-nav-link ${isActive ? 'is-active' : ''}`}><BookOpen size={16} aria-hidden="true" /><span>Diary</span></NavLink>
      <NavLink to="/finance" className={({ isActive }) => `app-nav-link ${isActive ? 'is-active' : ''}`}><Wallet size={16} aria-hidden="true" /><span>Money</span></NavLink>
    </nav>}
    <div className="app-header-actions">{email && <><span className="app-user-email">{email}</span><button className="app-header-icon" title="Sign out" aria-label="Sign out" onClick={onLogout}><LogOut size={16} /></button></>}<button onClick={onToggleTheme} className="app-header-icon" title={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`} aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}>{theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}</button><button onClick={() => void install()} className="app-header-icon" title="Install Daybook" aria-label="Install Daybook"><Download size={16} /></button></div>
  </div>{email && <div className={`app-connectivity flex min-h-8 items-center justify-between gap-2 px-4 py-1 text-xs sm:px-8 ${offline ? 'bg-amber-50 text-amber-900' : 'bg-[#edf5ef] text-[#315b4a]'}`}><span className="inline-flex items-center gap-1.5">{offline ? <WifiOff size={13} /> : <Wifi size={13} />}{offline ? 'Offline · diary drafts and quick-add/complete task actions wait here. Other data needs internet.' : 'Online · changes can sync with Daybook.'}</span>{queued && (queued.pending + queued.failed + queued.conflict > 0) && <button onClick={onRetry} disabled={offline} className="inline-flex items-center gap-1.5 font-medium disabled:opacity-50"><RefreshCw size={12} />{queued.pending} pending{queued.failed ? ` · ${queued.failed} failed` : ''}{queued.conflict ? ` · ${queued.conflict} conflict` : ''} · Retry</button>}</div>}{installHelp && <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setInstallHelp(false); }}><section className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl" role="dialog" aria-modal="true" aria-labelledby="install-title"><div className="flex items-start justify-between"><div><h2 id="install-title" className="text-xl font-semibold text-slate-900">Install Daybook</h2><p className="mt-2 text-sm text-slate-600">Installation options depend on your browser.</p></div><button onClick={() => setInstallHelp(false)} aria-label="Close" className="rounded-lg p-1 text-slate-500"><X size={18} /></button></div><ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-slate-600"><li>Chrome or Edge: use the install icon in the address bar or this button.</li><li>iPhone/iPad Safari: Share, then Add to Home Screen.</li><li>Other browsers may offer a different install menu or no install support.</li></ul><p className="mt-4 rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-900">Offline mode is limited: server data, finance, calendar, leaves, sign-in, and AI grammar requests need internet. Only diary drafts and quick-add/complete task actions can wait on this device.</p><button onClick={() => setInstallHelp(false)} className="mt-4 rounded-xl bg-[#163c36] px-4 py-2 text-sm text-white">Got it</button></section></div>}</header>;
}
