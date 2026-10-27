import { AlertTriangle, CheckCircle2, Info, MessageSquareText, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { DialogContext } from './AppDialogsContext';

type DialogKind = 'alert' | 'confirm' | 'prompt';
type DialogRequest = {
  id: number;
  kind: DialogKind;
  title: string;
  message: string;
  value: string;
  placeholder?: string;
  confirmText: string;
  destructive: boolean;
  resolve: (value: boolean | string | null) => void;
};
export function AppDialogsProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<DialogRequest | null>(null);
  const activeRef = useRef<DialogRequest | null>(null);
  const queue = useRef<DialogRequest[]>([]);
  const nextId = useRef(0);

  const open = useCallback((request: Omit<DialogRequest, 'id' | 'resolve'>) => new Promise<boolean | string | null>((resolve) => {
    const item: DialogRequest = { ...request, id: ++nextId.current, resolve };
    if (activeRef.current) queue.current.push(item);
    else { activeRef.current = item; setActive(item); }
  }), []);

  const finish = useCallback((result: boolean | string | null) => {
    const current = activeRef.current;
    if (!current) return;
    current.resolve(result);
    const next = queue.current.shift() ?? null;
    activeRef.current = next;
    setActive(next);
  }, []);

  const alert = useCallback(async (title: string, message: string) => {
    await open({ kind: 'alert', title, message, value: '', confirmText: 'Got it', destructive: false });
  }, [open]);
  const confirm = useCallback(async (title: string, message: string, options: { confirmText?: string; destructive?: boolean } = {}) =>
    await open({ kind: 'confirm', title, message, value: '', confirmText: options.confirmText ?? 'Continue', destructive: options.destructive ?? false }) === true,
  [open]);
  const prompt = useCallback(async (title: string, message: string, value = '', placeholder?: string) => {
    const result = await open({ kind: 'prompt', title, message, value, placeholder, confirmText: 'Save', destructive: false });
    return typeof result === 'string' ? result : null;
  }, [open]);
  const dialogApi = useMemo(() => ({ alert, confirm, prompt }), [alert, confirm, prompt]);

  return <DialogContext.Provider value={dialogApi}>
    {children}
    {active && <DialogView key={active.id} request={active} onResolve={finish} />}
  </DialogContext.Provider>;
}

function DialogView({ request, onResolve }: { request: DialogRequest; onResolve: (result: boolean | string | null) => void }) {
  const [value, setValue] = useState(request.value);
  const isPrompt = request.kind === 'prompt';
  const isAlert = request.kind === 'alert';
  const Icon = request.destructive ? AlertTriangle : isPrompt ? MessageSquareText : isAlert ? Info : CheckCircle2;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onResolve(isAlert ? true : null); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isAlert, onResolve]);

  function submit(event: FormEvent) {
    event.preventDefault();
    onResolve(isPrompt ? value : true);
  }

  return <div className="app-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onResolve(isAlert ? true : null); }}>
    <section className="app-dialog" role="alertdialog" aria-modal="true" aria-labelledby="app-dialog-title" aria-describedby="app-dialog-message">
      <button type="button" className="app-dialog-close" aria-label="Close dialog" onClick={() => onResolve(isAlert ? true : null)}><X size={18} /></button>
      <div className={`app-dialog-icon ${request.destructive ? 'app-dialog-icon-danger' : ''}`}><Icon size={21} /></div>
      <h2 id="app-dialog-title" className="mt-4 text-xl font-semibold tracking-tight text-slate-900">{request.title}</h2>
      <p id="app-dialog-message" className="mt-2 whitespace-pre-line text-sm leading-6 text-slate-600">{request.message}</p>
      <form onSubmit={submit}>
        {isPrompt && <input autoFocus className="app-dialog-input" value={value} onChange={(event) => setValue(event.target.value)} placeholder={request.placeholder} onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); onResolve(null); } }} />}
        <div className="mt-6 flex flex-col-reverse justify-end gap-2 sm:flex-row">
          {!isAlert && <button type="button" className="app-dialog-secondary" onClick={() => onResolve(null)}>Cancel</button>}
          <button autoFocus={!isPrompt} type={isAlert ? 'button' : 'submit'} className={`app-dialog-primary ${request.destructive ? 'app-dialog-primary-danger' : ''}`} onClick={isAlert ? () => onResolve(true) : undefined}>{request.confirmText}</button>
        </div>
      </form>
    </section>
  </div>;
}
