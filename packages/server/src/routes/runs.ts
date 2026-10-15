// API-009 POST /runs/start and API-010 POST /runs/submit.

import { HERO_ID_ORDER } from '@cupquest/core';
import type { FastifyInstance } from 'fastify';
import type { StartRunBody, SubmitRunBody } from '../contract.ts';
import { idempotencyKey, playerOf, requireAuth } from '../http.ts';
import type { GameService } from '../service.ts';

const SUBMIT_BODY_LIMIT_BYTES = 256 * 1024;

const startRunSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['mode', 'speed', 'team', 'daily'],
  properties: {
    mode: { enum: ['full', 'short5'] },
    speed: { enum: [1, 2] },
    team: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'string', enum: [...HERO_ID_ORDER] } },
    daily: { type: 'boolean' },
  },
};

const gateSchema = { type: 'integer', minimum: 0, maximum: 1000 };

// Ranges here are loose on purpose: a wave outside 1..15 or a wrong last_wave is run.invalid (SEC-001),
// which the service reports with the spec code. Only the JSON types are fixed at this layer.
const submitRunSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['run_id', 'result', 'last_wave', 'waves', 'gates', 'score', 'duration_ticks', 'resurrections', 'cards', 'log', 'log_sha256'],
  properties: {
    run_id: { type: 'string', pattern: '^[0-9a-fA-F-]{36}$' },
    result: { enum: ['win', 'loss', 'abandon'] },
    last_wave: { type: 'integer', minimum: 0, maximum: 255 },
    waves: {
      type: 'array',
      maxItems: 64,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['w', 'coins', 'balls', 'spend'],
        properties: {
          w: { type: 'integer', minimum: 0, maximum: 255 },
          coins: { type: 'integer', minimum: 0, maximum: 100_000 },
          balls: { type: 'integer', minimum: 0, maximum: 100_000 },
          spend: { type: 'integer', minimum: 0, maximum: 100_000 },
        },
      },
    },
    gates: {
      type: 'object',
      additionalProperties: false,
      required: ['x0', 'x1', 'x2', 'x3', 'x5'],
      properties: { x0: gateSchema, x1: gateSchema, x2: gateSchema, x3: gateSchema, x5: gateSchema },
    },
    score: { type: 'integer', minimum: 0, maximum: 100_000_000 },
    duration_ticks: { type: 'integer', minimum: 0, maximum: 100_000_000 },
    resurrections: { enum: [0, 1] },
    cards: {
      type: 'array',
      maxItems: 64,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['card_id', 'tier'],
        properties: {
          card_id: { type: 'string', minLength: 1, maxLength: 64 },
          tier: { type: 'integer', minimum: 1, maximum: 3 },
        },
      },
    },
    log: { type: 'string', maxLength: 250_000 },
    log_sha256: { type: 'string', pattern: '^[0-9a-fA-F]{64}$' },
  },
};

export function registerRunRoutes(api: FastifyInstance, service: GameService): void {
  const auth = requireAuth(service);

  api.post<{ Body: StartRunBody }>(
    '/runs/start',
    { preHandler: auth, schema: { body: startRunSchema } },
    async (request, reply) => {
      const stored = await service.startRun(playerOf(request).id, request.body, idempotencyKey(request));
      reply.code(stored.status);
      return stored.body;
    },
  );

  api.post<{ Body: SubmitRunBody }>(
    '/runs/submit',
    { preHandler: auth, bodyLimit: SUBMIT_BODY_LIMIT_BYTES, schema: { body: submitRunSchema } },
    async (request, reply) => {
      const stored = await service.submitRun(playerOf(request).id, request.body, idempotencyKey(request));
      reply.code(stored.status);
      return stored.body;
    },
  );
}
