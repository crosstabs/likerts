/** Deterministic origin-wide Web Locks substitute for storage/UI tests. */
export function createLocks() {
  const pending = new Map();
  return { active: 0, maximumActive: 0,
    request(name, options, callback) {
      if (options.mode !== 'exclusive') throw new Error('Expected an exclusive quiz write lock');
      const prior = pending.get(name) || Promise.resolve();
      const current = prior.then(async () => {
        this.active++; this.maximumActive = Math.max(this.maximumActive, this.active);
        try { return await callback({ name, mode: 'exclusive' }); }
        finally { this.active--; }
      });
      pending.set(name, current.catch(() => {}));
      return current;
    },
  };
}

export function createStorage() {
  const values = new Map();
  return { values, locks: createLocks(), writes: 0, failWrite: false, failRead: false,
    getItem(key) { if (this.failRead) throw new Error('Read failed'); return values.get(key) ?? null; },
    setItem(key, value) { if (this.failWrite) throw new Error('Storage full'); this.writes++; values.set(key, value); },
    removeItem(key) { if (this.failWrite) throw new Error('Remove failed'); values.delete(key); },
  };
}
