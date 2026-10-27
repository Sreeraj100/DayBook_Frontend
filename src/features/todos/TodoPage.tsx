import { zodResolver } from '@hookform/resolvers/zod';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, ArrowDownWideNarrow, ArrowRight, CalendarClock, CalendarDays, Check, CheckCircle2, ChevronDown, Clock3, Flag, Inbox, ListChecks, ListTodo, LoaderCircle, Pencil, Plus, Repeat2, Search, Sparkles, Trash2, X } from 'lucide-react';
import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useForm, type Resolver } from 'react-hook-form';
import { z } from 'zod';
import { api, type Recurrence, type Subtask, type Todo, type TodoPageData, type TodoPriority } from '../../lib/api';
import { enqueueTodoOperation, listTodoOperations, removeTodoOperation, type TodoOperation } from '../../lib/diaryDrafts';
import { useAppDialogs } from '../../components/AppDialogsContext';
import { useToast } from '../../components/ToastContext';

type Filter = 'today' | 'upcoming' | 'all' | 'completed' | 'overdue';
type TodoPayload = { title: string; description?: string; priority?: TodoPriority; status?: Todo['status']; dueAt?: string | null; dueTimeSet?: boolean; label?: string; subtasks?: Subtask[]; recurrence?: Recurrence | null };
type TodoUpdatePayload = Partial<TodoPayload>;
const filters: { id: Filter; label: string; icon: typeof CalendarDays }[] = [
  { id: 'today', label: 'Today', icon: CalendarDays }, { id: 'upcoming', label: 'Upcoming', icon: CalendarClock },
  { id: 'all', label: 'All tasks', icon: ListTodo }, { id: 'completed', label: 'Completed', icon: CheckCircle2 }, { id: 'overdue', label: 'Overdue', icon: AlertCircle }
];
const priorityStyle: Record<TodoPriority, string> = {
  low: 'bg-slate-100 text-slate-600', medium: 'bg-amber-50 text-amber-700', high: 'bg-rose-50 text-rose-700'
};
const priorityCardStyle: Record<TodoPriority, string> = {
  low: 'border-slate-200/80 bg-white/65 shadow-[0_5px_18px_-14px_rgba(30,41,59,.35)] hover:bg-white/85',
  medium: 'border-amber-200/80 bg-gradient-to-r from-amber-50/85 to-white/65 shadow-[0_5px_18px_-14px_rgba(146,64,14,.3)] hover:from-amber-50 hover:to-white/85',
  high: 'border-rose-200/80 bg-gradient-to-r from-rose-50/85 to-white/65 shadow-[0_5px_18px_-14px_rgba(159,18,57,.3)] hover:from-rose-50 hover:to-white/85'
};
const priorityLabel: Record<TodoPriority, string> = { low: 'Low', medium: 'Medium', high: 'High' };
const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const editorSchema = z.object({
  title: z.string().trim().min(1, 'Give this task a name.').max(160),
  description: z.string().max(3000),
  priority: z.enum(['low', 'medium', 'high']),
  status: z.enum(['pending', 'in_progress', 'completed']),
  dueDate: z.string(), dueTime: z.string(), label: z.string().max(48),
  subtasksText: z.string(), frequency: z.enum(['', 'daily', 'weekly', 'monthly']), interval: z.coerce.number().int().min(1).max(365),
  daysOfWeek: z.array(z.number().int().min(0).max(6)), dayOfMonth: z.coerce.number().int().min(1).max(31), endDate: z.string()
}).superRefine((data, context) => {
  if (data.frequency && !data.dueDate) context.addIssue({ code: 'custom', path: ['dueDate'], message: 'Add a due date to set a repeat schedule.' });
  if (data.dueTime && !data.dueDate) context.addIssue({ code: 'custom', path: ['dueDate'], message: 'Add a due date before setting a time.' });
  if (data.frequency === 'weekly' && data.daysOfWeek.length === 0) context.addIssue({ code: 'custom', path: ['daysOfWeek'], message: 'Choose at least one day.' });
  if (data.endDate && data.dueDate && data.endDate < data.dueDate) context.addIssue({ code: 'custom', path: ['endDate'], message: 'Repeat end date must follow the first due date.' });
  if (data.subtasksText.split('\n').filter((line) => line.trim()).length > 30) context.addIssue({ code: 'custom', path: ['subtasksText'], message: 'Use up to 30 subtasks.' });
});
type EditorValues = z.infer<typeof editorSchema>;

