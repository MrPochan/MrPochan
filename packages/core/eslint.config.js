// ESLint configuration of the core package (GEN-003). The generator must not read the clock or Math.random,
// must not use parseFloat or floating point. The rules are scoped to the generator files; the rest of the
// package is only parsed.
import tseslint from 'typescript-eslint';

/** Files of the generator and of its deterministic inputs (GEN-001..GEN-020). */
export const GENERATOR_FILES = ['src/board.ts', 'src/prng.ts', 'src/sha256.ts', 'src/cards.ts'];

export const generatorRules = {
  'no-restricted-globals': [
    'error',
    { name: 'Date', message: 'The generator must not read the clock (GEN-003).' },
    { name: 'parseFloat', message: 'The generator uses integers only (GEN-003).' },
  ],
  'no-restricted-properties': [
    'error',
    { object: 'Math', property: 'random', message: 'The generator must not use Math.random (GEN-003).' },
  ],
  'no-restricted-syntax': [
    'error',
    { selector: 'Literal[raw=/^[0-9]+\\.[0-9]*$/]', message: 'No fractional literals in the generator (GEN-003).' },
  ],
};

export default tseslint.config(
  { ignores: ['dist/**', 'test/golden/**'] },
  { files: ['**/*.ts'], languageOptions: { parser: tseslint.parser } },
  { files: GENERATOR_FILES, rules: generatorRules },
);
