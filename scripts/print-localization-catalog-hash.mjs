#!/usr/bin/env node

import {
  CURRENT_LOCALIZATION_CATALOG_HASH,
  LOCALIZATION_CATALOG_HASH_SCHEMA_VERSION,
} from '../server/localization-catalog-hash.js';
import { LOCALIZATION_REGISTRY_VERSION } from '../shared/localization.mjs';

process.stdout.write(`${JSON.stringify({
  schemaVersion: LOCALIZATION_CATALOG_HASH_SCHEMA_VERSION,
  registryVersion: LOCALIZATION_REGISTRY_VERSION,
  catalogHash: CURRENT_LOCALIZATION_CATALOG_HASH,
}, null, 2)}\n`);
