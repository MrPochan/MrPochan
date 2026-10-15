// API-016 GET /board/weekly. The daily board (API-015) and the run card (API-017) are not in this iteration.

import type { FastifyInstance } from 'fastify';
import { playerOf, requireAuth, requireLinked } from '../http.ts';
import type { GameService } from '../service.ts';

export function registerBoardRoutes(api: FastifyInstance, service: GameService): void {
  api.get('/board/weekly', { preHandler: [requireAuth(service), requireLinked] }, async (request) =>
    service.weeklyBoard(playerOf(request).id),
  );
}
