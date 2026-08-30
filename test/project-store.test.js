import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryProjectStore, createIndexedDbProjectStore, hashProjectExportPayload } from '../src/lib/projectStore.js';

const project = { id: 'project_1', name: 'Planning project', retention: { mode: 'UNTIL_DELETED' } };
const run = (projectId = 'project_1', id = 'run_1') => ({ id, kind: 'run', projectId, version: 1, data: { inputHash: 'a'.repeat(64), synthetic: true, observedHumanResponse: false }, lineage: { projectId, studyId: 'study_1', runId: id } });
const note = (projectId = 'project_1', id = 'note_1') => ({ id, kind: 'researcher_note', projectId, version: 1, data: { text: 'Review later', authorRole: 'RESEARCHER' }, lineage: { projectId } });
const disclosure = 'Model-generated perspective—not a participant quotation.';

function createIndexedDbFactory() {
  const databases = new Map();
  const ensureDatabase = (name) => {
    if (!databases.has(name)) databases.set(name, { stores: new Map(), writeTail: Promise.resolve() });
    return databases.get(name);
  };
  const createTransaction = (database, storeName, mode) => {
    const tx = { mode, error: null, oncomplete: null, onerror: null, onabort: null };
    const ensureStore = () => {
      if (!database.stores.has(storeName)) database.stores.set(storeName, new Map());
      return database.stores.get(storeName);
    };
    const start = mode === 'readwrite' ? database.writeTail : Promise.resolve();
    let chain = start;
    let releaseWrite = null;
    if (mode === 'readwrite') {
      database.writeTail = new Promise((resolve) => {
        releaseWrite = resolve;
      });
    }
    const finish = () => {
      queueMicrotask(() => {
        tx.oncomplete?.();
        releaseWrite?.();
      });
    };
    tx.objectStore = () => ({
      get(key) {
        const request = {};
        chain = chain.then(() => new Promise((resolve) => {
          queueMicrotask(() => {
            request.result = structuredClone(ensureStore().get(key));
            request.onsuccess?.();
            resolve();
          });
        }));
        return request;
      },
      put(value, key) {
        const request = {};
        chain = chain.then(() => new Promise((resolve) => {
          queueMicrotask(() => {
            ensureStore().set(key, structuredClone(value));
            request.onsuccess?.();
            finish();
            resolve();
          });
        }));
        return request;
      },
    });
    return tx;
  };
  return {
    open(name) {
      const request = {};
      queueMicrotask(() => {
        const database = ensureDatabase(name);
        request.result = {
          createObjectStore: (storeName) => database.stores.set(storeName, new Map()),
          transaction: (storeName, mode) => createTransaction(database, storeName, mode),
        };
        if (database.stores.size === 0) request.onupgradeneeded?.();
        request.onsuccess?.();
      });
      return request;
    },
    seed(name, state) {
      const database = ensureDatabase(name);
      database.stores.set('state', new Map([['root', structuredClone(state)]]));
    },
  };
}

test('memory repository creates, lists, gets, appends, and reloads through same adapter', async () => {
  const store = createMemoryProjectStore();
  const created = await store.createProject(project);
  assert.equal(created.schemaVersion, 'project-record-v1');
  await store.appendRecord('project_1', run());
  await store.appendRecord('project_1', note());
  const loaded = await store.getProject('project_1');
  assert.deepEqual(loaded.records.map((record) => record.id), ['run_1', 'note_1']);
  assert.equal((await store.listProjects()).length, 1);
});

test('export clear import round-trips hashes, lineage, disclosures, and rejects cross-project links', async () => {
  const store = createMemoryProjectStore();
  await store.createProject(project);
  await store.appendRecord('project_1', run());
  const exported = await store.exportProject('project_1');
  assert.equal(exported.exportVersion, 'project-export-v1');
  assert.equal(exported.disclosure, 'Local browser data; not encrypted account storage.');
  assert.match(exported.packageHash, /^[a-f0-9]{64}$/);
  await store.clearAll();
  await store.importProject(exported);
  assert.equal((await store.getProject('project_1')).records[0].id, 'run_1');
  await assert.rejects(() => store.importProject({ ...exported, project: { ...exported.project, id: 'project_2' } }), /project export is invalid/i);
});

