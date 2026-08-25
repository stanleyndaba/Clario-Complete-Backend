import { describe, expect, it } from '@jest/globals';
import { evaluateTransferLedgerShadowEligibility } from '../../src/services/transferLedgerShadowEligibility';

const evaluation = (overrides: Record<string, unknown> = {}) => ({
  enabled: true,
  reason: 'enabled_for_all',
  payload: {
    mode: 'SHADOW',
    claim_capable: false,
    observation_version: 'v1',
  },
  ...overrides,
});

describe('Transfer Ledger Shadow eligibility gate', () => {
  it('keeps the certified production OFF result ineligible and zero-claim', () => {
    const result = evaluateTransferLedgerShadowEligibility(evaluation({
      enabled: false,
      reason: 'flag_disabled',
      payload: { mode: 'OFF', claim_capable: false, observation_version: 'v1' },
    }));

    expect(result).toEqual({
      eligible: false,
      reason: 'feature_flag_flag_disabled',
      mode: 'OFF',
      claimCapable: false,
      observationVersion: 'v1',
    });
  });

  it('allows only an explicit SHADOW, zero-claim, v1 observation contract', () => {
    expect(evaluateTransferLedgerShadowEligibility(evaluation())).toEqual({
      eligible: true,
      reason: 'shadow_zero_claim_contract_satisfied',
      mode: 'SHADOW',
      claimCapable: false,
      observationVersion: 'v1',
    });
  });

  it('rejects enabled flags that are not explicitly SHADOW', () => {
    const result = evaluateTransferLedgerShadowEligibility(evaluation({
      payload: { mode: 'ON', claim_capable: false, observation_version: 'v1' },
    }));

    expect(result).toEqual(expect.objectContaining({
      eligible: false,
      reason: 'transfer_mode_not_shadow',
      claimCapable: false,
    }));
  });

  it('rejects a missing or unsafe claim-capability declaration', () => {
    for (const claimCapable of [undefined, null, true, 'false']) {
      const result = evaluateTransferLedgerShadowEligibility(evaluation({
        payload: { mode: 'SHADOW', claim_capable: claimCapable, observation_version: 'v1' },
      }));

      expect(result).toEqual(expect.objectContaining({
        eligible: false,
        reason: 'claim_capable_contract_missing_or_unsafe',
        claimCapable: false,
      }));
    }
  });

  it('rejects an unsupported or absent observation version', () => {
    for (const version of [undefined, '', 'v2', ' V1 ']) {
      const result = evaluateTransferLedgerShadowEligibility(evaluation({
        payload: { mode: 'SHADOW', claim_capable: false, observation_version: version },
      }));

      expect(result).toEqual(expect.objectContaining({
        eligible: false,
        reason: 'unsupported_observation_version',
        claimCapable: false,
      }));
    }
  });
});
