// Route registration. API paths follow ТЗ 5.3 (base path /api/v1, decision of API-000).
// /health sits outside the base path and needs no client version or token.

import type { FastifyInstance } from 'fastify';
import { clientVersionGuard, parseVersion } from '../http.ts';
import type { GameService } from '../service.ts';
import { registerAuthRoutes } from './auth.ts';
import { registerBoardRoutes } from './board.ts';
import { registerDailyRoutes } from './daily.ts';
import { registerMetaRoutes } from './meta.ts';
import { registerPlayerRoutes } from './player.ts';
import { registerRunRoutes } from './runs.ts';

export const API_PREFIX = '/api/v1';

export function registerRoutes(app: FastifyInstance, service: GameService, minClientVersion: string): void {
  const minimum = parseVersion(minClientVersion);
  if (minimum === null) throw new Error(`minimum client version is not semver: ${minClientVersion}`);

  app.get('/health', async () => ({ status: 'ok' }));

  app.register(
    async (api) => {
      api.addHook('onRequest', clientVersionGuard(minimum));
      registerMetaRoutes(api, service, minClientVersion);
      registerAuthRoutes(api, service);
      registerPlayerRoutes(api, service);
      registerDailyRoutes(api, service);
      registerRunRoutes(api, service);
      registerBoardRoutes(api, service);
    },
    { prefix: API_PREFIX },
  );
}
