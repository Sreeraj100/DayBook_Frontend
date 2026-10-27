import { Check, Info, X, XCircle } from 'lucide-react';
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { ToastContext, type ToastKind } from './ToastContext';

type ToastItem = { id: number; message: string; kind: ToastKind };

export function AppToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(0);
  const timers = useRef(new Map<number, number>());

  const dismissToast = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) window.clearTimeout(timer);
    timers.current.delete(id);
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const showToast = useCallback((message: string, kind: ToastKind = 'success') => {
    const id = ++nextId.current;
    setItems((current) => [...current.slice(-3), { id, message, kind }]);
    timers.current.set(id, window.setTimeout(() => dismissToast(id), kind === 'error' ? 6500 : 4200));
  }, [dismissToast]);

  return <ToastContext.Provider value={{ showToast }}>
    {children}
    <div className="app-toast-stack" aria-live="polite" aria-relevant="additions text">
      {items.map((item) => {
        const Icon = item.kind === 'error' ? XCircle : item.kind === 'info' ? Info : Check;
        return <div key={item.id} className={`app-toast app-toast-${item.kind}`} role={item.kind === 'error' ? 'alert' : 'status'}>
          <Icon size={17} aria-hidden="true" />
          <span className="min-w-0 flex-1">{item.message}</span>
          <button type="button" onClick={() => dismissToast(item.id)} aria-label="Dismiss notification"><X size={15} /></button>
        </div>;
      })}
    </div>
  </ToastContext.Provider>;
}
