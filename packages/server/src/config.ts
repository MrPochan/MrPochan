// Environment configuration of the server (PORT, BOT_TOKEN, NODE_ENV, MIN_CLIENT_VERSION).

export const DEFAULT_PORT = 8787;
export const DEFAULT_MIN_CLIENT_VERSION = '0.1.0';

export type NodeEnv = 'development' | 'test' | 'production';

export interface ServerConfig {
  readonly port: number;
  readonly nodeEnv: NodeEnv;
  /** Bot token used as the HMAC base of initData (AUTH-001). Null disables Telegram auth. */
  readonly botToken: string | null;
  /** Lowest client version that may call the API (API-000, CI-004). Semver "major.minor.patch". */
  readonly minClientVersion: string;
  /**
   * Origins allowed to call the API from a browser (CORS), exact `scheme://host[:port]` values.
   * The static client is hosted apart from the API in production (ТЗ 3). Empty: no CORS headers.
   */
  readonly corsOrigins?: readonly string[];
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/**
 * Reads the configuration from environment variables.
 * In production BOT_TOKEN is required. In development and test it may be absent:
 * then Telegram auth is disabled and only guest auth works.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const nodeEnv = parseNodeEnv(env.NODE_ENV);
  const port = parsePort(env.PORT);
  const botToken = blankToNull(env.BOT_TOKEN);
  if (nodeEnv === 'production' && botToken === null) {
    throw new ConfigError('BOT_TOKEN is required when NODE_ENV=production');
  }
  const minClientVersion = blankToNull(env.MIN_CLIENT_VERSION) ?? DEFAULT_MIN_CLIENT_VERSION;
  if (!/^\d+\.\d+\.\d+$/.test(minClientVersion)) {
    throw new ConfigError(`MIN_CLIENT_VERSION must be major.minor.patch, got "${minClientVersion}"`);
  }
  const corsOrigins = parseOrigins(env.CORS_ORIGINS);
  return { port, nodeEnv, botToken, minClientVersion, corsOrigins };
}

/** CORS_ORIGINS: comma-separated exact origins, for example https://game.example.com,https://www.example.com. */
export function parseOrigins(raw: string | undefined): readonly string[] {
  if (raw === undefined || raw.trim() === '') return [];
  return raw.split(',').map((item) => {
    const origin = item.trim();
    let normalized: string;
    try {
      normalized = new URL(origin).origin;
    } catch {
      throw new ConfigError(`CORS_ORIGINS holds a value that is not an origin: "${origin}"`);
    }
    if (normalized !== origin) throw new ConfigError(`CORS_ORIGINS values must be bare origins, got "${origin}"`);
    return origin;
  });
}

function parseNodeEnv(raw: string | undefined): NodeEnv {
  if (raw === undefined || raw === '') return 'development';
  if (raw === 'development' || raw === 'test' || raw === 'production') return raw;
  throw new ConfigError(`NODE_ENV must be development, test or production, got "${raw}"`);
}

function parsePort(raw: string | undefined): number {
  if (raw === undefined || raw === '') return DEFAULT_PORT;
  if (!/^\d{1,5}$/.test(raw)) throw new ConfigError(`PORT must be an integer, got "${raw}"`);
  const port = Number(raw);
  if (port < 1 || port > 65_535) throw new ConfigError(`PORT out of range: ${port}`);
  return port;
}

function blankToNull(raw: string | undefined): string | null {
  if (raw === undefined) return null;
  const trimmed = raw.trim();
  return trimmed === '' ? null : trimmed;
}
