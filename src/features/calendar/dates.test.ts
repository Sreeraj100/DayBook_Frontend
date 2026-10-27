import assert from 'node:assert/strict';
import { test } from 'node:test';
import { boundsFor, shiftDate } from './dates.js';

test('calendar month navigation clamps at month ends and keeps leap days', () => {
  const janEnd = shiftDate(new Date(2026, 0, 31, 12), 'month', 1);
  assert.equal(`${janEnd.getFullYear()}-${janEnd.getMonth() + 1}-${janEnd.getDate()}`, '2026-2-28');
  const leapDay = shiftDate(new Date(2024, 0, 31, 12), 'month', 1);
  assert.equal(`${leapDay.getFullYear()}-${leapDay.getMonth() + 1}-${leapDay.getDate()}`, '2024-2-29');
});

test('week bounds begin Sunday and contain exactly seven local days', () => {
  const selected = new Date(2026, 10, 1, 12);
  const bounds = boundsFor('week', selected);
  const from = new Date(bounds.from); const to = new Date(bounds.to);
  assert.equal(from.getDay(), 0);
  assert.equal((to.getTime() - from.getTime()) / 86400000, 7);
});
