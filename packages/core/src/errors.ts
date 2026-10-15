/** A rule violation with a stable machine-readable code (for example `battle.resurrect_used`, ERR-001). */
export class RuleError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'RuleError';
    this.code = code;
  }
}
