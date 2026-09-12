const DEFAULTS = { maxRecords: 1000, maxBytes: 10 * 1024 * 1024, maxAgeSeconds: 7 * 86400 }, HARD = { maxRecords: 10000, maxBytes: 100 * 1024 * 1024, maxAgeSeconds: 30 * 86400 }, MAX_RECORD = 65536;
const encoder = new TextEncoder(), decoder = new TextDecoder();
const canonical = (value) => JSON.stringify(value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, JSON.parse(canonical(v))])) : Array.isArray(value) ? value.map(v => JSON.parse(canonical(v))) : value);
const reason = (status) => ({ 400: 'invalid', 409: 'conflict', 401: 'unauthorized', 403: 'revoked', 404: 'deleted', 410: 'expired' }[status] ?? (status >= 400 && status < 500 && ![408, 425, 429].includes(status) ? 'invalid' : undefined));
const retryable = (status) => [408, 425, 429].includes(status) || status >= 500;
const limits = (value) => { const result = { ...DEFAULTS, ...value }; if (!Number.isSafeInteger(result.maxRecords) || result.maxRecords < 1 || result.maxRecords > HARD.maxRecords || !Number.isSafeInteger(result.maxBytes) || result.maxBytes < 1 || result.maxBytes > HARD.maxBytes || !Number.isSafeInteger(result.maxAgeSeconds) || result.maxAgeSeconds < 1 || result.maxAgeSeconds > HARD.maxAgeSeconds)
    throw new RangeError('Offline queue limits exceed hard bounds'); return result; };
