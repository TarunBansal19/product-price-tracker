import test from 'node:test';
import assert from 'node:assert/strict';
import { computeCronSlot } from '../../src/routes/cron.js';

test('routes/cron.js slot calculation', async t => {
  await t.test('computes identical slot for slightly early and slightly late triggers', () => {
    // Exactly at 02:00 UTC
    const exact = new Date('2026-09-20T02:00:00.000Z');
    assert.equal(computeCronSlot(exact).toISOString(), '2026-09-20T02:00:00.000Z');

    // 10 minutes early at 01:50 UTC -> maps to 02:00 slot
    const early = new Date('2026-09-20T01:50:00.000Z');
    assert.equal(computeCronSlot(early).toISOString(), '2026-09-20T02:00:00.000Z');

    // 25 minutes late at 02:25 UTC -> still maps to 02:00 slot
    const late = new Date('2026-09-20T02:25:00.000Z');
    assert.equal(computeCronSlot(late).toISOString(), '2026-09-20T02:00:00.000Z');

    // 1 hour late at 03:00 UTC -> still maps to 02:00 slot (since 03:00 + 15m = 03:15, floor/2h is 02:00)
    const veryLate = new Date('2026-09-20T03:00:00.000Z');
    assert.equal(computeCronSlot(veryLate).toISOString(), '2026-09-20T02:00:00.000Z');

    // Next slot: 03:50 UTC maps to 04:00 slot
    const nextEarly = new Date('2026-09-20T03:50:00.000Z');
    assert.equal(computeCronSlot(nextEarly).toISOString(), '2026-09-20T04:00:00.000Z');
  });
});