function startOfLocalDay(date: Date) { return new Date(date.getFullYear(), date.getMonth(), date.getDate()); }
function localDateTime(date: Date) {
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 16);
}
function dueRange(filter: Filter): { from?: string; to?: string } {
  if (filter !== 'today' && filter !== 'upcoming' && filter !== 'overdue') return {};
  const now = new Date();
  const today = startOfLocalDay(now);
  if (filter === 'overdue') return { from: today.toISOString() };
  const from = filter === 'today' ? today : new Date(today.getTime() + 86400000);
  const to = filter === 'today' ? new Date(today.getTime() + 86400000) : undefined;
  return { from: from.toISOString(), ...(to ? { to: to.toISOString() } : {}) };
}
function formatDue(value?: string, dueTimeSet = false) {
  if (!value) return null;
  const date = new Date(value);
  const isToday = startOfLocalDay(date).getTime() === startOfLocalDay(new Date()).getTime();
  const dateLabel = isToday ? 'Today' : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
  const hasTime = dueTimeSet;
  return `${dateLabel}${hasTime ? ` · ${new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date)}` : ''}`;
}
function isOverdue(todo: Todo) {
  if (todo.status === 'completed' || !todo.dueAt) return false;
  const dueAt = new Date(todo.dueAt);
  return todo.dueTimeSet ? dueAt.getTime() < Date.now() : startOfLocalDay(dueAt).getTime() < startOfLocalDay(new Date()).getTime();
}