export class AesGcmCipher {
    key;
    cryptoApi;
    constructor(key, cryptoApi = globalThis.crypto) {
        this.key = key;
        this.cryptoApi = cryptoApi;
    }
    async seal(cleartext) { const nonce = this.cryptoApi.getRandomValues(new Uint8Array(12)), body = await this.cryptoApi.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, this.key, cleartext.slice().buffer); const result = new Uint8Array(12 + body.byteLength); result.set(nonce); result.set(new Uint8Array(body), 12); return result; }
    async open(ciphertext) { if (ciphertext.byteLength < 29)
        throw new Error('authentication failed'); return new Uint8Array(await this.cryptoApi.subtle.decrypt({ name: 'AES-GCM', iv: ciphertext.slice(0, 12) }, this.key, ciphertext.slice(12).buffer)); }
    static async generate(cryptoApi = globalThis.crypto) { return new AesGcmCipher(await cryptoApi.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']), cryptoApi); }
}
/** IndexedDB stores only opaque ciphertext. The non-extractable CryptoKey is in a separate object store. */
export async function openIndexedDbOfflineQueue(name, sender, configuration = {}) {
    if (!globalThis.indexedDB || !globalThis.crypto?.subtle)
        throw new Error('IndexedDB and WebCrypto are required');
    const db = await new Promise((resolve, reject) => { const request = indexedDB.open(name, 1); request.onupgradeneeded = () => { request.result.createObjectStore('queue'); request.result.createObjectStore('keys'); }; request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const tx = (store, mode, action) => new Promise((resolve, reject) => { const transaction = db.transaction(store, mode), request = action(transaction.objectStore(store)); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    let key = await tx('keys', 'readonly', s => s.get('aes'));
    if (!key) {
        key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
        await tx('keys', 'readwrite', s => s.put(key, 'aes'));
    }
    const store = { load: async () => ((await tx('queue', 'readonly', s => s.get('records'))) ?? []).map(v => new Uint8Array(v)), replace: async (records) => { await tx('queue', 'readwrite', s => s.put(records.map(v => v.slice().buffer), 'records')); } };
    return new OfflineQueue(store, new AesGcmCipher(key), sender, configuration);
}
export class OfflineQueue {
    store;
    cipher;
    sender;
    now;
    configuration;
    flushing = false;
    constructor(store, cipher, sender, configuration = {}, now = () => Date.now()) {
        this.store = store;
        this.cipher = cipher;
        this.sender = sender;
        this.now = now;
        this.configuration = limits(configuration);
    }
    async read() { const good = [], bad = []; for (const ciphertext of await this.store.load()) {
        try {
            good.push({ record: JSON.parse(decoder.decode(await this.cipher.open(ciphertext))), ciphertext });
        }
        catch {
            bad.push(ciphertext);
        }
    } return { good, bad }; }
    async write(records, bad) { await this.store.replace([...bad, ...await Promise.all(records.map(r => this.cipher.seal(encoder.encode(canonical(r)))))]); }
    async enqueue(collectionId, submission) { if (!collectionId || !submission.idempotencyKey)
        throw new TypeError('collectionId and idempotencyKey are required'); const submissionText = canonical(submission), byteSize = encoder.encode(submissionText).byteLength; if (byteSize > MAX_RECORD)
        throw new RangeError('Offline record exceeds 64 KiB'); const { good, bad } = await this.read(), records = good.map(v => v.record), prior = records.find(r => JSON.parse(r.submissionText).idempotencyKey === submission.idempotencyKey); if (prior) {
        if (prior.collectionId !== collectionId || prior.submissionText !== submissionText)
            throw new Error('Offline idempotency conflict');
        return prior.id;
    } if (records.length >= this.configuration.maxRecords || records.reduce((sum, r) => sum + r.byteSize, 0) + byteSize > this.configuration.maxBytes)
        throw new RangeError('Offline queue capacity exceeded'); const record = { id: crypto.randomUUID(), collectionId, submissionText, createdAt: this.now(), byteSize, attemptCount: 0, state: 'pending' }; await this.write([...records, record], bad); return record.id; }
    async snapshot() { const { good, bad } = await this.read(), status = { pending: 0, blockedByReason: {}, expiredLocal: 0, quarantined: bad.length, bytes: 0 }; for (const { record: r } of good) {
        status.bytes += r.byteSize;
        if (r.state === 'pending')
            status.pending++;
        else if (r.state === 'expired_local')
            status.expiredLocal++;
        else if (r.reason)
            status.blockedByReason[r.reason] = (status.blockedByReason[r.reason] ?? 0) + 1;
    } return status; }
    async delete(recordId) { const { good, bad } = await this.read(); await this.write(good.map(v => v.record).filter(r => r.id !== recordId), bad); }
    async deleteCollection(collectionId) { const { good, bad } = await this.read(), kept = good.map(v => v.record).filter(r => r.collectionId !== collectionId); const count = good.length - kept.length; await this.write(kept, bad); return count; }
    async purgeQuarantined() { const { good, bad } = await this.read(); await this.write(good.map(v => v.record), []); return bad.length; }
    async flush(resolveCredential, signal) { if (this.flushing)
        throw new Error('Offline flush already active'); this.flushing = true; const report = { attempted: 0, accepted: 0, pending: 0, blocked: 0, expiredLocal: 0, quarantined: 0, cancelled: false, outcomes: [] }; try {
        const initial = await this.read(), initialRecords = initial.good.map(v => v.record);
        let expiredChanged = false;
        for (const record of initialRecords) {
            if (record.state !== 'expired_local' && this.now() - record.createdAt > this.configuration.maxAgeSeconds * 1000) {
                record.state = 'expired_local';
                delete record.reason;
                expiredChanged = true;
            }
        }
        if (expiredChanged)
            await this.write(initialRecords, initial.bad);
        const ids = initialRecords.filter(r => r.state === 'pending').sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)).map(r => r.id);
        for (const id of ids) {
            if (signal?.aborted) {
                report.cancelled = true;
                break;
            }
            const current = await this.read(), records = current.good.map(v => v.record), record = records.find(r => r.id === id);
            if (!record || record.state !== 'pending')
                continue;
            const credential = await resolveCredential(record.collectionId);
            if (!credential) {
                report.pending++;
                report.outcomes.push({ recordId: id, outcome: 'credential_unavailable' });
                continue;
            }
            report.attempted++;
            let result;
            try {
                result = await this.sender(record.collectionId, credential, JSON.parse(record.submissionText), signal);
            }
            catch { }
            const fresh = await this.read(), updated = fresh.good.map(v => v.record), target = updated.find(r => r.id === id);
            if (!target)
                continue;
            const receipt = result?.receipt;
            if (result && result.status >= 200 && result.status < 300 && receipt?.accepted === true && receipt.collectionId === target.collectionId && receipt.responseId.length > 0) {
                await this.write(updated.filter(r => r.id !== id), fresh.bad);
                report.accepted++;
                report.outcomes.push({ recordId: id, outcome: 'accepted' });
                continue;
            }
            target.attemptCount++;
            const terminal = result && reason(result.status);
            if (terminal) {
                target.state = 'blocked';
                target.reason = terminal;
                report.blocked++;
                report.outcomes.push({ recordId: id, outcome: 'blocked', reason: terminal });
            }
            else {
                report.pending++;
                report.outcomes.push({ recordId: id, outcome: 'retry', ...(result?.retryAfterSeconds !== undefined && retryable(result.status) ? { retryAfterSeconds: Math.max(0, Math.min(86400, Math.floor(result.retryAfterSeconds))) } : {}) });
            }
            await this.write(updated, fresh.bad);
        }
    }
    finally {
        this.flushing = false;
    } const final = await this.snapshot(); report.pending = final.pending; report.quarantined = final.quarantined; report.expiredLocal = final.expiredLocal; report.blocked = Object.values(final.blockedByReason).reduce((a, b) => a + (b ?? 0), 0); return report; }
}
