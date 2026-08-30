import { z } from 'zod';
import { lineageEnvelopeSchema } from './privacy-contract.js';

export const storageRecordSchema = z.object({
  id: z.string().trim().min(1).max(160).regex(/^[A-Za-z0-9_-]+$/),
  kind: z.string().trim().min(1).max(80).regex(/^[A-Za-z0-9_-]+$/),
  version: z.number().int().min(1),
  data: z.unknown(),
  lineage: lineageEnvelopeSchema,
}).strict().superRefine((value, context) => {
  if (value.lineage.recordId !== value.id) context.addIssue({ code: 'custom', path: ['lineage', 'recordId'], message: 'Lineage record ID must match storage ID.' });
  if (value.lineage.recordType !== value.kind) context.addIssue({ code: 'custom', path: ['lineage', 'recordType'], message: 'Lineage record type must match storage kind.' });
  if (value.lineage.version !== value.version) context.addIssue({ code: 'custom', path: ['lineage', 'version'], message: 'Lineage version must match storage version.' });
});

const clone = (value) => structuredClone(value);

export function createMemoryStorageAdapter(options = {}) {
  const records = new Map();
  const now = options.now || (() => new Date().toISOString());
  const isExpired = (record) => record.lineage.retention.mode === 'TTL' && Date.parse(record.lineage.retention.expiresAt) <= Date.parse(now());
  const active = (id) => {
    const record = records.get(id);
    if (record && isExpired(record)) { records.delete(id); return null; }
    return record;
  };
  return {
    async create(input) {
      const record = storageRecordSchema.parse(input);
      if (records.has(record.id)) throw new Error(`Record ${record.id} already exists.`);
      records.set(record.id, clone(record));
      return clone(record);
    },
    async get(id) {
      const record = active(id);
      return record ? clone(record) : null;
    },
    async update(id, expectedVersion, patch) {
      const current = active(id);
      if (!current) throw new Error(`Record ${id} was not found.`);
      if (current.version !== expectedVersion) throw new Error(`Record ${id} version conflict.`);
      const nextVersion = current.version + 1;
      const next = storageRecordSchema.parse({ ...current, ...patch, id, version: nextVersion, lineage: { ...current.lineage, ...(patch.lineage || {}), version: nextVersion, updatedAt: now() } });
      records.set(id, clone(next));
      return clone(next);
    },
    async list(filter = {}) {
      return [...records.keys()].map(active).filter((record) => record && (!filter.kind || record.kind === filter.kind)).map(clone);
    },
    async delete(id) {
      return records.delete(id);
    },
  };
}
