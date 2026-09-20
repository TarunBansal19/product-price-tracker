import { getSupabase } from './client.js';

/**
 * Executes a Supabase RPC function with error propagation.
 */
async function callRpc(name, params) {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc(name, params);
  if (error) {
    const err = new Error(`RPC ${name} failed: ${error.message} (${error.code || 'NO_CODE'})`);
    err.code = error.code || 'DB_RPC_ERROR';
    err.details = error.details;
    throw err;
  }
  return data;
}

export const repo = {
  async claimCronRun(slotDate, leaseSeconds = 1800) {
    return callRpc('claim_cron_run', {
      p_slot: slotDate.toISOString(),
      p_lease_seconds: leaseSeconds
    });
  },

  async claimManualRun(trigger = 'manual', leaseSeconds = 600) {
    return callRpc('claim_manual_run', {
      p_trigger: trigger,
      p_lease_seconds: leaseSeconds
    });
  },

  async claimProduct(productId, leaseSeconds = 120) {
    return callRpc('claim_product', {
      p_product_id: productId,
      p_lease_seconds: leaseSeconds
    });
  },

  async releaseProduct(productId) {
    return callRpc('release_product', {
      p_product_id: productId
    });
  },

  async beginAttempt({ runId, trackedProductId, attemptNumber, strategy = 'browser', scraperVersion = '1.0.0' }) {
    return callRpc('begin_attempt', {
      p_run_id: runId,
      p_product_id: trackedProductId,
      p_attempt_no: attemptNumber,
      p_strategy: strategy,
      p_version: scraperVersion
    });
  },

  async finishAttemptFailed({ attemptId, outcome, errorCode, errorMessage, httpStatus = null, debug = null }) {
    return callRpc('finish_attempt_failed', {
      p_attempt_id: attemptId,
      p_outcome: outcome,
      p_code: errorCode,
      p_message: errorMessage || '',
      p_http_status: httpStatus,
      p_debug: debug
    });
  },

  async finishAttemptSuccess({ attemptId, observation }) {
    const payload = {
      observed_at: observation.observed_at || observation.observedAt,
      price_minor: observation.price_minor || (observation.priceMinor !== undefined ? String(observation.priceMinor) : null),
      currency: observation.currency,
      stock_state: observation.stock_state || observation.stockState,
      stock_quantity: observation.stock_quantity !== undefined ? observation.stock_quantity : (observation.stockQuantity ?? null),
      list_price_minor: observation.list_price_minor || (observation.listPriceMinor !== undefined ? String(observation.listPriceMinor) : null),
      raw_price_text: observation.raw_price_text || observation.rawPriceText,
      raw_stock_text: observation.raw_stock_text || observation.rawStockText,
      price_source: observation.price_source || observation.priceSource,
      cross_checked: observation.cross_checked !== undefined ? observation.cross_checked : (observation.crossChecked ?? false)
    };

    return callRpc('finish_attempt_success', {
      p_attempt_id: attemptId,
      p_observation: payload
    });
  },

  async finishRun({ runId, status, productsTotal, productsOk, productsFailed, note = null }) {
    return callRpc('finish_run', {
      p_run_id: runId,
      p_status: status,
      p_products_total: productsTotal,
      p_products_ok: productsOk,
      p_products_failed: productsFailed,
      p_note: note
    });
  },

  async sweepStale() {
    return callRpc('sweep_stale', {});
  },

  async pruneDebug(olderThanIso) {
    return callRpc('prune_debug', {
      p_older_than: olderThanIso
    });
  },

  async upsertCatalogProducts(items) {
    if (!items || items.length === 0) return { count: 0 };
    const supabase = getSupabase();
    const rows = items.map(item => ({
      store_product_id: String(item.id),
      name: item.name,
      name_search: item.name.toLowerCase().normalize('NFKC').replace(/[\u200B-\u200D\uFEFF]/g, '').trim(),
      category: item.category || null,
      image_url: item.image_url || item.imageUrl || null,
      attributes: {
        brand: item.brand,
        sku: item.sku,
        description: item.description
      },
      last_seen_at: new Date().toISOString()
    }));

    const { error, count } = await supabase
      .from('catalog_products')
      .upsert(rows, { onConflict: 'store_product_id' });

    if (error) throw new Error(`upsertCatalogProducts failed: ${error.message}`);
    return { count: rows.length };
  },

  async searchCatalog({ query = '', limit = 20, offset = 0 }) {
    const supabase = getSupabase();
    let q = supabase
      .from('catalog_products')
      .select('store_product_id, name, category, image_url, attributes, delisted_at', { count: 'exact' });

    const trimmed = (query || '').trim();
    if (trimmed) {
      // Escape SQL wildcards %, _, \
      const escaped = trimmed.replace(/[%_\\]/g, '\\$&').toLowerCase();
      q = q.ilike('name_search', `%${escaped}%`);
    }

    q = q.is('delisted_at', null)
      .order('name', { ascending: true })
      .range(offset, offset + limit - 1);

    const { data, count, error } = await q;
    if (error) throw new Error(`searchCatalog failed: ${error.message}`);
    return { items: data || [], total: count || 0 };
  },

  async trackProduct({ storeProductId, name, category = null, imageUrl = null, attributes = {} }) {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('tracked_products')
      .upsert(
        {
          store_product_id: String(storeProductId),
          name,
          category,
          image_url: imageUrl,
          attributes,
          is_active: true,
          deactivated_at: null
        },
        { onConflict: 'store_product_id' }
      )
      .select()
      .single();

    if (error) throw new Error(`trackProduct failed: ${error.message}`);
    return data;
  },

  async deactivateTrackedProduct(id) {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('tracked_products')
      .update({ is_active: false, deactivated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) throw new Error(`deactivateTrackedProduct failed: ${error.message}`);
    return data;
  },

  async getActiveTrackedProducts(limit = 15) {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('tracked_products')
      .select('*')
      .eq('is_active', true)
      .order('added_at', { ascending: true })
      .limit(limit);

    if (error) throw new Error(`getActiveTrackedProducts failed: ${error.message}`);
    return data || [];
  },

  async getTrackedProducts() {
    const supabase = getSupabase();
    // Fetch tracked products with their latest observation and attempt outcome
    const { data: products, error: pErr } = await supabase
      .from('tracked_products')
      .select('*')
      .order('added_at', { ascending: false });

    if (pErr) throw new Error(`getTrackedProducts failed: ${pErr.message}`);
    if (!products || products.length === 0) return [];

    // For each product, retrieve the latest observation and last attempt
    const results = await Promise.all(
      products.map(async p => {
        const { data: obs } = await supabase
          .from('price_observations')
          .select('*')
          .eq('tracked_product_id', p.id)
          .order('observed_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        const { data: lastAttempt } = await supabase
          .from('scrape_attempts')
          .select('outcome, error_code, started_at, duration_ms, attempt_number')
          .eq('tracked_product_id', p.id)
          .order('started_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        return {
          ...p,
          latestObservation: obs || null,
          lastAttempt: lastAttempt || null
        };
      })
    );

    return results;
  },

  async getTrackedProduct(id) {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('tracked_products')
      .select('*')
      .eq('id', id)
      .single();

    if (error) throw new Error(`getTrackedProduct failed: ${error.message}`);
    return data;
  },

  async getTrackedProductByStoreId(storeProductId) {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('tracked_products')
      .select('*')
      .eq('store_product_id', String(storeProductId))
      .maybeSingle();

    if (error) throw new Error(`getTrackedProductByStoreId failed: ${error.message}`);
    return data;
  },

  async getObservationHistory(trackedProductId, { from, to, limit = 500 } = {}) {
    const supabase = getSupabase();
    let q = supabase
      .from('price_observations')
      .select('*')
      .eq('tracked_product_id', trackedProductId)
      .order('observed_at', { ascending: true })
      .limit(limit);

    if (from) q = q.gte('observed_at', from);
    if (to) q = q.lte('observed_at', to);

    const { data, error } = await q;
    if (error) throw new Error(`getObservationHistory failed: ${error.message}`);
    return data || [];
  },

  async getAttemptLog(trackedProductId, { limit = 50, before = null, outcome = null } = {}) {
    const supabase = getSupabase();
    let q = supabase
      .from('scrape_attempts')
      .select('id, run_id, attempt_number, started_at, finished_at, duration_ms, outcome, error_code, error_message, http_status, strategy, scraper_version, scrape_runs(scheduled_slot), price_observations(price_minor, currency, stock_state, stock_quantity)')
      .eq('tracked_product_id', trackedProductId)
      .order('started_at', { ascending: false })
      .limit(limit);

    if (before) q = q.lt('started_at', before);
    if (outcome) q = q.eq('outcome', outcome);

    const { data, error } = await q;
    if (error) throw new Error(`getAttemptLog failed: ${error.message}`);
    
    // Flatten scheduled_slot for convenience
    return (data || []).map(row => ({
      ...row,
      scheduled_slot: row.scrape_runs?.scheduled_slot || null,
      observation: Array.isArray(row.price_observations) ? row.price_observations[0] : row.price_observations
    }));
  },

  async getHealthStats() {
    const supabase = getSupabase();

    const [lastRunRes, lastObsRes, activeCountRes] = await Promise.all([
      supabase
        .from('scrape_runs')
        .select('*')
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('price_observations')
        .select('observed_at')
        .order('observed_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('tracked_products')
        .select('*', { count: 'exact', head: true })
        .eq('is_active', true)
    ]);

    const lastRun = lastRunRes.data;
    const lastObs = lastObsRes.data;
    const activeCount = activeCountRes.count;

    const now = Date.now();
    const lastSuccessMs = lastObs?.observed_at ? new Date(lastObs.observed_at).getTime() : 0;
    // Stale if active products exist and last success > 3h ago
    const isStale = (activeCount || 0) > 0 && (now - lastSuccessMs > 3 * 3600 * 1000);

    return {
      lastRun: lastRun || null,
      lastSuccessfulObservationAt: lastObs?.observed_at || null,
      activeTrackedCount: activeCount || 0,
      stale: isStale
    };
  }
};
