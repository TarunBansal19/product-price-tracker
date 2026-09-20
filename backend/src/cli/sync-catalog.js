#!/usr/bin/env node
/**
 * cli/sync-catalog.js - CLI to sync the store catalog into the database.
 */

import { syncCatalog } from '../store/catalogClient.js';

async function main() {
  console.log('=== SYNCING STORE CATALOG ===');
  const result = await syncCatalog({
    onProgress: (msg) => console.log(`[sync] ${msg}`)
  });
  console.log('Sync result:', result);
}

main().catch(err => {
  console.error('Fatal sync error:', err);
  process.exit(1);
});
