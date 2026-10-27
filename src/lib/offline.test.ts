import assert from 'node:assert/strict';
import test from 'node:test';
import { reconcileDiaryDraft, type DiaryDraft } from './diaryDrafts.js';
import { clearUserOfflineData, getOfflineIdentity, rememberIdentity, retryTodoOperation, todoSyncFailureState } from './offline.js';

const draft: DiaryDraft = { userId: 'user-1', date: '2026-10-22', content: 'Local note', savedAt: 1, baseUpdatedAt: '2026-10-21T08:00:00.000Z', baseContent: 'Old note' };

test('diary draft recovery recognizes a current server copy', () => {
  assert.deepEqual(reconcileDiaryDraft({ ...draft, content: 'Same' }, { content: 'Same', updatedAt: '2026-10-22T08:00:00.000Z' }), { kind: 'current', content: 'Same' });
});

test('diary draft recovery only resumes autosave when its server revision is unchanged', () => {
  assert.deepEqual(reconcileDiaryDraft(draft, { content: 'Old note', updatedAt: draft.baseUpdatedAt! }), { kind: 'draft', content: 'Local note' });
});

test('a stale or unversioned diary draft is kept as a conflict instead of overwriting server text', () => {
  assert.deepEqual(reconcileDiaryDraft(draft, { content: 'Newer server text', updatedAt: '2026-10-22T09:00:00.000Z' }), {
    kind: 'conflict', content: 'Local note', local: 'Local note', server: 'Newer server text', updatedAt: '2026-10-22T09:00:00.000Z'
  });
  assert.equal(reconcileDiaryDraft({ ...draft, baseUpdatedAt: undefined }, null).kind, 'conflict');
});

test('sign-out cleanup removes the user identity and localStorage diary drafts', async () => {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    get length() { return values.size; },
    key(index: number) { return [...values.keys()][index] ?? null; },
    getItem(key: string) { return values.get(key) ?? null; },
    setItem(key: string, value: string) { values.set(key, value); },
    removeItem(key: string) { values.delete(key); }
  } });
  rememberIdentity({ id: 'user-1', email: 'person@example.com' });
  values.set('daybook-diary-draft:user-1:2026-10-22', JSON.stringify(draft));
  values.set('daybook-diary-draft:user-2:2026-10-22', 'keep');
  await clearUserOfflineData('user-1');
  assert.equal(getOfflineIdentity(), null);
  assert.equal(values.has('daybook-diary-draft:user-1:2026-10-22'), false);
  assert.equal(values.get('daybook-diary-draft:user-2:2026-10-22'), 'keep');
  delete (globalThis as { localStorage?: Storage }).localStorage;
});

test('queued task retries distinguish retryable failures from revision conflicts', () => {
  const failed = { id: 'op-1', userId: 'user-1', kind: 'create' as const, payload: { title: 'Offline task' }, createdAt: 1, attempts: 1, state: 'failed' as const, error: 'API unavailable' };
  assert.equal(retryTodoOperation(failed).state, 'pending');
  assert.equal(retryTodoOperation({ ...failed, state: 'conflict' }).state, 'conflict');
  assert.equal(todoSyncFailureState(503), 'failed');
  assert.equal(todoSyncFailureState(409), 'conflict');
});
