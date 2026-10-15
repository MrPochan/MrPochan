// Idempotency-Key handling (ERR-002, DB-016). A repeated request with the same key and body gets the
// stored response; the same key with another body is `idempotency.conflict`. Only 2xx replies are stored,
// so a rejected request can be sent again after the client fixes it.

import { createHash } from 'node:crypto';
import { ApiError } from './errors.ts';
import type { Repository } from './store/repository.ts';

export interface StoredReply {
  readonly status: number;
  readonly body: unknown;
}

/** Canonical JSON with sorted object keys, so equal bodies hash equally. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, item]) => `${JSON.stringify(k)}:${canonicalJson(item)}`).join(',')}}`;
}

export function hashBody(body: unknown): string {
  return createHash('sha256').update(canonicalJson(body), 'utf8').digest('hex');
}

/**
 * Runs `work` once per (user, key). The lookup, the work and the store of the reply share one
 * transaction, so a replay cannot race the first request.
 */
export async function runIdempotent(
  repo: Repository,
  request: { readonly userId: string; readonly key: string; readonly endpoint: string; readonly body: unknown; readonly now: number },
  work: (tx: Repository) => Promise<StoredReply>,
): Promise<StoredReply> {
  const bodyHash = hashBody(request.body);
  return repo.transaction(async (tx) => {
    const prior = await tx.idempotency.get(request.userId, request.key);
    if (prior !== null) {
      if (prior.endpoint !== request.endpoint || prior.bodyHash !== bodyHash) {
        throw new ApiError('idempotency.conflict', 'Idempotency-Key was used with another request');
      }
      return { status: prior.status, body: prior.body };
    }
    const reply = await work(tx);
    if (reply.status >= 200 && reply.status < 300) {
      await tx.idempotency.put({
        userId: request.userId,
        key: request.key,
        endpoint: request.endpoint,
        bodyHash,
        status: reply.status,
        body: reply.body,
        createdAt: request.now,
      });
    }
    return reply;
  });
}
