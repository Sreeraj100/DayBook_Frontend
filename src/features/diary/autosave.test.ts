import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAutosaver, type SaveState } from './autosave.js';

test('autosave debounces to the latest draft', async () => {
  const saved: string[] = [];
  const states: SaveState[] = [];
  const saver = createAutosaver(async (content) => { saved.push(content); }, (state) => states.push(state), 10);
  saver.schedule('first');
  saver.schedule('latest');
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual(saved, ['latest']);
  assert.equal(states.at(-1), 'saved');
});

test('autosave reports network errors and can retry without losing its content', async () => {
  let attempts = 0;
  const states: SaveState[] = [];
  const saver = createAutosaver(async (content) => { assert.equal(content, 'kept draft'); attempts += 1; if (attempts === 1) throw new Error('offline'); }, (state) => states.push(state), 10000);
  saver.schedule('kept draft');
  await saver.flush();
  assert.equal(states.at(-1), 'error');
  await saver.flush();
  assert.equal(states.at(-1), 'saved');
  assert.equal(attempts, 2);
});
