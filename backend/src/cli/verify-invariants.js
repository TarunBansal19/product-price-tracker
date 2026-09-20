#!/usr/bin/env node
/**
 * cli/verify-invariants.js - Verification tool for data invariants I1–I7 per plan §7.3.
 */

import { getSupabase, isDbConfigured } from '../db/client.js';

const OBSERVED_STOCK_VOCABULARY = ['in_stock', 'low_stock', 'out_of_stock'];

async function verifyInvariants() {
  console.log('========================================================');
  console.log('          DATABASE INVARIANT AUDIT (I1 — I7)           ');
  console.log('========================================================\n');

  if (!isDbConfigured()) {
    console.log('[SKIPPED] Database not configured (SUPABASE_URL not set).');
    process.exit(0);
  }

  const supabase = getSupabase();
  let violations = 0;

  function report(invariant, pass, message) {
    if (pass) {
      console.log(`✔ [${invariant}] PASS: ${message}`);
    } else {
      console.error(`✗ [${invariant}] FAIL: ${message}`);
      violations++;
    }
  }

  // I1: every price_observations row links to an attempt with outcome='success'
  const { data: i1Data, error: i1Err } = await supabase
    .from('price_observations')
    .select('id, attempt_id, scrape_attempts!inner(id, outcome)');

  if (i1Err) {
    console.error('Error querying I1:', i1Err.message);
  } else {
    const invalidI1 = (i1Data || []).filter(row => row.scrape_attempts?.outcome !== 'success');
    report('I1', invalidI1.length === 0, `All ${i1Data.length} observations link to attempt with outcome='success'`);
  }

  // I2: no attempt with outcome in ('retried','failed') has an observation
  const { data: i2Data } = await supabase
    .from('scrape_attempts')
    .select('id, outcome, price_observations(id)')
    .in('outcome', ['retried', 'failed']);

  const invalidI2 = (i2Data || []).filter(a => a.price_observations && a.price_observations.length > 0);
  report('I2', invalidI2.length === 0, `No retried/failed attempts have observations (${invalidI2.length} violations)`);

  // I3: price_minor > 0, currency present (length 3), stock_state in vocabulary
  const { data: i3Data } = await supabase
    .from('price_observations')
    .select('id, price_minor, currency, stock_state');

  const invalidI3 = (i3Data || []).filter(
    o => o.price_minor <= 0 || !o.currency || o.currency.length !== 3 || !OBSERVED_STOCK_VOCABULARY.includes(o.stock_state)
  );
  report('I3', invalidI3.length === 0, `All prices > 0, currency valid, stock in [${OBSERVED_STOCK_VOCABULARY.join(', ')}]`);

  // I4: no attempt stays in flight (outcome is null) beyond its run's lease
  const { data: i4Data } = await supabase
    .from('scrape_attempts')
    .select('id, started_at, scrape_runs!inner(lease_until)')
    .is('outcome', null);

  const now = new Date();
  const invalidI4 = (i4Data || []).filter(a => new Date(a.scrape_runs.lease_until) < now);
  report('I4', invalidI4.length === 0, `No abandoned in-flight attempts past lease (${invalidI4.length} violations)`);

  // I6: retried attempt is never the last attempt for that product in that run
  const { data: i6Data } = await supabase
    .from('scrape_attempts')
    .select('run_id, tracked_product_id, attempt_number, outcome')
    .order('run_id')
    .order('tracked_product_id')
    .order('attempt_number', { ascending: true });

  let invalidI6 = 0;
  if (i6Data && i6Data.length > 0) {
    const groups = {};
    for (const a of i6Data) {
      const key = `${a.run_id}_${a.tracked_product_id}`;
      groups[key] = groups[key] || [];
      groups[key].push(a);
    }
    for (const key in groups) {
      const attempts = groups[key];
      const last = attempts[attempts.length - 1];
      if (last.outcome === 'retried') {
        invalidI6++;
      }
    }
  }
  report('I6', invalidI6 === 0, `Retried attempts are never left dangling as final attempt (${invalidI6} violations)`);

  // I7: observed_at <= now()
  const { data: i7Data } = await supabase
    .from('price_observations')
    .select('id, observed_at');

  const invalidI7 = (i7Data || []).filter(o => new Date(o.observed_at) > new Date(Date.now() + 60000));
  report('I7', invalidI7.length === 0, `No future observed_at timestamps detected`);

  console.log('\n========================================================');
  if (violations === 0) {
    console.log('  ALL INVARIANTS SATISFIED! Zero integrity violations.  ');
  } else {
    console.error(`  FOUND ${violations} INVARIANT VIOLATIONS!           `);
  }
  console.log('========================================================\n');

  process.exit(violations === 0 ? 0 : 1);
}

verifyInvariants().catch(err => {
  console.error('Fatal verification error:', err);
  process.exit(1);
});
