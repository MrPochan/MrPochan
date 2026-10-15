// Build-time constants and environment variables used by the client.
declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  /** API base path or absolute URL. Defaults to /api/v1 (spec 5.3). */
  readonly VITE_API_BASE?: string;
  /** Git commit id injected by CI (CI-004). Optional. */
  readonly VITE_GIT_SHA?: string;
}
