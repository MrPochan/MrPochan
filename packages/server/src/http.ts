// HTTP plumbing shared by the routes: error mapping, client version check, bearer auth guards,
// Idempotency-Key extraction (API-000, ERR-001, ERR-010).

import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { RuleError } from '@cupquest/core';
import { ApiError } from './errors.ts';
import type { GameService } from './service.ts';
import type { UserRecord } from './store/repository.ts';

declare module 'fastify' {
  interface FastifyRequest {
    /** Account of the bearer token; set by requireAuth. */
    player?: UserRecord;
  }
}

export type SemVer = readonly [number, number, number];

/** Parses "major.minor.patch", optionally followed by "-pre" or "+build" (CI-004 adds a git sha). */
export function parseVersion(raw: string): SemVer | null {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.+-]*)?$/.exec(raw.trim());
  if (match === null) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareVersions(a: SemVer, b: SemVer): number {
  for (let i = 0; i < 3; i += 1) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** API-000: X-Client-Version is required on every API request; older clients get client.too_old. */
export function clientVersionGuard(minimum: SemVer): (request: FastifyRequest) => Promise<void> {
  return async (request) => {
    const header = request.headers['x-client-version'];
    if (typeof header !== 'string') throw new ApiError('validation.failed', 'X-Client-Version header is required');
    const version = parseVersion(header);
    if (version === null) throw new ApiError('validation.failed', 'X-Client-Version must be major.minor.patch');
    if (compareVersions(version, minimum) < 0) throw new ApiError('client.too_old', 'client version is below the minimum');
  };
}

/** AUTH-002: `Authorization: Bearer <device_token>`. */
export function requireAuth(service: GameService): (request: FastifyRequest) => Promise<void> {
  return async (request) => {
    const header = request.headers.authorization;
    if (header === undefined) throw new ApiError('auth.required', 'Authorization header is missing');
    const token = /^Bearer\s+(\S+)$/i.exec(header)?.[1];
    if (token === undefined) throw new ApiError('auth.invalid', 'Authorization must be a Bearer token');
    request.player = await service.authenticate(token);
  };
}

/**
 * AUTH-004: guests cannot use boards, purchases and the other linked-account features.
 * Async on purpose: a sync preHandler that does not call `done` leaves the request hanging.
 */
export async function requireLinked(request: FastifyRequest): Promise<void> {
  const player = playerOf(request);
  if (player.isGuest) throw new ApiError('guest.forbidden', 'this action needs a linked Telegram account');
}

export function playerOf(request: FastifyRequest): UserRecord {
  if (request.player === undefined) throw new ApiError('auth.required', 'not authenticated');
  return request.player;
}

/** Idempotency-Key is required on the POST endpoints that change state (API-000). */
export function idempotencyKey(request: FastifyRequest): string {
  const header = request.headers['idempotency-key'];
  if (typeof header !== 'string' || header.length < 1 || header.length > 128) {
    throw new ApiError('validation.failed', 'Idempotency-Key header is required (1..128 characters)');
  }
  return header;
}

/** Maps every error to the body `{ "code": "..." }` of ERR-001 with the status of its code. */
export function errorHandler(error: FastifyError, request: FastifyRequest, reply: FastifyReply): void {
  if (error instanceof ApiError) {
    void reply.code(error.status).send({ code: error.code });
    return;
  }
  if (error instanceof RuleError) {
    // Domain rules of @cupquest/core (energy.empty, coins.insufficient, ...) are business errors: 422.
    void reply.code(422).send({ code: error.code });
    return;
  }
  if (error.validation !== undefined) {
    void reply.code(400).send({ code: 'validation.failed' });
    return;
  }
  if (typeof error.statusCode === 'number' && error.statusCode >= 400 && error.statusCode < 500) {
    // Malformed JSON, unsupported media type, body too large.
    void reply.code(error.statusCode === 413 ? 413 : 400).send({ code: 'validation.failed' });
    return;
  }
  request.log.error({ err: error }, 'unhandled error');
  void reply.code(500).send({ code: 'server.error' });
}
