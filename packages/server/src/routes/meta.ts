// API-005 GET /config (flags and packs) and GET /shop (catalogue with the sales kill switch).
// Neither needs a token (API-005: token optional).

import type { FastifyInstance } from 'fastify';
import type { GameService } from '../service.ts';

export function registerMetaRoutes(api: FastifyInstance, service: GameService, minClientVersion: string): void {
  api.get('/config', async () => service.config(minClientVersion));

  api.get('/shop', async () => service.shop());
}
