// API-001 POST /auth/telegram, API-002 POST /auth/guest.

import type { FastifyInstance } from 'fastify';
import type { GuestLoginBody, TelegramLoginBody } from '../contract.ts';
import type { GameService } from '../service.ts';

const installIdSchema = { type: 'string', minLength: 1, maxLength: 128 };

export function registerAuthRoutes(api: FastifyInstance, service: GameService): void {
  api.post<{ Body: TelegramLoginBody }>(
    '/auth/telegram',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['init_data', 'install_id'],
          properties: {
            init_data: { type: 'string', minLength: 1, maxLength: 4096 },
            install_id: installIdSchema,
          },
        },
      },
    },
    async (request) => {
      const result = await service.telegramLogin(request.body);
      return { device_token: result.deviceToken, created: result.created, user: result.user };
    },
  );

  api.post<{ Body: GuestLoginBody }>(
    '/auth/guest',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['install_id'],
          properties: { install_id: installIdSchema },
        },
      },
    },
    async (request) => {
      const result = await service.guestLogin(request.body);
      return { device_token: result.deviceToken, user: result.user };
    },
  );
}
