// Fetch client for the spec 5.3 endpoints: headers (X-Client-Version, Bearer token, Idempotency-Key),
// error mapping (ERR-001) and retries (ERR-002, ERR-012). Dependencies are injected so it can be tested.
import { ApiError, errorFromResponse, networkError } from './lib/apiErrors.ts';
import { planRetry } from './lib/retry.ts';

export type Method = 'GET' | 'POST' | 'DELETE';

export interface RequestOptions {
  readonly query?: Readonly<Record<string, string | number | undefined>>;
  readonly body?: unknown;
  /** POST with an Idempotency-Key: the same key is reused on every retry (ERR-002). */
  readonly idempotent?: boolean;
  /** Explicit Idempotency-Key, for callers that retry at a higher level (run submit, ERR-005). */
  readonly key?: string;
}

export interface ApiDeps {
  /** Base path of the API, for example /api/v1 (spec 5.3). */
  readonly baseUrl: string;
  readonly clientVersion: string;
  readonly fetch: (input: string, init: RequestInit) => Promise<Response>;
  readonly sleep: (ms: number) => Promise<void>;
  readonly newKey: () => string;
  /** Called for client.too_old (HTTP 426) so the app can show the update screen (ERR-010). */
  readonly onFatal?: (error: ApiError) => void;
}

export class Api {
  private token: string | null = null;

  constructor(private readonly deps: ApiDeps) {}

  setToken(token: string | null): void {
    this.token = token;
  }

  get<T>(path: string, query?: RequestOptions['query']): Promise<T> {
    return this.send<T>('GET', path, query ? { query } : {});
  }

  post<T>(path: string, body?: unknown, opts: { idempotent?: boolean; key?: string } = {}): Promise<T> {
    return this.send<T>('POST', path, { body: body ?? {}, idempotent: opts.idempotent === true, key: opts.key });
  }

  /** Sends a request with the retry rules of ERR-002 and ERR-012. Throws ApiError on failure. */
  async send<T>(method: Method, path: string, opts: RequestOptions = {}): Promise<T> {
    const key = opts.key ?? (opts.idempotent ? this.deps.newKey() : undefined);
    let attempt = 0;
    for (;;) {
      try {
        return await this.once<T>(method, path, opts, key);
      } catch (e) {
        const error = e instanceof ApiError ? e : networkError();
        if (error.code === 'client.too_old') this.deps.onFatal?.(error);
        const delay = planRetry(error, { attempt, replaySafe: method === 'GET' || key !== undefined });
        if (delay === null) throw error;
        attempt++;
        await this.deps.sleep(delay);
      }
    }
  }

  private buildUrl(path: string, query?: RequestOptions['query']): string {
    const url = `${this.deps.baseUrl}${path}`;
    if (!query) return url;
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v !== undefined) params.set(k, String(v));
    const qs = params.toString();
    return qs ? `${url}?${qs}` : url;
  }

  private async once<T>(method: Method, path: string, opts: RequestOptions, key: string | undefined): Promise<T> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'X-Client-Version': this.deps.clientVersion,
    };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    if (key) headers['Idempotency-Key'] = key;
    let body: string | undefined;
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(opts.body);
    }
    let res: Response;
    try {
      res = await this.deps.fetch(this.buildUrl(path, opts.query), { method, headers, body });
    } catch {
      throw networkError();
    }
    const text = await res.text().catch(() => '');
    let parsed: unknown;
    if (text.length > 0) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = undefined;
      }
    }
    if (!res.ok) throw errorFromResponse(res.status, parsed, res.headers.get('Retry-After'));
    if (parsed === undefined) throw new ApiError('server.error', res.status);
    return parsed as T;
  }
}