export function TodoPage({ userId }: { userId: string }) {
  const dialogs = useAppDialogs();
  const { showToast } = useToast();
  const [filter, setFilter] = useState<Filter>('today');
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);
  const [sort, setSort] = useState('dueAt:asc');
  const [priority, setPriority] = useState<TodoPriority | ''>('');
  const [editor, setEditor] = useState<Todo | 'new' | null>(null);
  const setNotice = (notice: { type: 'success' | 'error'; text: string } | null) => { if (notice) showToast(notice.text, notice.type); };
  const [expanded, setExpanded] = useState<string[]>([]);
  const [offlineOperations, setOfflineOperations] = useState<TodoOperation[]>([]);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const queryClient = useQueryClient();
  const range = useMemo(() => dueRange(filter), [filter]);
  const [sortBy, order] = sort.split(':') as ['dueAt' | 'createdAt' | 'priority', 'asc' | 'desc'];
  const todos = useInfiniteQuery({
    queryKey: ['todos', filter, deferredSearch, sortBy, order, priority, range.from, range.to],
    initialPageParam: 1,
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams({ filter, search: deferredSearch, sort: sortBy, order, page: String(pageParam), limit: '25', ...range });
      if (priority) params.set('priority', priority);
      return (await api<TodoPageData>(`/todos?${params}`)).data;
    },
    getNextPageParam: (lastPage) => lastPage.hasMore ? lastPage.page + 1 : undefined
  });
  const items = (todos.data?.pages.flatMap((page) => page.items) ?? []).map((todo) => {
    const localCompletion = offlineOperations.filter((operation) => operation.kind === 'complete' && operation.payload.todoId === todo._id).at(-1);
    return localCompletion ? { ...todo, status: localCompletion.payload.completed ? 'completed' as const : 'pending' as const } : todo;
  });
  const refreshOfflineOperations = useCallback(async () => setOfflineOperations(await listTodoOperations(userId).catch(() => [])), [userId]);
  useEffect(() => {
    const updateOnline = () => setIsOnline(navigator.onLine);
    window.addEventListener('online', updateOnline); window.addEventListener('offline', updateOnline);
    void refreshOfflineOperations();
    return () => { window.removeEventListener('online', updateOnline); window.removeEventListener('offline', updateOnline); };
  }, [refreshOfflineOperations]);
  const refresh = async () => queryClient.invalidateQueries({ queryKey: ['todos'] });
  const create = useMutation({ mutationFn: async (payload: TodoPayload) => api<{ todo: Todo }>('/todos', { method: 'POST', body: JSON.stringify(payload) }), onSuccess: async () => { await refresh(); setNotice({ type: 'success', text: 'Task added to your list.' }); }, onError: (error) => setNotice({ type: 'error', text: error.message }) });
  const update = useMutation({ mutationFn: async ({ id, payload }: { id: string; payload: TodoUpdatePayload }) => api<{ todo: Todo }>(`/todos/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }), onSuccess: async () => { await refresh(); }, onError: (error) => setNotice({ type: 'error', text: error.message }) });
  const complete = useMutation({ mutationFn: async ({ todo, completed }: { todo: Todo; completed: boolean }) => api(`/todos/${todo._id}/completion`, { method: 'POST', body: JSON.stringify({ completed }) }), onSuccess: async (_data, variables) => { await refresh(); setNotice({ type: 'success', text: variables.completed ? 'Nice work — task completed.' : 'Task reopened.' }); }, onError: (error) => setNotice({ type: 'error', text: error.message }) });
  const remove = useMutation({ mutationFn: async (todo: Todo) => api(`/todos/${todo._id}`, { method: 'DELETE' }), onSuccess: async () => { await refresh(); setNotice({ type: 'success', text: 'Task deleted.' }); }, onError: (error) => setNotice({ type: 'error', text: error.message }) });


  async function quickAdd(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const title = String(data.get('quickTitle') ?? '').trim();
    if (!title) return;
    if (!isOnline) {
      await enqueueTodoOperation({ id: crypto.randomUUID(), userId, kind: 'create', payload: { title, priority: 'medium', status: 'pending' }, createdAt: Date.now(), attempts: 0, state: 'pending' });
      await refreshOfflineOperations();
      setNotice({ type: 'success', text: 'Saved on this device. It will sync when you reconnect.' });
      form.reset();
      return;
    }
    try { await create.mutateAsync({ title, priority: 'medium', status: 'pending' }); form.reset(); }
    catch (error) {
      if (error instanceof TypeError) {
        await enqueueTodoOperation({ id: crypto.randomUUID(), userId, kind: 'create', payload: { title, priority: 'medium', status: 'pending' }, createdAt: Date.now(), attempts: 0, state: 'pending' });
        await refreshOfflineOperations();
        setNotice({ type: 'success', text: 'The server could not be reached. Saved on this device to sync later.' });
        form.reset();
      }
    }
  }

  async function toggleCompletion(todo: Todo, completed: boolean) {
    if (!isOnline) {
      await enqueueTodoOperation({ id: crypto.randomUUID(), userId, kind: 'complete', payload: { todoId: todo._id, completed, expectedUpdatedAt: todo.updatedAt, title: todo.title }, createdAt: Date.now(), attempts: 0, state: 'pending' });
      await refreshOfflineOperations();
      setNotice({ type: 'success', text: `Change to “${todo.title}” saved on this device. It will sync when you reconnect.` });
      return;
    }
    try { await complete.mutateAsync({ todo, completed }); }
    catch (error) {
      if (error instanceof TypeError) {
        setIsOnline(navigator.onLine);
        await enqueueTodoOperation({ id: crypto.randomUUID(), userId, kind: 'complete', payload: { todoId: todo._id, completed, expectedUpdatedAt: todo.updatedAt, title: todo.title }, createdAt: Date.now(), attempts: 0, state: 'pending' });
        await refreshOfflineOperations();
        setNotice({ type: 'success', text: `The server could not be reached. Change to “${todo.title}” saved on this device.` });
      }
    }
  }

  const heading = filters.find((item) => item.id === filter)?.label ?? 'Tasks';
  const dateText = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date());
  const isLoading = todos.isPending;

  return <div className="todo-page mx-auto flex min-h-[calc(100vh-68px)] max-w-[1440px]">
    <aside className="hidden w-[250px] shrink-0 border-r border-[#e8ebe5] px-5 py-8 lg:block">
      <p className="px-3 text-[11px] font-semibold uppercase tracking-[.18em] text-slate-400">Workspace</p>
      <nav className="mt-4 space-y-1">{filters.map(({ id, label, icon: Icon }) => <button key={id} onClick={() => setFilter(id)} className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition ${filter === id ? 'bg-[#e7f0eb] font-medium text-[#1c5a4d]' : 'text-slate-600 hover:bg-white'}`}><Icon size={17} strokeWidth={1.8} />{label}{id === 'all' && todos.data?.pages[0]?.total !== undefined && <span className="ml-auto text-xs text-slate-400">{todos.data.pages[0].total}</span>}</button>)}</nav>
      <div className="mt-10 rounded-2xl bg-[#e9f1eb] p-4"><div className="flex items-center gap-2 text-sm font-medium text-[#294c40]"><Sparkles size={15} /> A little reminder</div><p className="mt-2 text-xs leading-5 text-[#587166]">Small steps count. Focus on what matters today.</p></div>
    </aside>
    <main className="min-w-0 flex-1 px-4 pb-20 pt-7 sm:px-8 sm:pt-10 lg:px-12">
      <div className="mx-auto max-w-[970px]">
        <div className="mb-5 lg:hidden"><nav className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-2">{filters.map(({ id, label, icon: Icon }) => <button key={id} onClick={() => setFilter(id)} className={`flex shrink-0 items-center gap-2 rounded-full px-3.5 py-2 text-xs font-medium ${filter === id ? 'bg-[#163c36] text-white' : 'border border-slate-200 bg-white text-slate-600'}`}><Icon size={14} />{label}</button>)}</nav></div>
        <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end"><div><p className="text-sm font-medium text-teal-800">{dateText}</p><h1 className="mt-1 text-[32px] font-semibold tracking-tight text-[#1a2823] sm:text-[38px]">{heading}<span className="ml-2 text-slate-300">.</span></h1><p className="mt-1 text-sm text-slate-500">A clear mind starts with a clear list.</p></div><button onClick={() => setEditor('new')} className="flex h-11 items-center justify-center gap-2 rounded-xl bg-[#163c36] px-4 text-sm font-medium text-white shadow-sm transition hover:bg-[#215247]"><Plus size={17} /> Add task</button></div>

        <form onSubmit={quickAdd} className="mt-7 flex items-center gap-3 rounded-2xl border border-[#e4e8e1] bg-white p-2 pl-4 shadow-[0_5px_20px_-16px_rgba(20,42,34,.32)] focus-within:border-teal-700/50 focus-within:ring-4 focus-within:ring-teal-700/5"><Plus className="shrink-0 text-teal-800" size={19} /><input name="quickTitle" placeholder="Quick add a task…" className="h-10 min-w-0 flex-1 border-0 bg-transparent text-sm outline-none placeholder:text-slate-400" maxLength={160} /><span className="hidden text-[11px] text-slate-400 sm:block">Press Enter</span><button disabled={create.isPending} className="grid size-9 shrink-0 place-items-center rounded-xl bg-[#eef4ef] text-[#225b4e] hover:bg-[#dcebe1] disabled:opacity-50" aria-label="Add task"><ArrowRight size={17} /></button></form>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row"><label className="relative min-w-0 flex-1"><Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search tasks, notes, or labels" className="h-10 w-full rounded-xl border border-[#e4e8e1] bg-white pl-10 pr-4 text-sm outline-none placeholder:text-slate-400 focus:border-teal-700/50" /></label><label className="relative flex shrink-0 items-center gap-2 rounded-xl border border-[#e4e8e1] bg-white px-3 text-xs text-slate-500"><Flag size={14} /><select value={priority} onChange={(event) => setPriority(event.target.value as TodoPriority | '')} className="h-10 appearance-none bg-transparent pr-4 text-sm text-slate-700 outline-none"><option value="">Any priority</option><option value="high">High priority</option><option value="medium">Medium priority</option><option value="low">Low priority</option></select><ChevronDown className="pointer-events-none absolute right-3" size={13} /></label><label className="relative flex shrink-0 items-center gap-2 rounded-xl border border-[#e4e8e1] bg-white px-3 text-xs text-slate-500"><ArrowDownWideNarrow size={15} /><select value={sort} onChange={(event) => setSort(event.target.value)} className="h-10 appearance-none bg-transparent pr-4 text-sm text-slate-700 outline-none"><option value="dueAt:asc">Due date</option><option value="createdAt:desc">Recently added</option><option value="priority:desc">Priority</option></select><ChevronDown className="pointer-events-none absolute right-3" size={13} /></label></div>

        {offlineOperations.length > 0 && <section aria-label="Pending offline task changes" className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3"><h2 className="text-sm font-semibold text-amber-950">Waiting to sync · {offlineOperations.length}</h2><ul className="mt-2 space-y-2 text-xs text-amber-900">{offlineOperations.map((operation) => <li key={operation.id} className="flex flex-wrap items-center justify-between gap-2"><span>{operation.kind === 'create' ? `New task: ${String(operation.payload.title)}` : `Change: ${String(operation.payload.title ?? 'task')}`} · {operation.state === 'conflict' ? `Conflict: ${operation.error ?? 'review the latest server version'}` : operation.state === 'failed' ? `Sync failed: ${operation.error ?? 'Retry when ready'}` : 'Pending'}</span>{operation.state === 'conflict' && operation.kind === 'complete' && <button className="font-semibold underline" onClick={async () => { await removeTodoOperation(operation.id); await refreshOfflineOperations(); await todos.refetch(); }}>Discard local change and reload task</button>}</li>)}</ul><p className="mt-2 text-xs text-amber-800">A conflict is held for review; Daybook will not overwrite the newer server task automatically.</p></section>}

        <section className="mt-5 overflow-hidden rounded-2xl border border-[#e4e8e1] bg-white/75 shadow-[0_10px_35px_-30px_rgba(20,42,34,.3)] backdrop-blur-sm">
          {isLoading ? <div className="grid min-h-52 place-items-center"><LoaderCircle className="animate-spin text-teal-800" /></div> : todos.isError ? <div className="px-6 py-12 text-center"><AlertCircle className="mx-auto text-rose-500" /><p className="mt-3 font-medium text-slate-800">{isOnline ? 'Could not load your tasks' : 'Your server task list needs a connection'}</p><p className="mt-1 text-sm text-slate-500">{todos.error.message}</p><button className="mt-4 text-sm font-medium text-teal-800" onClick={() => todos.refetch()}>Try again</button></div> : items.length === 0 ? <EmptyState filter={filter} search={deferredSearch} onAdd={() => setEditor('new')} /> : <div className="space-y-2 p-2 sm:p-3">{items.map((todo) => <TodoRow key={todo._id} todo={todo} expanded={expanded.includes(todo._id)} onToggleExpanded={() => setExpanded((current) => current.includes(todo._id) ? current.filter((id) => id !== todo._id) : [...current, todo._id])} onComplete={(completed) => void toggleCompletion(todo, completed)} onEdit={() => setEditor(todo)} onDelete={() => void dialogs.confirm('Delete task?', `Delete “${todo.title}”? This cannot be undone.`, { confirmText: 'Delete task', destructive: true }).then((confirmed) => { if (confirmed) remove.mutate(todo); })} onSubtask={(subtaskId) => update.mutate({ id: todo._id, payload: { subtasks: todo.subtasks.map((subtask) => subtask.id === subtaskId ? { ...subtask, completed: !subtask.completed } : subtask) } })} busy={complete.isPending || update.isPending || remove.isPending} />)}</div>}
        </section>
        {todos.hasNextPage && <button onClick={() => todos.fetchNextPage()} disabled={todos.isFetchingNextPage} className="mx-auto mt-5 flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium text-teal-800 hover:bg-white disabled:opacity-50">{todos.isFetchingNextPage && <LoaderCircle size={15} className="animate-spin" />}Load more tasks</button>}
        {items.length > 0 && <p className="mt-5 text-center text-xs text-slate-400">Showing {items.length} of {todos.data?.pages[0]?.total ?? items.length} tasks</p>}
      </div>
    </main>
    {editor && <TodoEditor todo={editor === 'new' ? undefined : editor} onClose={() => setEditor(null)} onSave={async (payload) => {
      if (editor === 'new') await create.mutateAsync(payload);
      else {
        const { status, ...changes } = payload;
        await update.mutateAsync({ id: editor._id, payload: changes });
        if (status === 'completed' && editor.status !== 'completed') await complete.mutateAsync({ todo: editor, completed: true });
        else if (editor.status === 'completed' && status !== 'completed') await complete.mutateAsync({ todo: editor, completed: false });
        if (status !== 'completed' && status !== editor.status && !(editor.status === 'completed' && status === 'pending')) await update.mutateAsync({ id: editor._id, payload: { status } });
        setNotice({ type: 'success', text: 'Task updated.' });
      }
      setEditor(null);
    }} busy={create.isPending || update.isPending || complete.isPending} />}
  </div>;
}

function EmptyState({ filter, search, onAdd }: { filter: Filter; search: string; onAdd: () => void }) {
  const message: Record<Filter, { icon: typeof Inbox; title: string; copy: string }> = {
    today: { icon: CheckCircle2, title: 'A little breathing room.', copy: 'Nothing due today. Add a task whenever something comes to mind.' },
    upcoming: { icon: CalendarClock, title: 'Your future looks clear.', copy: 'No upcoming tasks yet. Add one to stay a step ahead.' },
    all: { icon: Inbox, title: 'A fresh start.', copy: 'Your task list is empty. Add your first task and make space in your mind.' },
    completed: { icon: CheckCircle2, title: 'Your wins will show up here.', copy: 'Complete a task to start building your list of little victories.' },
    overdue: { icon: CheckCircle2, title: 'All caught up.', copy: 'No overdue tasks. You’re doing great.' }
  };
  const { icon: Icon, title, copy } = message[filter];
  return <div className="px-6 py-14 text-center sm:py-16"><div className="mx-auto grid size-14 place-items-center rounded-2xl bg-[#eef4ef] text-[#2a6657]"><Icon size={24} strokeWidth={1.6} /></div><h2 className="mt-4 text-lg font-semibold text-[#23332c]">{search ? 'No matches found.' : title}</h2><p className="mx-auto mt-1.5 max-w-sm text-sm leading-6 text-slate-500">{search ? 'Try another search or clear the search field.' : copy}</p>{filter !== 'completed' && filter !== 'overdue' && !search && <button onClick={onAdd} className="mt-5 inline-flex items-center gap-2 rounded-xl bg-[#163c36] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#215247]"><Plus size={16} /> Add a task</button>}</div>;
}

function TodoRow({ todo, expanded, onToggleExpanded, onComplete, onEdit, onDelete, onSubtask, busy }: { todo: Todo; expanded: boolean; onToggleExpanded: () => void; onComplete: (done: boolean) => void; onEdit: () => void; onDelete: () => void; onSubtask: (id: string) => void; busy: boolean }) {
  const due = formatDue(todo.dueAt, todo.dueTimeSet);
  const overdue = isOverdue(todo);
  const completed = todo.status === 'completed';
  const doneCount = todo.subtasks.filter((subtask) => subtask.completed).length;
  return <article className={`group rounded-xl border px-4 py-4 backdrop-blur-md transition-colors sm:px-5 ${priorityCardStyle[todo.priority]} ${completed ? 'opacity-75' : ''}`}>
    <div className="flex items-start gap-3.5">
      <button disabled={busy} onClick={() => onComplete(!completed)} className={`mt-0.5 grid size-[21px] shrink-0 place-items-center rounded-full transition ${completed ? 'bg-[#317363] text-white' : 'border-[1.5px] border-slate-300 text-transparent hover:border-teal-700 hover:text-teal-700'} disabled:opacity-50`} aria-label={completed ? `Reopen ${todo.title}` : `Complete ${todo.title}`}>{completed ? <Check size={13} strokeWidth={3} /> : <Check size={13} strokeWidth={3} />}</button>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2"><button onClick={onEdit} className={`text-left text-[15px] font-medium leading-6 ${completed ? 'text-slate-400 line-through' : 'text-[#24342e] hover:text-teal-800'}`}>{todo.title}</button>{todo.recurrence && <span title={`${todo.recurrence.frequency} repeat`} className="text-teal-700"><Repeat2 size={14} /></span>}{todo.status === 'in_progress' && <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-700">In progress</span>}</div>
        {todo.description && <p className="mt-0.5 line-clamp-2 text-sm leading-5 text-slate-500">{todo.description}</p>}
        <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 font-medium ${priorityStyle[todo.priority]}`}><Flag size={11} />{priorityLabel[todo.priority]}</span>
          {due && <span className={`inline-flex items-center gap-1 ${overdue ? 'font-medium text-rose-600' : 'text-slate-500'}`}><Clock3 size={13} />{overdue ? 'Overdue · ' : ''}{due}</span>}
          {todo.label && <span className="rounded-full border border-slate-200 px-2 py-0.5 text-slate-500">{todo.label}</span>}
          {todo.subtasks.length > 0 && <button onClick={onToggleExpanded} className="inline-flex items-center gap-1 text-slate-500 hover:text-teal-800"><ListChecks size={14} />{doneCount}/{todo.subtasks.length}<ChevronDown className={`transition ${expanded ? 'rotate-180' : ''}`} size={12} /></button>}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1 opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"><button onClick={onEdit} className="grid size-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label={`Edit ${todo.title}`}><Pencil size={14} /></button><button onClick={onDelete} className="grid size-8 place-items-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600" aria-label={`Delete ${todo.title}`}><Trash2 size={14} /></button></div>
    </div>
    {expanded && <div className="ml-[35px] mt-3 space-y-2 border-l border-slate-200 pl-4">{todo.subtasks.map((subtask) => <label key={subtask.id} className="flex cursor-pointer items-center gap-2.5 text-sm text-slate-600"><input type="checkbox" checked={subtask.completed} onChange={() => onSubtask(subtask.id)} className="size-3.5 accent-teal-800" /><span className={subtask.completed ? 'text-slate-400 line-through' : ''}>{subtask.title}</span></label>)}</div>}
  </article>;
}

function TodoEditor({ todo, onClose, onSave, busy }: { todo?: Todo; onClose: () => void; onSave: (payload: TodoPayload) => Promise<void>; busy: boolean }) {
  const existingDate = todo?.dueAt ? new Date(todo.dueAt) : undefined;
  const [saveError, setSaveError] = useState('');
  const form = useForm<EditorValues>({
    resolver: zodResolver(editorSchema) as Resolver<EditorValues>,
    defaultValues: {
      title: todo?.title ?? '', description: todo?.description ?? '', priority: todo?.priority ?? 'medium', status: todo?.status ?? 'pending',
      dueDate: existingDate ? localDateTime(existingDate).slice(0, 10) : '', dueTime: existingDate && todo?.dueTimeSet ? localDateTime(existingDate).slice(11, 16) : '',
      label: todo?.label ?? '', subtasksText: todo?.subtasks.map((item) => item.title).join('\n') ?? '', frequency: todo?.recurrence?.frequency ?? '', interval: todo?.recurrence?.interval ?? 1,
      daysOfWeek: todo?.recurrence?.daysOfWeek ?? [], dayOfMonth: todo?.recurrence?.dayOfMonth ?? (existingDate?.getDate() ?? 1), endDate: todo?.recurrence?.endDate?.slice(0, 10) ?? ''
    }
  });
  const frequency = form.watch('frequency');
  async function submit(values: EditorValues) {
    const dueAt = values.dueDate ? new Date(`${values.dueDate}T${values.dueTime || '00:00'}`).toISOString() : null;
    const subtasks: Subtask[] = values.subtasksText.split('\n').map((line) => line.trim()).filter(Boolean).map((title) => {
      const previous = todo?.subtasks.find((item) => item.title === title);
      return { id: previous?.id ?? crypto.randomUUID(), title, completed: previous?.completed ?? false };
    });
    let recurrence: Recurrence | null = null;
    if (values.frequency) recurrence = { frequency: values.frequency, interval: values.interval, ...(values.frequency === 'weekly' ? { daysOfWeek: values.daysOfWeek } : {}), ...(values.frequency === 'monthly' ? { dayOfMonth: values.dayOfMonth } : {}), ...(values.endDate ? { endDate: new Date(`${values.endDate}T23:59:59`).toISOString() } : {}) };
    setSaveError('');
    try {
      await onSave({ title: values.title, description: values.description, priority: values.priority, status: values.status, dueAt, dueTimeSet: Boolean(values.dueTime), label: values.label, subtasks, recurrence });
    } catch (error) { setSaveError(error instanceof Error ? error.message : 'Could not save this task.'); }
  }
  return <div className="fixed inset-0 z-40 grid place-items-center bg-[#15231f]/45 p-3 backdrop-blur-[2px] sm:p-6" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section role="dialog" aria-modal="true" aria-labelledby="todo-editor-title" className="todo-editor flex max-h-[min(88dvh,780px)] w-full max-w-[620px] flex-col overflow-hidden rounded-[24px] bg-white p-5 shadow-2xl sm:p-7">
      <div className="todo-editor-header flex shrink-0 items-start justify-between border-b border-slate-100 pb-4"><div><p className="text-xs font-semibold uppercase tracking-[.16em] text-teal-800">Your task list</p><h2 id="todo-editor-title" className="mt-1 text-2xl font-semibold tracking-tight text-[#1c2c25]">{todo ? 'Edit task' : 'Make a little plan'}</h2><p className="mt-1 text-xs text-slate-500">A few details now, a clearer day later.</p></div><button onClick={onClose} className="grid size-9 place-items-center rounded-full text-slate-400 hover:bg-slate-100" aria-label="Close"><X size={18} /></button></div>
      <form onSubmit={form.handleSubmit(submit)} className="todo-editor-form min-h-0 flex-1 space-y-4 overflow-y-auto pt-4">
        <Field label="Task name"><input autoFocus {...form.register('title')} placeholder="What needs to get done?" maxLength={160} className="field-input text-base font-medium" />{form.formState.errors.title && <ErrorText>{form.formState.errors.title.message}</ErrorText>}</Field>
        <Field label="A few details"><textarea {...form.register('description')} rows={2} placeholder="Add a note if it helps…" className="field-input resize-y" /></Field>
        <div className="grid gap-3 sm:grid-cols-2"><Field label="Priority"><select {...form.register('priority')} className="field-input"><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></Field><Field label="Status"><select {...form.register('status')} className="field-input"><option value="pending">To do</option><option value="in_progress">In progress</option><option value="completed" disabled={!todo}>Completed</option></select></Field></div>
        <div className="grid gap-3 sm:grid-cols-2"><Field label="Due date"><input type="date" {...form.register('dueDate')} className="field-input" />{form.formState.errors.dueDate && <ErrorText>{form.formState.errors.dueDate.message}</ErrorText>}</Field><Field label="Due time · optional"><input type="time" {...form.register('dueTime')} className="field-input" /></Field></div>
        <Field label="Category or project"><input {...form.register('label')} placeholder="e.g. Home, Work, Personal" maxLength={48} className="field-input" /></Field>
        <Field label="Subtasks · one per line"><textarea {...form.register('subtasksText')} rows={3} placeholder={'Plan the steps\nGather what you need'} className="field-input resize-y" />{form.formState.errors.subtasksText && <ErrorText>{form.formState.errors.subtasksText.message}</ErrorText>}</Field>
        <div className="rounded-2xl border border-[#e7ebe5] bg-[#fbfcfa] p-4"><div className="flex items-center gap-2 text-sm font-medium text-[#2b4037]"><Repeat2 size={16} /> Repeat task</div><div className="mt-3 grid gap-3 sm:grid-cols-[1fr_110px]"><select {...form.register('frequency')} className="field-input"><option value="">Does not repeat</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select>{frequency && <label className="text-xs text-slate-500">Every<input type="number" min={1} max={365} {...form.register('interval', { valueAsNumber: true })} className="field-input mt-1" /></label>}</div>
          {frequency === 'weekly' && <div className="mt-3"><p className="mb-2 text-xs text-slate-500">Repeat on</p><div className="flex flex-wrap gap-1.5">{weekdays.map((day, index) => { const selected = form.watch('daysOfWeek').includes(index); return <button type="button" key={day} onClick={() => { const current = form.getValues('daysOfWeek'); form.setValue('daysOfWeek', selected ? current.filter((item) => item !== index) : [...current, index]); }} className={`grid size-9 place-items-center rounded-full text-xs font-medium ${selected ? 'bg-[#215b4e] text-white' : 'border border-slate-200 bg-white text-slate-500'}`}>{day}</button>; })}</div>{form.formState.errors.daysOfWeek && <ErrorText>{form.formState.errors.daysOfWeek.message}</ErrorText>}</div>}
          {frequency === 'monthly' && <Field label="Day of month"><input type="number" min={1} max={31} {...form.register('dayOfMonth', { valueAsNumber: true })} className="field-input" /></Field>}
          {frequency && <Field label="Stop repeating · optional"><input type="date" {...form.register('endDate')} className="field-input" />{form.formState.errors.endDate && <ErrorText>{form.formState.errors.endDate.message}</ErrorText>}</Field>}
        </div>
        {saveError && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{saveError}</p>}
        <div className="todo-editor-footer sticky bottom-0 flex flex-col-reverse gap-2 border-t border-slate-100 bg-white/95 py-3 backdrop-blur sm:flex-row sm:justify-end"><button type="button" onClick={onClose} className="h-11 rounded-xl border border-slate-200 px-4 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancel</button><button disabled={busy} className="flex h-11 items-center justify-center gap-2 rounded-xl bg-[#163c36] px-5 text-sm font-medium text-white hover:bg-[#215247] disabled:opacity-60">{busy && <LoaderCircle className="animate-spin" size={16} />}{todo ? 'Save changes' : 'Add task'}</button></div>
      </form>
    </section>
  </div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block text-xs font-medium text-slate-600">{label}<div className="mt-1.5">{children}</div></label>; }
function ErrorText({ children }: { children?: React.ReactNode }) { return <span className="mt-1 block text-xs text-rose-600">{children}</span>; }
