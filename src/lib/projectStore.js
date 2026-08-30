import { z } from 'zod';
import { validateSampleLineage } from '../../server/sample-lineage.js';

export const PROJECT_SCHEMA_VERSION = 'project-record-v1';
export const PROJECT_EXPORT_VERSION = 'project-export-v1';
export const LOCAL_DATA_DISCLOSURE = 'Local browser data; not encrypted account storage.';
const id = z.string().trim().min(1).max(160).regex(/^[A-Za-z0-9_-]+$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/i);
const safePublicUrl = z.string().trim().url().superRefine((value, context) => {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
    const privateIpv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !host) {
      context.addIssue({ code: 'custom', message: 'Use a safe public http(s) URL.' });
      return;
    }
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || host === '0.0.0.0' || host === '::' || host === '::1' || host.startsWith('::ffff:') || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe8') || host.startsWith('fe9') || host.startsWith('fea') || host.startsWith('feb')) {
      context.addIssue({ code: 'custom', message: 'Use a safe public http(s) URL.' });
      return;
    }
    if (privateIpv4) {
      const octets = privateIpv4.slice(1).map(Number);
      if (octets.some((octet) => octet > 255) || octets[0] === 10 || octets[0] === 127 || octets[0] === 0 || (octets[0] === 169 && octets[1] === 254) || (octets[0] === 192 && octets[1] === 168) || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)) {
        context.addIssue({ code: 'custom', message: 'Use a safe public http(s) URL.' });
      }
    }
  } catch {
    context.addIssue({ code: 'custom', message: 'Use a safe public http(s) URL.' });
  }
});
const retention = z.object({ mode: z.enum(['SESSION', 'TTL', 'UNTIL_DELETED']), expiresAt: z.string().datetime({ offset: true }).nullable().default(null) }).strict().superRefine((v, c) => { if (v.mode === 'TTL' && !v.expiresAt) c.addIssue({ code: 'custom', message: 'TTL requires expiry.' }); if (v.mode !== 'TTL' && v.expiresAt) c.addIssue({ code: 'custom', message: 'Only TTL may have expiry.' }); });
const sampleLineageValue = z.unknown().nullable().optional().default(null);
const runData = z.object({ inputHash: hash, synthetic: z.literal(true), observedHumanResponse: z.literal(false), method: z.string().trim().max(100).optional(), sampleLineage: sampleLineageValue }).strict();
const evidenceUsedRecord = z.object({ id, title: z.string().trim().min(1).max(180), url: safePublicUrl.nullable(), excerpt: z.string().trim().min(1).max(1_500), originalLanguage: z.string().trim().min(2).max(35).nullable().optional().default(null), evidenceClass: z.string().trim().min(1).max(80) }).strict();
const assumptionUsedRecord = z.object({ id, text: z.string().trim().min(3).max(400) }).strict();
const conversationTurn = z.discriminatedUnion('role', [
  z.object({ id, role: z.literal('user'), text: z.string().trim().min(2).max(2_000), intent: z.enum(['FOLLOW_UP', 'OBJECTION', 'COUNTERFACTUAL', 'CONCEPT_COMPARISON']), parentTurnId: id.nullable() }).strict(),
  z.object({
    id,
    role: z.literal('assistant'),
    text: z.string().trim().min(20).max(4_000),
    evidenceRefs: z.array(id).max(8),
    assumptionRefs: z.array(id).max(8),
    parentTurnId: id.nullable(),
    disclosure: z.literal('Model-generated perspective—not a participant quotation.'),
    basisSummary: z.string().trim().min(20).max(600).optional(),
    limitations: z.array(z.string().trim().min(8).max(240)).max(4).optional().default([]),
    evidenceUsed: z.array(evidenceUsedRecord).max(8).optional().default([]),
    assumptionsUsed: z.array(assumptionUsedRecord).max(8).optional().default([]),
    context: z.object({ evidenceHash: hash.nullable().default(null), populationFrameHash: hash.nullable().default(null), note: z.string().trim().max(600) }).strict().optional(),
    stimulusRefs: z.array(id).max(2).optional().default([]),
  }).strict(),
]);
const conversationData = z.object({ conversationId: id, segmentId: id.optional(), frozenContextHash: hash.optional(), synthetic: z.literal(true), observedHumanResponse: z.literal(false), disclosure: z.literal('Model-generated perspective—not a participant quotation.'), turnCount: z.number().int().min(0).max(14), turns: z.array(conversationTurn).max(14).optional().default([]) }).strict().superRefine((value, context) => {
  if (value.turns.length && value.turnCount !== value.turns.length) context.addIssue({ code: 'custom', path: ['turnCount'], message: 'Conversation turn count must match stored turns.' });
  value.turns.forEach((turn, index) => {
    if (turn.role !== (index % 2 === 0 ? 'user' : 'assistant') || turn.parentTurnId !== (value.turns[index - 1]?.id || null)) context.addIssue({ code: 'custom', path: ['turns', index], message: 'Conversation turns must preserve alternating roles and their parent chain.' });
  });
});
const noteData = z.object({ text: z.string().trim().min(1).max(2_000), authorRole: z.enum(['RESEARCHER', 'REVIEWER']) }).strict();
const materialData = z.object({ title: z.string().trim().min(1).max(180), excerpt: z.string().trim().min(1).max(2_000), contentHash: hash, locators: z.array(z.string().trim().min(1).max(200)).max(100), originalCharacterCount: z.number().int().min(1).max(100_000), detectedType: z.string().trim().min(1).max(30), originalLanguage: z.string().trim().min(2).max(35).nullable().optional().default(null) }).strict();
const dataByKind = { run: runData, conversation: conversationData, researcher_note: noteData, material: materialData };
const lineage = z.object({ projectId: id, studyId: id.nullable().default(null), runId: id.nullable().default(null), sampleLineage: sampleLineageValue }).strict();
const recordRevision = z.object({ version: z.number().int().min(1), data: z.unknown(), revisedAt: z.string().datetime({ offset: true }) }).strict();
const recordBase = z.object({ id, kind: z.enum(['run', 'conversation', 'researcher_note', 'material']), projectId: id, version: z.number().int().min(1), data: z.unknown(), lineage, revisions: z.array(recordRevision).max(10).default([]) }).strict();
const record = recordBase.superRefine((value, c) => {
  const parsedData = dataByKind[value.kind].safeParse(value.data);
  if (!parsedData.success) c.addIssue({ code: 'custom', path: ['data'], message: 'Kind-specific data is invalid.' });
  if (value.lineage.projectId !== value.projectId) c.addIssue({ code: 'custom', path: ['lineage', 'projectId'], message: 'Lineage project does not match record.' });
  if (value.kind !== 'run' && value.lineage.sampleLineage !== null) c.addIssue({ code: 'custom', path: ['lineage', 'sampleLineage'], message: 'Only run records may carry sample lineage.' });
  if (value.kind === 'run' && parsedData.success) {
    const dataSampleLineage = parsedData.data.sampleLineage;
    const lineageSampleLineage = value.lineage.sampleLineage;
    try {
      if (dataSampleLineage !== null) validateSampleLineage(dataSampleLineage);
      if (lineageSampleLineage !== null) validateSampleLineage(lineageSampleLineage);
      if (canonical(dataSampleLineage) !== canonical(lineageSampleLineage)) c.addIssue({ code: 'custom', path: ['lineage', 'sampleLineage'], message: 'Run sample lineage must match its lineage record.' });
    } catch {
      c.addIssue({ code: 'custom', path: ['lineage', 'sampleLineage'], message: 'Run sample lineage must match a current registered public sample.' });
    }
  }
});
const project = z.object({ schemaVersion: z.literal(PROJECT_SCHEMA_VERSION), id, name: z.string().trim().min(1).max(180), retention, records: z.array(record).max(200), version: z.number().int().min(1), createdAt: z.string().datetime({ offset: true }), updatedAt: z.string().datetime({ offset: true }), storageStatus: z.object({ bytes: z.number().int().min(0), maxBytes: z.number().int().positive(), evicted: z.boolean(), evictedRecordIds: z.array(id).max(200) }).strict(), disclosure: z.literal(LOCAL_DATA_DISCLOSURE) }).strict();
const exportSchema = z.object({ exportVersion: z.literal(PROJECT_EXPORT_VERSION), packageHash: hash, disclosure: z.literal(LOCAL_DATA_DISCLOSURE), project }).strict();
const canonical = (v) => Array.isArray(v) ? `[${v.map(canonical).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}` : JSON.stringify(v);
async function digest(value) { const bytes = new TextEncoder().encode(value); const hashBytes = await globalThis.crypto.subtle.digest('SHA-256', bytes); return [...new Uint8Array(hashBytes)].map((b) => b.toString(16).padStart(2, '0')).join(''); }
const clone = (v) => structuredClone(v);
const parse = (schema, value, message) => { const result = schema.safeParse(value); if (!result.success) throw new Error(message); return result.data; };
export async function hashProjectExportPayload(value) { return digest(canonical(value)); }
function validateProjectRecord(item, { persistent = false } = {}) {
  const value = parse(project, item, 'Project record is invalid.');
  if (value.records.some((recordItem) => recordItem.projectId !== value.id || recordItem.lineage.projectId !== value.id)) throw new Error('Project link is invalid.');
  if (persistent && value.retention.mode === 'SESSION') throw new Error('SESSION retention is local-only and cannot be durably written.');
  return value;
}
async function validateProjectExportPayload(input, options = {}) {
  const value = parse(exportSchema, input, 'Project export is invalid.');
  const expected = await hashProjectExportPayload({ exportVersion: value.exportVersion, disclosure: value.disclosure, project: value.project });
  if (expected !== value.packageHash) throw new Error('Project export is invalid.');
  return validateProjectRecord(value.project, options);
}
function createCore(options = {}) {
  const now = options.now || (() => new Date().toISOString()); const maxBytes = options.maxBytes || 500_000; const persistent = Boolean(options.persistent);
  // Hydration is an admission boundary too: never expose or re-export a
  // corrupted persisted project before a mutation happens to validate it.
  const hydratedProjects = (options.initialProjects || []).map((item) => validateProjectRecord(item, { persistent }));
  const records = new Map(hydratedProjects.map((item) => [item.id, clone(item)]));
  const expired = (item) => item.retention.mode === 'TTL' && Date.parse(item.retention.expiresAt) <= Date.parse(now());
  const validateProject = (item) => validateProjectRecord(item, { persistent });
  const size = (item) => new TextEncoder().encode(JSON.stringify(item)).length;
  const normalize = (item) => { let value = validateProject(item); const evictedRecordIds = []; while (size(value) > value.storageStatus.maxBytes) { const candidate = [...value.records].filter((r) => ['material', 'researcher_note'].includes(r.kind)).sort((a, b) => a.id.localeCompare(b.id))[0]; if (!candidate) throw new Error('Project exceeds storage cap.'); value = { ...value, records: value.records.filter((r) => r.id !== candidate.id) }; evictedRecordIds.push(candidate.id); } return validateProject({ ...value, storageStatus: { bytes: size(value), maxBytes: value.storageStatus.maxBytes, evicted: evictedRecordIds.length > 0, evictedRecordIds } }); };
  const active = (idValue) => { const item = records.get(idValue); if (item && expired(item)) { records.delete(idValue); return null; } return item; };
  const sync = {
    createProject(input) { const timestamp = input.createdAt || now(); const value = normalize({ schemaVersion: PROJECT_SCHEMA_VERSION, records: [], version: 1, createdAt: timestamp, updatedAt: timestamp, storageStatus: { bytes: 0, maxBytes, evicted: false, evictedRecordIds: [] }, disclosure: LOCAL_DATA_DISCLOSURE, ...input }); if (records.has(value.id)) throw new Error('Project already exists.'); records.set(value.id, clone(value)); return clone(value); },
    listProjects() { return [...records.values()].map((item) => active(item.id)).filter(Boolean).map((item) => clone(item)); },
    getProject(idValue) { const item = records.get(idValue); if (!item) throw new Error('Project not found.'); if (expired(item)) { records.delete(idValue); throw new Error('Project expired.'); } return clone(item); },
    appendRecord(projectId, input) { const item = sync.getProject(projectId); if (input?.projectId !== projectId || input?.lineage?.projectId !== projectId) throw new Error('Project link is invalid.'); const child = parse(record, input, 'Child record is invalid.'); if (item.records.some((r) => r.id === child.id)) throw new Error('Record already exists.'); const next = normalize({ ...item, records: [...item.records, child], version: item.version + 1, updatedAt: now() }); records.set(projectId, clone(next)); return clone(next); },
    updateRecord(projectId, recordId, expectedVersion, patch) { const item = sync.getProject(projectId); const old = item.records.find((r) => r.id === recordId); if (!old || old.version !== expectedVersion) throw new Error('Record version conflict.'); if (patch.id || patch.kind || patch.projectId || patch.lineage?.projectId || patch.lineage?.studyId !== undefined || patch.lineage?.runId !== undefined || patch.lineage?.sampleLineage !== undefined) throw new Error('Record identifiers are immutable.'); if (old.kind === 'conversation' && patch.data) { const before = conversationData.parse(old.data); const after = conversationData.parse(patch.data); if (after.conversationId !== before.conversationId || after.turns.length < before.turns.length || canonical(after.turns.slice(0, before.turns.length)) !== canonical(before.turns)) throw new Error('Conversation turns are append-only.'); } const prior = { version: old.version, data: clone(old.data), revisedAt: now() }; const revisions = [...old.revisions, prior].slice(-10); const child = parse(record, { ...old, ...patch, id: old.id, kind: old.kind, projectId, version: old.version + 1, revisions, lineage: old.lineage }, 'Child record is invalid.'); const next = normalize({ ...item, records: item.records.map((r) => r.id === recordId ? child : r), version: item.version + 1, updatedAt: now() }); records.set(projectId, clone(next)); return clone(next); },
    importValidatedProject(validated) { if (records.has(validated.id)) throw new Error('Project already exists.'); records.set(validated.id, clone(validated)); return clone(validated); },
    replaceValidatedProject(validated) { records.set(validated.id, clone(validated)); return clone(validated); },
    deleteProject(projectId) { if (!active(projectId)) return false; records.delete(projectId); return true; },
    clearAll() { const count = records.size; records.clear(); return count; },
  };
  return {
    sync,
    async createProject(input) { return sync.createProject(input); },
    async listProjects() { return sync.listProjects(); },
    async getProject(idValue) { return sync.getProject(idValue); },
    async appendRecord(projectId, input) { return sync.appendRecord(projectId, input); },
    async updateRecord(projectId, recordId, expectedVersion, patch) { return sync.updateRecord(projectId, recordId, expectedVersion, patch); },
    async exportProject(projectId) { const value = sync.getProject(projectId); const base = { exportVersion: PROJECT_EXPORT_VERSION, disclosure: LOCAL_DATA_DISCLOSURE, project: value }; return { ...base, packageHash: await hashProjectExportPayload(base) }; },
    async importProject(input) { const validated = await validateProjectExportPayload(input, { persistent }); return sync.importValidatedProject(validated); },
    async replaceProject(input) { const validated = await validateProjectExportPayload(input, { persistent }); return sync.replaceValidatedProject(validated); },
    async deleteProject(projectId) { return sync.deleteProject(projectId); },
    async clearAll() { return sync.clearAll(); },
  };
}
export function createMemoryProjectStore(options = {}) { return createCore(options); }
export function createIndexedDbProjectStore(options = {}) {
  const indexedDB = options.indexedDB || globalThis.indexedDB;
  if (!indexedDB) throw new Error('IndexedDB is unavailable.');
  const dbName = options.dbName || 'likerts-local-projects';
  let dbPromise;
  const open = () => dbPromise || (dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('state');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }));
  const readState = async () => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const request = db.transaction('state', 'readonly').objectStore('state').get('root');
      request.onsuccess = () => resolve(request.result || { projects: [] });
      request.onerror = () => reject(request.error);
    });
  };
  const mutateState = async (worker) => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('state', 'readwrite');
      const store = tx.objectStore('state');
      const readRequest = store.get('root');
      let settled = false;
      let resultValue;
      const fail = (error) => {
        if (settled) return;
        settled = true;
        reject(error);
      };
      tx.onerror = () => fail(tx.error || readRequest.error || new Error('IndexedDB mutation failed.'));
      tx.onabort = () => fail(tx.error || new Error('IndexedDB mutation aborted.'));
      tx.oncomplete = () => {
        if (settled) return;
        settled = true;
        resolve(resultValue);
      };
      readRequest.onerror = () => fail(readRequest.error);
      readRequest.onsuccess = () => {
        try {
          const state = readRequest.result || { projects: [] };
          const next = worker(state);
          resultValue = next.result;
          const writeRequest = store.put(next.state, 'root');
          writeRequest.onerror = () => fail(writeRequest.error);
        } catch (error) {
          tx.abort?.();
          fail(error);
        }
      };
    });
  };
  const hydrate = async () => createCore({ ...options, persistent: true, initialProjects: (await readState()).projects });
  const facade = { dbName };
  facade.createProject = async (input) => mutateState((state) => {
    const core = createCore({ ...options, persistent: true, initialProjects: state.projects });
    const result = core.sync.createProject(input);
    return { result, state: { projects: core.sync.listProjects() } };
  });
  facade.appendRecord = async (projectId, input) => mutateState((state) => {
    const core = createCore({ ...options, persistent: true, initialProjects: state.projects });
    const result = core.sync.appendRecord(projectId, input);
    return { result, state: { projects: core.sync.listProjects() } };
  });
  facade.updateRecord = async (projectId, recordId, expectedVersion, patch) => mutateState((state) => {
    const core = createCore({ ...options, persistent: true, initialProjects: state.projects });
    const result = core.sync.updateRecord(projectId, recordId, expectedVersion, patch);
    return { result, state: { projects: core.sync.listProjects() } };
  });
  facade.importProject = async (input) => {
    const validated = await validateProjectExportPayload(input, { persistent: true });
    return mutateState((state) => {
      const core = createCore({ ...options, persistent: true, initialProjects: state.projects });
      const result = core.sync.importValidatedProject(validated);
      return { result, state: { projects: core.sync.listProjects() } };
    });
  };
  facade.replaceProject = async (input) => {
    // Validate and hash before opening the write transaction. Replacement is
    // then one read/put transaction, so a rejected payload cannot delete the
    // existing project or leave a half-imported state.
    const validated = await validateProjectExportPayload(input, { persistent: true });
    return mutateState((state) => {
      const core = createCore({ ...options, persistent: true, initialProjects: state.projects });
      const result = core.sync.replaceValidatedProject(validated);
      return { result, state: { projects: core.sync.listProjects() } };
    });
  };
  facade.deleteProject = async (projectId) => mutateState((state) => {
    const core = createCore({ ...options, persistent: true, initialProjects: state.projects });
    const result = core.sync.deleteProject(projectId);
    return { result, state: { projects: core.sync.listProjects() } };
  });
  facade.clearAll = async () => mutateState((state) => {
    const core = createCore({ ...options, persistent: true, initialProjects: state.projects });
    const result = core.sync.clearAll();
    return { result, state: { projects: core.sync.listProjects() } };
  });
  for (const method of ['listProjects', 'getProject', 'exportProject']) facade[method] = async (...args) => (await hydrate())[method](...args);
  return facade;
}
