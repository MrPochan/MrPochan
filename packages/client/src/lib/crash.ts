// Crash rule of the error boundary (ERR-006). DOM-free so it can be tested.
import { ApiError } from './apiErrors.ts';

/**
 * True for an unhandled promise rejection that is a runtime failure. API and network failures are shown
 * with their own text by the screen that made the request, so they never end a run.
 */
export function isRenderCrash(reason: unknown): boolean {
  return !(reason instanceof ApiError);
}
