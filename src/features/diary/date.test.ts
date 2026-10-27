import assert from 'node:assert/strict';
import test from 'node:test';
import { formatDate, shiftDate } from './dates.js';

test('date navigation moves across month ends and leap days using local calendar dates', () => {
  assert.equal(shiftDate('2025-01-31', 1), '2025-02-01');
  assert.equal(shiftDate('2024-02-28', 1), '2024-02-29');
  assert.equal(shiftDate('2024-03-01', -1), '2024-02-29');
});

test('diary date headings format the selected calendar day', () => {
  assert.equal(formatDate('2026-10-11', { weekday: 'long' }), 'Sunday');
});
