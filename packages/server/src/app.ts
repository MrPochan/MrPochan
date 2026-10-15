// Builds the Fastify application. Tests use buildApp with an in-memory repository and a fixed clock.

import { randomBytes } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import type { ServerConfig } from './config.ts';
import { NO_FRIENDS, type FriendsProvider } from './friends.ts';
import { errorHandler } from './http.ts';
import { registerRoutes } from './routes/index.ts';
import { GameService } from './service.ts';
import type { RandomSource } from './seed.ts';
import { MemoryRepository } from './store/memory.ts';
import type { Repository } from './store/repository.ts';

declare module 'fastify' {
  interface FastifyInstance {
    /** ERR-006 sweep, callable by tests and operators: closes expired started runs. Returns the count. */
    closeExpiredRuns: () => Promise<number>;
  }
}

export interface AppOptions {
  readonly config: ServerConfig;
  /** Defaults to an in-memory repository. */
  readonly repo?: Repository;
  /** Unix time in seconds. Defaults to the system clock. */
  readonly clock?: () => number;
  /** Source of random bytes for seeds and tokens. Defaults to crypto.randomBytes. */
  readonly random?: RandomSource;
  readonly friends?: FriendsProvider;
  readonly logger?: boolean;
  /** Period of the ERR-006 sweep in milliseconds. Unset: no background timer (tests call closeExpiredRuns). */
  readonly sweepIntervalMs?: number;
}

const CORS_ALLOWED_HEADERS = 'Authorization, Content-Type, Idempotency-Key, X-Client-Version';

export function buildApp(options: AppOptions): FastifyInstance {
  const app = Fastify({
    logger: options.logger ?? false,
    ajv: { customOptions: { coerceTypes: false, removeAdditional: false } },
  });

  const service = new GameService({
    repo: options.repo ?? new MemoryRepository(),
    botToken: options.config.botToken,
    clock: options.clock ?? (() => Math.floor(Date.now() / 1000)),
    random: options.random ?? ((size: number) => randomBytes(size)),
    friends: options.friends ?? NO_FRIENDS,
  });

  app.setErrorHandler(errorHandler);
  app.setNotFoundHandler((_request, reply) => {
    void reply.code(404).send({ code: 'not_found' });
  });
  app.addHook('onSend', async (_request, reply, payload) => {
    // PWA-003 and API-000: no response is cached.
    reply.header('Cache-Control', 'no-store');
    return payload;
  });

  // CORS for the static client hosted apart from the API (ТЗ 3). Only listed origins get the headers.
  const allowedOrigins = new Set(options.config.corsOrigins ?? []);
  app.addHook('onRequest', async (request, reply) => {
    const origin = request.headers.origin;
    if (typeof origin !== 'string' || !allowedOrigins.has(origin)) return;
    reply.header('Access-Control-Allow-Origin', origin);
    reply.header('Vary', 'Origin');
    reply.header('Access-Control-Expose-Headers', 'Retry-After');
    if (request.method === 'OPTIONS') {
      reply.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      reply.header('Access-Control-Allow-Headers', CORS_ALLOWED_HEADERS);
      reply.header('Access-Control-Max-Age', '600');
      await reply.code(204).send();
      return reply;
    }
    return undefined;
  });

  app.decorate('closeExpiredRuns', () => service.closeExpiredRuns());
  if (options.sweepIntervalMs !== undefined && options.sweepIntervalMs > 0) {
    const timer = setInterval(() => {
      service.closeExpiredRuns().catch((error: unknown) => app.log.error({ err: error }, 'run sweep failed'));
    }, options.sweepIntervalMs);
    timer.unref();
    app.addHook('onClose', async () => {
      clearInterval(timer);
    });
  }

  registerRoutes(app, service, options.config.minClientVersion);
  return app;
}
