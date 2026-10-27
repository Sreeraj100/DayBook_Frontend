export type SaveState = 'saved' | 'saving' | 'unsaved' | 'error';
export function createAutosaver(save: (content: string) => Promise<void>, onState: (state: SaveState) => void, delay = 800) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let version = 0;
  let persistedVersion = 0;
  let latest = '';
  let running: Promise<void> | undefined;
  const write = async (requestedVersion: number) => {
    if (running) await running;
    if (requestedVersion <= persistedVersion) { if (requestedVersion === version) onState('saved'); return; }
    if (requestedVersion !== version) return;
    onState('saving');
    const content = latest;
    running = save(content);
    try {
      await running;
      persistedVersion = Math.max(persistedVersion, requestedVersion);
      if (requestedVersion === version) onState('saved');
    } catch {
      if (requestedVersion === version) onState('error');
    } finally { running = undefined; }
  };
  return {
    schedule(content: string) {
      latest = content;
      version += 1;
      onState('unsaved');
      if (timer) clearTimeout(timer);
      const scheduledVersion = version;
      timer = setTimeout(() => { timer = undefined; void write(scheduledVersion); }, delay);
    },
    async flush() {
      if (timer) clearTimeout(timer);
      timer = undefined;
      await write(version);
    },
    cancel() { if (timer) clearTimeout(timer); timer = undefined; }
  };
}
