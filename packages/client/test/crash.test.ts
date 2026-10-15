import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/lib/apiErrors.ts';
import { isRenderCrash } from '../src/lib/crash.ts';
import { STRINGS } from '../src/strings.ru.ts';

describe('error boundary rule (ERR-006)', () => {
  it('treats runtime failures as crashes but not API or network failures', () => {
    expect(isRenderCrash(new TypeError('boom'))).toBe(true);
    expect(isRenderCrash('plain value')).toBe(true);
    expect(isRenderCrash(new ApiError('server.error', 500))).toBe(false);
    expect(isRenderCrash(new ApiError('network', 0))).toBe(false);
  });

  it('has the Russian texts of the crash and flagged-run messages', () => {
    expect(STRINGS['err.run_crashed']).toMatch(/[А-Яа-я]/);
    expect(STRINGS['err.run_flagged']).toMatch(/[А-Яа-я]/);
    expect(STRINGS['err.run.active']).toMatch(/[А-Яа-я]/);
    expect(STRINGS['err.run.timeout']).toMatch(/[А-Яа-я]/);
  });
});
