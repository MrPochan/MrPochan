// API-008 GET /seeds/daily.

import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../http.ts';
import type { GameService } from '../service.ts';

export function registerDailyRoutes(api: FastifyInstance, service: GameService): void {
  api.get('/seeds/daily', { preHandler: requireAuth(service) }, async () => service.dailySeed());
}
