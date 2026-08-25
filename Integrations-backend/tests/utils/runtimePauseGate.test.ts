import { describe, expect, it } from '@jest/globals';
import { isAllBackgroundAndRecoveryPaused } from '../../src/utils/runtimePauseGate';

describe('isAllBackgroundAndRecoveryPaused', () => {
  it('is disabled when the pause flag is absent', () => {
    expect(isAllBackgroundAndRecoveryPaused({})).toBe(false);
  });

  it('is disabled for any value other than the explicit true literal', () => {
    expect(isAllBackgroundAndRecoveryPaused({ PAUSE_ALL_BACKGROUND_AND_RECOVERY: 'false' })).toBe(false);
    expect(isAllBackgroundAndRecoveryPaused({ PAUSE_ALL_BACKGROUND_AND_RECOVERY: 'TRUE' })).toBe(false);
  });

  it('is enabled only by the explicit true literal', () => {
    expect(isAllBackgroundAndRecoveryPaused({ PAUSE_ALL_BACKGROUND_AND_RECOVERY: 'true' })).toBe(true);
  });
});
