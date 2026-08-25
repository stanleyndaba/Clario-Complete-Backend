/**
 * An explicit operational circuit breaker for a running API process.
 *
 * This gate is intentionally opt-in. It suppresses startup of ordinary
 * background workers, schedulers, schema checks, and recovery routines while
 * retaining HTTP API availability. It must never be inferred from NODE_ENV or
 * any certification setting.
 */
export function isAllBackgroundAndRecoveryPaused(
  environment: NodeJS.ProcessEnv = process.env
): boolean {
  return environment.PAUSE_ALL_BACKGROUND_AND_RECOVERY === 'true';
}
