const SHA256_HEX = /^[a-f0-9]{64}$/i;

export const CURRENT_INPUT_HASH_VERSION = 'study-input-v3';
export const LEGACY_UNVERSIONED_INPUT_HASH = 'legacy-unversioned';

/**
 * Preserve old stored digests exactly while refusing to guess which historical
 * algorithm produced an unversioned value. This makes the record traceable,
 * but never comparable across versions by implication.
 */
export function resolveInputHashLineage({ hash, version } = {}) {
  if (typeof hash !== 'string' || !hash.length) {
    return Object.freeze({ hash: null, version: null, status: 'NOT_RECORDED', crossVersionComparable: false });
  }
  if (!SHA256_HEX.test(hash)) {
    return Object.freeze({ hash, version: null, status: 'MALFORMED', crossVersionComparable: false });
  }
  if (typeof version === 'string' && version.trim()) {
    const normalizedVersion = version.trim();
    return Object.freeze({
      hash,
      version: normalizedVersion,
      status: normalizedVersion === CURRENT_INPUT_HASH_VERSION
        ? 'CURRENT_VERSIONED'
        : normalizedVersion === LEGACY_UNVERSIONED_INPUT_HASH
          ? 'LEGACY_UNVERSIONED'
          : 'OTHER_VERSIONED',
      crossVersionComparable: false,
    });
  }
  return Object.freeze({
    hash,
    version: LEGACY_UNVERSIONED_INPUT_HASH,
    status: 'LEGACY_UNVERSIONED',
    crossVersionComparable: false,
  });
}

/**
 * Attach an explicit input-hash version to a result without changing the
 * stored digest. Older records therefore remain inspectable/exportable as
 * legacy-unversioned instead of being silently upgraded to the current hash.
 */
export function withInputHashLineage(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return result;
  const meta = result.meta && typeof result.meta === 'object' ? result.meta : {};
  const hashes = meta.hashes && typeof meta.hashes === 'object' ? meta.hashes : {};
  const lineage = resolveInputHashLineage({
    hash: hashes.input || meta.inputHash || meta.reproducibility?.inputHash || null,
    version: hashes.inputVersion || meta.inputHashVersion || meta.reproducibility?.inputHashVersion || null,
  });
  return {
    ...result,
    meta: {
      ...meta,
      inputHash: lineage.hash,
      inputHashVersion: lineage.version,
      inputHashLineage: lineage,
      hashes: {
        ...hashes,
        input: lineage.hash,
        inputVersion: lineage.version,
      },
    },
  };
}