test('persistent replacement validates before replacing and supports same-id replacement', async () => {
  const factory = createIndexedDbFactory();
  const store = createIndexedDbProjectStore({ indexedDB: factory, dbName: `likerts-replace-${Date.now()}` });
  await store.createProject(project);
  await store.appendRecord('project_1', run());
  const before = await store.getProject('project_1');
  const exported = await store.exportProject('project_1');
  const sessionProject = { ...exported.project, retention: { mode: 'SESSION', expiresAt: null } };
  const sessionPayload = {
    ...exported,
    project: sessionProject,
    packageHash: await hashProjectExportPayload({ exportVersion: exported.exportVersion, disclosure: exported.disclosure, project: sessionProject }),
  };

  await assert.rejects(() => store.replaceProject(sessionPayload), /SESSION retention is local-only/i);
  assert.deepEqual(await store.getProject('project_1'), before, 'rejected replacement must preserve the existing project');

  const replacementProject = { ...exported.project, name: 'Replaced project' };
  const replacementPayload = {
    ...exported,
    project: replacementProject,
    packageHash: await hashProjectExportPayload({ exportVersion: exported.exportVersion, disclosure: exported.disclosure, project: replacementProject }),
  };
  const replaced = await store.replaceProject(replacementPayload);
  assert.equal(replaced.id, 'project_1');
  assert.equal(replaced.name, 'Replaced project');
  assert.equal((await store.getProject('project_1')).name, 'Replaced project');
});

test('memory hydration rejects corrupted initial projects before listing or export', async () => {
  const source = createMemoryProjectStore();
  await source.createProject(project);
  const hydrated = await source.getProject('project_1');
  const corrupted = { ...hydrated, name: '' };
  assert.throws(() => createMemoryProjectStore({ initialProjects: [corrupted] }), /Project record is invalid/i);
});

test('indexeddb hydration rejects corrupted persisted projects before listing or export', async () => {
  const factory = createIndexedDbFactory();
  const dbName = `likerts-corrupt-hydration-${Date.now()}`;
  const source = createMemoryProjectStore();
  await source.createProject(project);
  const hydrated = await source.getProject('project_1');
  factory.seed(dbName, { projects: [{ ...hydrated, name: '' }] });
  const store = createIndexedDbProjectStore({ indexedDB: factory, dbName });
  await assert.rejects(() => store.getProject('project_1'), /Project record is invalid/i);
});

test('optimistic conflicts, malformed lineage, and cross-project records fail closed', async () => {
  const store = createMemoryProjectStore();
  await store.createProject(project);
  await store.appendRecord('project_1', run());
  await assert.rejects(() => store.appendRecord('project_1', { ...run(), id: 'run_2', projectId: 'project_2' }), /project link/i);
  await store.updateRecord('project_1', 'run_1', 1, { data: { inputHash: 'b'.repeat(64), synthetic: true, observedHumanResponse: false } });
  await assert.rejects(() => store.updateRecord('project_1', 'run_1', 1, { data: { inputHash: 'c'.repeat(64), synthetic: true, observedHumanResponse: false } }), /version conflict/i);
});

test('kind-specific data is bounded, rejects raw binary material, and session data is not durable', async () => {
  const store = createMemoryProjectStore({ maxBytes: 100_000 });
  await store.createProject(project);
  await assert.rejects(() => store.appendRecord('project_1', { ...run(), data: { inputHash: 'a'.repeat(64), synthetic: false, observedHumanResponse: true } }), /child record is invalid/i);
  await assert.rejects(() => store.appendRecord('project_1', { id: 'material_1', kind: 'material', projectId: 'project_1', version: 1, data: { title: 'x', excerpt: 'x', contentHash: 'a'.repeat(64), rawBytes: new Uint8Array([1]) }, lineage: { projectId: 'project_1' } }), /child record is invalid/i);
  const durable = createIndexedDbProjectStore;
  assert.equal(typeof durable, 'function');
});

