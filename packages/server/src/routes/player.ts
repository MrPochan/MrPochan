// API-006 GET /me and API-007 GET /energy.

import type { FastifyInstance } from 'fastify';
import { playerOf, requireAuth } from '../http.ts';
import type { GameService } from '../service.ts';

export function registerPlayerRoutes(api: FastifyInstance, service: GameService): void {
  const auth = requireAuth(service);

  api.get('/me', { preHandler: auth }, async (request) => service.profile(playerOf(request)));

  api.get('/energy', { preHandler: auth }, async (request) => service.energy(playerOf(request).id));
}
