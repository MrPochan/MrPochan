// Public API of @cupquest/core. Used by packages/server (rules, verification) and packages/client (animation, UI data).
// Core imports nothing from Phaser, Preact, the DOM, Telegram or the network.

// Seeds and PRNG (RNG-001..RNG-005).
export { kdf, Xoshiro128ss, SEED_BYTES } from './prng.ts';
export { sha256, toHex, fromHex } from './sha256.ts';

// Ball field (GEN-001..GEN-020).
export {
  generateBoard,
  generateBoardTrace,
  dropBall,
  boardViolations,
  fallbackSeeds,
  GATE_TYPES,
  GATE_CODE,
  BOARD_BYTES,
  FALLBACK_ATTEMPT,
  type Board,
  type GateType,
  type GenerationTrace,
  type BuildFailure,
} from './board.ts';

// Battle (CORE-012..CORE-027).
export {
  simulateWave,
  battleLogJson,
  battleLogHash,
  waveKind,
  waveEnemies,
  waveLimitTicks,
  HERO_ID_ORDER,
  type HeroStats,
  type BattleInput,
  type BattleResult,
  type BattleEvent,
  type EndReason,
  type EnemySpec,
  type ResurrectCommand,
} from './battle.ts';

// Cards (CARD-001..CARD-008).
export { poolFor, offerFor, helpCard, heroStatsFor, cardById, type TakenCard } from './cards.ts';

// Economy (ECO-001..ECO-012, C22).
export {
  coinsForWin,
  ballsForGate,
  rerollCost,
  upgradeCost,
  levelCost,
  druidGemCost,
  energyRead,
  energySpendOne,
  energyPurchaseAvailable,
  appendEntry,
  applyIdempotent,
  balanceOf,
  LedgerKeys,
  type Currency,
  type EnergyState,
  type LedgerEntry,
  type RunMode,
} from './economy.ts';

// Run state machine (CORE-001, CORE-012..CORE-014, CORE-026).
export {
  startRun,
  applyAction,
  ledgerForRun,
  type RunConfig,
  type RunState,
  type RunAction,
  type RunEvent,
  type RunPhase,
  type RunResult,
  type FieldEvent,
  type StepResult,
  type WaveRecord,
} from './run.ts';

// Catalogues and data checks for the client and the release build.
export { HERO_CATALOG, CARD_CATALOG, openBalanceEntries, ECONOMY_VIEW } from './catalog.ts';
export { RuleError } from './errors.ts';