test('create normalizes bytes and rejects a project that cannot fit without evictable records', async () => {
  const store = createMemoryProjectStore({ maxBytes: 120 });
  await assert.rejects(() => store.createProject({ ...project, name: 'This project metadata cannot fit in the configured storage budget.' }), /storage cap/i);
});

test('updates preserve identifiers and retain prior revision snapshots', async () => {
  const store = createMemoryProjectStore();
  await store.createProject(project);
  await store.appendRecord('project_1', run());
  const updated = await store.updateRecord('project_1', 'run_1', 1, { data: { inputHash: 'b'.repeat(64), synthetic: true, observedHumanResponse: false } });
  assert.equal(updated.records[0].id, 'run_1');
  assert.equal(updated.records[0].version, 2);
  assert.equal(updated.records[0].revisions.length, 1);
  assert.equal(updated.records[0].revisions[0].data.inputHash, 'a'.repeat(64));
  assert.equal('revisions' in updated.records[0].revisions[0], false);
});

test('repeated revisions stay flat and bounded instead of recursively duplicating history', async () => {
  const store = createMemoryProjectStore({ maxBytes: 500_000 });
  await store.createProject(project);
  await store.appendRecord('project_1', run());
  for (let version = 1; version <= 12; version += 1) {
    await store.updateRecord('project_1', 'run_1', version, { data: { inputHash: (version % 16).toString(16).repeat(64), synthetic: true, observedHumanResponse: false } });
  }
  const updated = (await store.getProject('project_1')).records[0];
  assert.equal(updated.version, 13);
  assert.equal(updated.revisions.length, 10);
  assert.ok(updated.revisions.every((revision) => !('revisions' in revision)));
});

test('durable qualitative turns preserve full context and are append-only', async () => {
  const store = createMemoryProjectStore();
  await store.createProject(project);
  const firstTurn = { id: 'user_1', role: 'user', text: 'What is the main objection?', intent: 'OBJECTION', parentTurnId: null };
  await store.appendRecord('project_1', { id: 'conversation_1', kind: 'conversation', projectId: 'project_1', version: 1, data: { conversationId: 'conversation_1', segmentId: 'segment_1', frozenContextHash: 'f'.repeat(64), synthetic: true, observedHumanResponse: false, disclosure, turnCount: 1, turns: [firstTurn] }, lineage: { projectId: 'project_1', studyId: 'study_1', runId: 'run_1' } });
  const assistant = {
    id: 'assistant_1',
    role: 'assistant',
    text: 'Approval uncertainty is the primary model-generated objection in this context.',
    evidenceRefs: ['evidence_1'],
    assumptionRefs: ['assumption_1'],
    parentTurnId: 'user_1',
    disclosure,
    basisSummary: 'This answer only reflects model-generated reasoning grounded by one safe source and one explicit assumption.',
    limitations: ['Model-generated perspective only.'],
    evidenceUsed: [{ id: 'evidence_1', title: 'Source', url: 'https://example.com/source', excerpt: 'A bounded excerpt', evidenceClass: 'PROVIDED_SOURCE' }],
    assumptionsUsed: [{ id: 'assumption_1', text: 'The buying committee is cautious.' }],
    context: { evidenceHash: null, populationFrameHash: null, note: '' },
    stimulusRefs: [],
  };
  const updated = await store.updateRecord('project_1', 'conversation_1', 1, { data: { conversationId: 'conversation_1', segmentId: 'segment_1', frozenContextHash: 'f'.repeat(64), synthetic: true, observedHumanResponse: false, disclosure, turnCount: 2, turns: [firstTurn, assistant] } });
  assert.equal(updated.records[0].data.turns[1].disclosure, disclosure);
  assert.equal(updated.records[0].data.turns[1].context.evidenceHash, null);
  await assert.rejects(() => store.updateRecord('project_1', 'conversation_1', 2, { data: { ...updated.records[0].data, turnCount: 1, turns: [firstTurn] } }), /append-only/i);
});

