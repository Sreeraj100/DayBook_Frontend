import { api, ApiRequestError } from './api.js';
import { clearDiaryDraftsForUser, clearTodoOperationsForUser, listTodoOperations, removeTodoOperation, updateTodoOperation, type TodoOperation } from './diaryDrafts.js';
import type { User } from './api.js';

const identityKey = 'daybook-offline-identity';
const pendingLogoutKey = 'daybook-pending-logout';
const activeSyncs = new Set<string>();

export function retryTodoOperation(operation: TodoOperation): TodoOperation {
  return operation.state === 'failed' ? { ...operation, state: 'pending', error: undefined } : operation;
}
export function todoSyncFailureState(status?: number): TodoOperation['state'] {
  return status === 404 || status === 409 ? 'conflict' : 'failed';
}

export function getOfflineIdentity(): User | null {
  try { return JSON.parse(localStorage.getItem(identityKey) ?? 'null') as User | null; } catch { return null; }
}
export function rememberIdentity(user: User | null) {
  try { if (user) localStorage.setItem(identityKey, JSON.stringify(user)); else localStorage.removeItem(identityKey); } catch { /* Identity is only a convenience for the app shell. */ }
}
export function hasPendingLogout() { try { return localStorage.getItem(pendingLogoutKey) === 'true'; } catch { return false; } }
export function setPendingLogout(pending: boolean) { try { if (pending) localStorage.setItem(pendingLogoutKey, 'true'); else localStorage.removeItem(pendingLogoutKey); } catch { /* Storage can be disabled. */ } }

export async function clearUserOfflineData(userId: string) {
  await Promise.allSettled([clearDiaryDraftsForUser(userId), clearTodoOperationsForUser(userId)]);
  rememberIdentity(null);
}

export async function syncTodoQueue(userId: string) {
  if (activeSyncs.has(userId)) return;
  activeSyncs.add(userId);
  try {
    const operations = await listTodoOperations(userId);
    for (const operation of operations) {
      if (!navigator.onLine) break;
      if (operation.state === 'conflict' || operation.state === 'failed') continue;
      try {
        if (operation.kind === 'create') await api('/todos', { method: 'POST', body: JSON.stringify({ ...operation.payload, clientRequestId: operation.id }) });
        else await api(`/todos/${String(operation.payload.todoId)}/completion`, { method: 'POST', body: JSON.stringify({ completed: operation.payload.completed, expectedUpdatedAt: operation.payload.expectedUpdatedAt }) });
        await removeTodoOperation(operation.id);
      } catch (error) {
        const latest: TodoOperation = {
          ...operation,
          attempts: operation.attempts + 1,
          state: todoSyncFailureState(error instanceof ApiRequestError ? error.status : undefined),
          error: error instanceof Error ? error.message : 'Could not synchronize this task.'
        };
        await updateTodoOperation(latest);
      }
    }
  } finally { activeSyncs.delete(userId); }
}

export async function retryFailedTodoOperations(userId: string) {
  const operations = await listTodoOperations(userId);
  await Promise.all(operations.filter((item) => item.state === 'failed').map((item) => updateTodoOperation(retryTodoOperation(item), false)));
  await syncTodoQueue(userId);
}

