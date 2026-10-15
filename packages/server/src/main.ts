// Entry point: reads the environment, starts the server on PORT.

import { buildApp } from './app.ts';
import { ConfigError, loadConfig } from './config.ts';

async function main(): Promise<void> {
  const config = loadConfig();
  // ERR-006: the run sweep closes unsubmitted runs as timeout once a minute.
  const app = buildApp({ config, logger: true, sweepIntervalMs: 60_000 });
  if (config.botToken === null) {
    app.log.warn('BOT_TOKEN is not set: Telegram auth is disabled, only guest auth works');
  }

  const shutdown = (): void => {
    void app.close().then(() => process.exit(0));
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  await app.listen({ port: config.port, host: '0.0.0.0' });
}

main().catch((error: unknown) => {
  if (error instanceof ConfigError) {
    console.error(`configuration error: ${error.message}`);
  } else {
    console.error(error);
  }
  process.exit(1);
});