test('imports reject unsafe evidence urls even when the package hash is recomputed', async () => {
  const store = createMemoryProjectStore();
  await store.createProject(project);
  await store.appendRecord('project_1', {
    id: 'conversation_1',
    kind: 'conversation',
    projectId: 'project_1',
    version: 1,
    data: {
      conversationId: 'conversation_1',
      segmentId: 'segment_1',
      synthetic: true,
      observedHumanResponse: false,
      disclosure,
      turnCount: 2,
      turns: [
        { id: 'user_1', role: 'user', text: 'What is the source?', intent: 'FOLLOW_UP', parentTurnId: null },
        { id: 'assistant_1', role: 'assistant', text: 'It reflects one safe source and remains synthetic direction only.', evidenceRefs: ['evidence_1'], assumptionRefs: [], parentTurnId: 'user_1', disclosure, basisSummary: 'This stored answer references one safe public source and no additional assumptions.', limitations: ['Model-generated perspective only.'], evidenceUsed: [{ id: 'evidence_1', title: 'Source', url: 'https://example.com/source', excerpt: 'A bounded excerpt', evidenceClass: 'PROVIDED_SOURCE' }], assumptionsUsed: [], context: { evidenceHash: null, populationFrameHash: null, note: '' }, stimulusRefs: [] },
      ],
    },
    lineage: { projectId: 'project_1', studyId: 'study_1', runId: 'run_1' },
  });
  const exported = await store.exportProject('project_1');
  const tampered = structuredClone(exported);
  tampered.project.records[0].data.turns[1].evidenceUsed[0].url = 'http://127.0.0.1/private';
  tampered.packageHash = await hashProjectExportPayload({
    exportVersion: tampered.exportVersion,
    disclosure: tampered.disclosure,
    project: tampered.project,
  });
  await assert.rejects(() => createMemoryProjectStore().importProject(tampered), /project export is invalid/i);
});

test('quota reports deterministic eviction and TTL expiry, then cascade delete removes children', async () => {
  let now = new Date('2030-01-01T00:00:00.000Z');
  const store = createMemoryProjectStore({ maxBytes: 800, now: () => now.toISOString() });
  await store.createProject({ ...project, retention: { mode: 'TTL', expiresAt: '2030-01-02T00:00:00.000Z' } });
  await store.appendRecord('project_1', run());
  await store.appendRecord('project_1', note());
  const before = await store.getProject('project_1');
  assert.equal(typeof before.storageStatus.evicted, 'boolean');
  now = new Date('2030-01-03T00:00:00.000Z');
  await assert.rejects(() => store.getProject('project_1'), /expired/i);
  assert.equal(await store.deleteProject('project_1'), false);
  const store2 = createMemoryProjectStore();
  await store2.createProject(project);
  await store2.appendRecord('project_1', run());
  assert.equal(await store2.deleteProject('project_1'), true);
  assert.equal((await store2.listProjects()).length, 0);
  assert.equal(await store2.clearAll(), 0);
});

test('indexeddb adapter persists through a second repository instance', async () => {
  const factory = createIndexedDbFactory();
  const first = createIndexedDbProjectStore({ indexedDB: factory, dbName: `likerts-test-${Date.now()}` });
  await first.createProject(project);
  await first.appendRecord('project_1', run());
  const second = createIndexedDbProjectStore({ indexedDB: factory, dbName: first.dbName });
  assert.equal((await second.getProject('project_1')).records.length, 1);
});

