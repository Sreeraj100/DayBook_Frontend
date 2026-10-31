import { useRegisterSW } from 'virtual:pwa-register/react';
import { CheckCheck, RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

async function fetchDeployedVersion() {
  const response = await fetch(`/app-version.json?check=${Date.now()}`, { cache: 'no-store' });
  if (!response.ok) throw new Error('Version check failed.');
  const payload = await response.json() as { version?: unknown };
  return typeof payload.version === 'string' ? payload.version : null;
}

export function PwaUpdateManager() {
  const registration = useRef<ServiceWorkerRegistration | undefined>(undefined);
  const [availableVersion, setAvailableVersion] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [updateError, setUpdateError] = useState('');
  const updateButton = useRef<HTMLButtonElement>(null);
  const [installedApp] = useState(() => window.matchMedia('(display-mode: standalone)').matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone));
  const { needRefresh: [needRefresh], updateServiceWorker } = useRegisterSW({
    onRegisteredSW: (_url, workerRegistration) => { if (workerRegistration) registration.current = workerRegistration; }
  });

  useEffect(() => {
    let alive = true;
    const checkForRelease = async () => {
      if (!navigator.onLine) return;
      try {
        const version = await fetchDeployedVersion();
        if (!alive || !version || version === __APP_VERSION__) return;
        setAvailableVersion(version);
        const workerRegistration = registration.current ?? await navigator.serviceWorker.getRegistration();
        if (workerRegistration) {
          registration.current = workerRegistration;
          await workerRegistration.update().catch(() => undefined);
        }
      } catch { /* A release check should not block the current app when offline or unavailable. */ }
    };
    void checkForRelease();
    const timer = window.setInterval(() => void checkForRelease(), 60_000);
    window.addEventListener('online', checkForRelease);
    return () => { alive = false; window.clearInterval(timer); window.removeEventListener('online', checkForRelease); };
  }, []);

  useEffect(() => {
    if (!needRefresh || availableVersion) return;
    let cancelled = false;
    void fetchDeployedVersion().then((version) => { if (!cancelled && version) setAvailableVersion(version); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [needRefresh, availableVersion]);

  const updateVisible = installedApp && Boolean(availableVersion) && availableVersion !== __APP_VERSION__;

  useEffect(() => {
    if (!updateVisible) return;
    let app: HTMLElement | null = null;
    const observer = new MutationObserver(() => {
      app = document.querySelector<HTMLElement>('.app-root-authenticated');
      if (app) app.inert = true;
    });
    app = document.querySelector<HTMLElement>('.app-root-authenticated');
    if (app) app.inert = true;
    else observer.observe(document.body, { childList: true, subtree: true });
    const containKeyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') event.preventDefault();
      if (event.key === 'Tab') { event.preventDefault(); updateButton.current?.focus(); }
    };
    document.addEventListener('keydown', containKeyboard);
    updateButton.current?.focus();
    return () => { observer.disconnect(); if (app) app.inert = false; document.removeEventListener('keydown', containKeyboard); };
  }, [updateVisible]);

  async function applyUpdate() {
    setApplying(true);
    setUpdateError('');
    try {
      const workerRegistration = registration.current ?? await navigator.serviceWorker.getRegistration();
      if (!workerRegistration) throw new Error('The update service is not ready.');
      registration.current = workerRegistration;
      await workerRegistration.update();
      for (let attempt = 0; attempt < 60 && !workerRegistration.waiting; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 250));
      }
      if (!workerRegistration.waiting) throw new Error('The new app files are not available yet.');
      await updateServiceWorker(true);
    } catch {
      setUpdateError('The update could not finish. Check your connection and try again.');
      setApplying(false);
    }
  }

  if (!updateVisible) return null;
  return <div className="app-update-backdrop" role="presentation"><section className="app-update-dialog" role="alertdialog" aria-modal="true" aria-labelledby="app-update-title" aria-describedby="app-update-description">
    <span className="app-update-icon"><CheckCheck size={21} /></span>
    <p className="app-update-eyebrow">DAYBOOK UPDATE</p>
    <h2 id="app-update-title">A new version is ready</h2>
    <p id="app-update-description" className="app-update-message">Update Daybook to get the latest improvements. Your saved tasks, diary, and other data will stay in your account.</p>
    <div className="app-update-version"><span>Installed <strong>v{__APP_VERSION__}</strong></span><span aria-hidden="true">→</span><span>Available <strong>v{availableVersion}</strong></span></div>
    {updateError && <p role="alert" className="app-update-error">{updateError}</p>}
    <div className="app-update-actions"><button ref={updateButton} autoFocus className="app-update-apply" type="button" onClick={() => void applyUpdate()} disabled={applying}><RefreshCw size={16} className={applying ? 'animate-spin' : ''} />{applying ? 'Updating…' : 'Update now'}</button></div>
  </section></div>;
}
