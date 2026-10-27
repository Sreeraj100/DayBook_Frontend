import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowRight, CheckCheck, Eye, EyeOff, LoaderCircle, LockKeyhole } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { api, type User } from '../../lib/api';

const schema = z.object({ email: z.string().email('Enter a valid email address.'), password: z.string().min(12, 'Use at least 12 characters.') });
type Values = z.infer<typeof schema>;

export function AuthScreen({ onAuthenticated, notice, setNotice }: { onAuthenticated: () => Promise<unknown>; notice: string; setNotice: (notice: string) => void }) {
  const [registering, setRegistering] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { email: '', password: '' } });
  async function submit(values: Values) {
    setBusy(true); setNotice('');
    try { await api<User>(registering ? '/auth/register' : '/auth/login', { method: 'POST', body: JSON.stringify(values) }); await onAuthenticated(); }
    catch (error) { setNotice(error instanceof Error ? error.message : 'Could not sign in.'); }
    finally { setBusy(false); }
  }
  return <main className="grid min-h-[calc(100vh-68px)] place-items-center px-5 py-12"><div className="w-full max-w-[420px]">
    <div className="mb-7 flex items-center justify-center gap-2 text-sm text-slate-500"><LockKeyhole size={15} className="text-teal-700" /> Your private space</div>
    <section className="rounded-[28px] border border-[#e6e9e2] bg-white p-7 shadow-[0_18px_55px_-35px_rgba(25,54,45,.28)] sm:p-9">
      <div className="grid size-12 place-items-center rounded-2xl bg-[#e9f3ef] text-[#1c5a4d]"><CheckCheck size={23} /></div>
      <h1 className="mt-6 text-3xl font-semibold tracking-tight text-[#182723]">{registering ? 'Create your space' : 'Welcome back'}</h1>
      <p className="mt-2 text-sm leading-6 text-slate-500">{registering ? 'One calm place for the things you want to remember.' : 'Your day is yours to shape. Let’s pick up where you left off.'}</p>
      <form className="mt-7 space-y-4" onSubmit={form.handleSubmit(submit)}>
        <label className="block text-sm font-medium text-slate-700">Email address<input autoComplete="email" type="email" {...form.register('email')} className="mt-2 h-12 w-full rounded-xl border border-slate-200 bg-[#fbfcfa] px-3.5 outline-none transition focus:border-teal-700 focus:ring-4 focus:ring-teal-700/10" placeholder="you@example.com" />{form.formState.errors.email && <span className="mt-1 block text-xs text-rose-600">{form.formState.errors.email.message}</span>}</label>
        <label className="block text-sm font-medium text-slate-700">Password<div className="relative mt-2"><input autoComplete={registering ? 'new-password' : 'current-password'} type={showPassword ? 'text' : 'password'} {...form.register('password')} className="h-12 w-full rounded-xl border border-slate-200 bg-[#fbfcfa] px-3.5 pr-12 outline-none transition focus:border-teal-700 focus:ring-4 focus:ring-teal-700/10" placeholder={registering ? 'At least 12 characters' : 'Your password'} /><button type="button" onClick={() => setShowPassword((shown) => !shown)} className="absolute inset-y-0 right-0 grid w-12 place-items-center text-slate-400" aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div>{form.formState.errors.password && <span className="mt-1 block text-xs text-rose-600">{form.formState.errors.password.message}</span>}</label>
        {notice && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{notice}</p>}
        <button disabled={busy} className="mt-2 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#163c36] font-medium text-white transition hover:bg-[#215247] disabled:opacity-60">{busy ? <LoaderCircle className="animate-spin" size={18} /> : <>{registering ? 'Create account' : 'Sign in'}<ArrowRight size={17} /></>}</button>
      </form>
      <div className="mt-6 border-t border-slate-100 pt-5 text-center text-sm text-slate-500">{registering ? 'Already have an account?' : 'New to Daybook?'} <button onClick={() => { setRegistering((value) => !value); setNotice(''); form.reset(); }} className="font-medium text-teal-800 hover:underline">{registering ? 'Sign in' : 'Create an account'}</button></div>
    </section>
    <p className="mt-6 text-center text-xs leading-5 text-slate-400">Your tasks are private to your account and protected by a secure session.</p>
  </div></main>;
}
