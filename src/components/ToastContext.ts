import { createContext, useContext } from 'react';

export type ToastKind = 'success' | 'error' | 'info';
export type ToastApi = { showToast: (message: string, kind?: ToastKind) => void };
export const ToastContext = createContext<ToastApi | null>(null);
export function useToast() {
  const value = useContext(ToastContext);
  if (!value) throw new Error('useToast must be used inside AppToastProvider');
  return value;
}
