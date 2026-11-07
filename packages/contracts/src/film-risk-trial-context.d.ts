/** Internal creative projection only. Hash before IPC; never render or trust it as authorization. */
export function trialObject(value: unknown): Record<string, unknown> | null;
export function riskTrialShots(record: unknown): Record<string, unknown>[];
export function riskTrialCreative(record: unknown): Record<string, unknown>;
export function riskTrialTarget(
  record: unknown,
  shot: Record<string, unknown>,
): Record<string, unknown>;
