/**
 * store/catalogClient.js - Lightweight HTTP client for catalog fetching and synchronization.
 */

import { buildApiUrl } from './urls.js';
import { repo } from '../db/repo.js';
import { isDbConfigured } from '../db/client.js';
import { withTimeout } from '../runner/retry.js';

/**
 * Fetches a single page of the store catalog via plain HTTP.
 */
export async function fetchCatalogPage({ page = 1, pageSize = 20, timeoutMs = 10000 } = {}) {
  const url = buildApiUrl(`/api/catalog?page=${page}&pageSize=${pageSize}`);
  const ac = new AbortController();

  return await withTimeout(
    async () => {
      const res = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: ac.signal
      });

      if (!res.ok) {
        throw new Error(`Catalog API responded with HTTP ${res.status}`);
      }

      return await res.json();
    },
    timeoutMs,
    { signal: ac.signal, label: `catalog_page_${page}` }
  );
}

/**
 * Crawls the store catalog and synchronizes it with the DB.
 */
export async function syncCatalog({ onProgress = null } = {}) {
  const notify = (msg) => {
    if (onProgress) onProgress(msg);
  };

  notify('Starting catalog synchronization via lightweight HTTP...');
  const firstPage = await fetchCatalogPage({ page: 1, pageSize: 50 });
  const totalPages = firstPage.pages || 1;
  const totalItems = firstPage.total || 0;

  notify(`Catalog reports ${totalItems} items across ${totalPages} pages.`);

  let allItems = [...(firstPage.items || [])];
  if (isDbConfigured()) {
    await repo.upsertCatalogProducts(firstPage.items || []);
  }

  let failedPages = 0;

  for (let p = 2; p <= totalPages; p++) {
    try {
      notify(`Fetching catalog page ${p}/${totalPages}...`);
      const pageData = await fetchCatalogPage({ page: p, pageSize: 50 });
      if (pageData.items && pageData.items.length > 0) {
        allItems = allItems.concat(pageData.items);
        if (isDbConfigured()) {
          await repo.upsertCatalogProducts(pageData.items);
        }
      }
      // Small pause between pages
      await new Promise(r => setTimeout(r, 100));
    } catch (err) {
      console.warn(`[catalog] Failed to fetch page ${p}: ${err.message}`);
      failedPages++;
    }
  }

  notify(`Catalog sync completed. Crawled ${allItems.length} products. Failed pages: ${failedPages}.`);

  return {
    success: failedPages === 0,
    totalCrawled: allItems.length,
    failedPages
  };
}
