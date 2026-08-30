import assert from 'node:assert/strict';
import test from 'node:test';

import { CJK_LOCALE_IDS, LOCALE_CAPABILITIES } from '../shared/localization.mjs';
import { CJK_UI_CATALOGS } from '../src/i18nCatalog.mjs';
import {
  CURRENT_LOCALIZATION_CATALOG_HASH,
  deriveLocalizationCatalogHash,
  localizationCatalogHashPayload,
} from '../server/localization-catalog-hash.js';

function clonedCatalogs() {
  return structuredClone(CJK_UI_CATALOGS);
}

test('current localization catalog hash is canonical and independent of object insertion order', () => {
  assert.match(CURRENT_LOCALIZATION_CATALOG_HASH, /^sha256:[a-f0-9]{64}$/);
  assert.equal(deriveLocalizationCatalogHash(), CURRENT_LOCALIZATION_CATALOG_HASH);

  const reversedCatalogs = Object.fromEntries([...CJK_LOCALE_IDS].reverse().map((localeId) => [
    localeId,
    Object.fromEntries(Object.entries(CJK_UI_CATALOGS[localeId]).reverse()),
  ]));
  assert.equal(
    deriveLocalizationCatalogHash({ catalogs: reversedCatalogs }),
    CURRENT_LOCALIZATION_CATALOG_HASH,
  );
  assert.deepEqual(
    localizationCatalogHashPayload().locales.map((entry) => entry.localeId),
    [...CJK_LOCALE_IDS].sort(),
  );
});

test('translation and registry provenance mutations change the localization catalog hash', () => {
  const catalogs = clonedCatalogs();
  catalogs['ja-JP'].free = `${catalogs['ja-JP'].free} 変更`;
  assert.notEqual(deriveLocalizationCatalogHash({ catalogs }), CURRENT_LOCALIZATION_CATALOG_HASH);

  const localeCapabilities = structuredClone(LOCALE_CAPABILITIES);
  localeCapabilities['ko-KR'].release.copyStatus = 'native-reviewed';
  assert.notEqual(
    deriveLocalizationCatalogHash({ localeCapabilities }),
    CURRENT_LOCALIZATION_CATALOG_HASH,
  );
});
