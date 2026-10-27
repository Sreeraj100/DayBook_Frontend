export type DiaryDraft = { userId: string; date: string; content: string; savedAt: number; baseUpdatedAt?: string | null; baseContent?: string };
export type TodoOperation = {
  id: string;
  userId: string;
  kind: 'create' | 'complete';
  payload: Record<string, unknown>;
  createdAt: number;
  attempts: number;
  state: 'pending' | 'failed' | 'conflict';
  error?: string;
};

export function reconcileDiaryDraft(draft: DiaryDraft | null, server: { content: string; updatedAt: string } | null) {
  if (!draft || draft.content === (server?.content ?? '')) return { kind: 'current' as const, content: server?.content ?? '' };
  const serverRevision = server?.updatedAt ?? null;
  if (draft.baseUpdatedAt === serverRevision) return { kind: 'draft' as const, content: draft.content };
  return { kind: 'conflict' as const, content: draft.content, local: draft.content, server: server?.content ?? '', updatedAt: serverRevision };
}
const databaseName = 'daybook-private-drafts';
const storeName = 'diary';
const operationsStore = 'todo-operations';

function openDraftDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return reject(new Error('Draft storage is unavailable.'));
    const request = indexedDB.open(databaseName, 3);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(storeName)) request.result.createObjectStore(storeName, { keyPath: 'id' });
      if (!request.result.objectStoreNames.contains(operationsStore)) request.result.createObjectStore(operationsStore, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Draft storage could not be opened.'));
  });
}

export async function putDiaryDraft(draft: DiaryDraft) {
  try {
    const db = await openDraftDb();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(storeName, 'readwrite');
      transaction.objectStore(storeName).put({ ...draft, id: `${draft.userId}:${draft.date}` });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    db.close();
  } catch {
    try { localStorage.setItem(`daybook-diary-draft:${draft.userId}:${draft.date}`, JSON.stringify(draft)); } catch { /* The editor still retains its in-memory copy. */ }
  }
}

export async function getDiaryDraft(userId: string, date: string): Promise<DiaryDraft | null> {
  try {
    const db = await openDraftDb();
    const draft = await new Promise<DiaryDraft | null>((resolve, reject) => {
      const request = db.transaction(storeName, 'readonly').objectStore(storeName).get(`${userId}:${date}`);
      request.onsuccess = () => resolve((request.result as DiaryDraft | undefined) ?? null);
      request.onerror = () => reject(request.error);
    });
    db.close();
    if (draft) return draft;
  } catch { /* Try the browser fallback below. */ }
  try { return JSON.parse(localStorage.getItem(`daybook-diary-draft:${userId}:${date}`) ?? 'null') as DiaryDraft | null; } catch { return null; }
}

export async function clearDiaryDraft(userId: string, date: string) {
  try {
    const db = await openDraftDb();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(storeName, 'readwrite');
      transaction.objectStore(storeName).delete(`${userId}:${date}`);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    db.close();
  } catch { /* Clear the fallback and continue. */ }
  try { localStorage.removeItem(`daybook-diary-draft:${userId}:${date}`); } catch { /* No-op. */ }
}

export async function clearDiaryDraftsForUser(userId: string) {
  try {
    const db = await openDraftDb();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(storeName, 'readwrite');
      const request = transaction.objectStore(storeName).openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        if ((cursor.value as DiaryDraft & { id: string }).userId === userId) cursor.delete();
        cursor.continue();
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    db.close();
  } catch { /* Clear localStorage fallback too. */ }
  try {
    for (let i = localStorage.length - 1; i >= 0; i -= 1) {
      const key = localStorage.key(i);
      if (key?.startsWith(`daybook-diary-draft:${userId}:`)) localStorage.removeItem(key);
    }
  } catch { /* Best effort where browser storage is disabled. */ }
}

function withOperationStore<T>(operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDraftDb().then((db) => new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(operationsStore, 'readwrite');
    const request = operation(transaction.objectStore(operationsStore));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => db.close();
    transaction.onerror = () => { db.close(); reject(transaction.error); };
  }));
}

function notifyQueueChanged() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('daybook-queue-updated'));
}

export async function enqueueTodoOperation(operation: TodoOperation) {
  if (operation.kind === 'complete') {
    const existing = (await listTodoOperations(operation.userId)).find((item) => item.kind === 'complete' && item.payload.todoId === operation.payload.todoId);
    if (existing) {
      if (existing.state === 'conflict') return;
      await withOperationStore((store) => store.put({ ...existing, payload: { ...existing.payload, completed: operation.payload.completed }, state: 'pending', error: undefined }));
      notifyQueueChanged();
      return;
    }
  }
  await withOperationStore((store) => store.put(operation));
  notifyQueueChanged();
}

export async function listTodoOperations(userId: string): Promise<TodoOperation[]> {
  const all = await withOperationStore((store) => store.getAll());
  return (all as TodoOperation[]).filter((operation) => operation.userId === userId).sort((a, b) => a.createdAt - b.createdAt);
}

export async function updateTodoOperation(operation: TodoOperation, notify = true) {
  await withOperationStore((store) => store.put(operation));
  if (notify) notifyQueueChanged();
}

export async function removeTodoOperation(id: string) {
  await withOperationStore((store) => store.delete(id));
  notifyQueueChanged();
}

export async function clearTodoOperationsForUser(userId: string) {
  const operations = await listTodoOperations(userId);
  await Promise.all(operations.map((operation) => removeTodoOperation(operation.id)));
}