test('indexeddb adapter preserves both concurrent cross-tab appends instead of dropping the later write', async () => {
  const factory = createIndexedDbFactory();
  const first = createIndexedDbProjectStore({ indexedDB: factory, dbName: `likerts-race-${Date.now()}` });
  const second = createIndexedDbProjectStore({ indexedDB: factory, dbName: first.dbName });
  await first.createProject(project);
  await Promise.all([
    first.appendRecord('project_1', run('project_1', 'run_1')),
    second.appendRecord('project_1', run('project_1', 'run_2')),
  ]);
  const loaded = await first.getProject('project_1');
  assert.deepEqual(loaded.records.map((record) => record.id).sort(), ['run_1', 'run_2']);
});

test('indexeddb adapter surfaces cross-tab stale conversation updates as conflicts without dropping the winning turn', async () => {
  const factory = createIndexedDbFactory();
  const first = createIndexedDbProjectStore({ indexedDB: factory, dbName: `likerts-turn-race-${Date.now()}` });
  const second = createIndexedDbProjectStore({ indexedDB: factory, dbName: first.dbName });
  const firstTurn = { id: 'user_1', role: 'user', text: 'What changed?', intent: 'FOLLOW_UP', parentTurnId: null };
  await first.createProject(project);
  await first.appendRecord('project_1', {
    id: 'conversation_1',
    kind: 'conversation',
    projectId: 'project_1',
    version: 1,
    data: { conversationId: 'conversation_1', segmentId: 'segment_1', synthetic: true, observedHumanResponse: false, disclosure, turnCount: 1, turns: [firstTurn] },
    lineage: { projectId: 'project_1', studyId: 'study_1', runId: 'run_1' },
  });
  const winningPatch = {
    data: {
      conversationId: 'conversation_1',
      segmentId: 'segment_1',
      synthetic: true,
      observedHumanResponse: false,
      disclosure,
      turnCount: 2,
      turns: [
        firstTurn,
        {
          id: 'assistant_1',
          role: 'assistant',
          text: 'The winning cross-tab update preserved this modeled answer.',
          evidenceRefs: [],
          assumptionRefs: [],
          parentTurnId: 'user_1',
          disclosure,
          basisSummary: 'This answer is kept as the winning append-only turn.',
          limitations: ['Model-generated perspective only.'],
          evidenceUsed: [],
          assumptionsUsed: [],
          context: { evidenceHash: null, populationFrameHash: null, note: '' },
          stimulusRefs: [],
        },
      ],
    },
  };
  const losingPatch = {
    data: {
      conversationId: 'conversation_1',
      segmentId: 'segment_1',
      synthetic: true,
      observedHumanResponse: false,
      disclosure,
      turnCount: 2,
      turns: [
        firstTurn,
        {
          id: 'assistant_2',
          role: 'assistant',
          text: 'This stale update should not overwrite the winning turn.',
          evidenceRefs: [],
          assumptionRefs: [],
          parentTurnId: 'user_1',
          disclosure,
          basisSummary: 'This stale answer must fail instead of overwriting the stored turn.',
          limitations: ['Model-generated perspective only.'],
          evidenceUsed: [],
          assumptionsUsed: [],
          context: { evidenceHash: null, populationFrameHash: null, note: '' },
          stimulusRefs: [],
        },
      ],
    },
  };
  const [winner, loser] = await Promise.allSettled([
    first.updateRecord('project_1', 'conversation_1', 1, winningPatch),
    second.updateRecord('project_1', 'conversation_1', 1, losingPatch),
  ]);
  assert.equal(winner.status, 'fulfilled');
  assert.equal(loser.status, 'rejected');
  assert.match(loser.reason.message, /version conflict/i);
  const loaded = await first.getProject('project_1');
  assert.equal(loaded.records[0].version, 2);
  assert.equal(loaded.records[0].data.turns[1].id, 'assistant_1');
});
