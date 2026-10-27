import { createContext, useContext } from 'react';

export type AppDialogs = {
  alert: (title: string, message: string) => Promise<void>;
  confirm: (title: string, message: string, options?: { confirmText?: string; destructive?: boolean }) => Promise<boolean>;
  prompt: (title: string, message: string, value?: string, placeholder?: string) => Promise<string | null>;
};

export const DialogContext = createContext<AppDialogs | null>(null);

export function useAppDialogs() {
  const dialogs = useContext(DialogContext);
  if (!dialogs) throw new Error('useAppDialogs must be used inside AppDialogsProvider.');
  return dialogs;
}
