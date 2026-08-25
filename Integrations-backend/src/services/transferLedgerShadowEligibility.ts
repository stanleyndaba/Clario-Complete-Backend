import type { FlagEvaluation } from './featureFlagService';

export const TRANSFER_LEDGER_SHADOW_MODE = 'SHADOW';
export const TRANSFER_LEDGER_OBSERVATION_VERSION = 'v1';

export interface TransferLedgerShadowEligibility {
  /** The existing observation-only service may run, but can never become claim-capable. */
  eligible: boolean;
  /** Human-readable, stable reason for audit logs and future controlled rollout evidence. */
  reason: string;
  /** The normalized feature-flag mode observed at evaluation time. */
  mode: string;
  /** Fixed false by type and runtime contract. */
  claimCapable: false;
  /** The accepted observation schema/version, if stated by the payload. */
  observationVersion: string | null;
}

function normalizedString(value: unknown): string {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

function observationVersion(value: unknown): string | null {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || null;
}

/**
 * Applies an additional Transfer-specific safety gate after generic flag
 * evaluation. It intentionally treats a missing, malformed, or unsafe payload
 * as disabled. Passing this gate authorizes only observation persistence; it
 * does not authorize provider acquisition, pairing, detection, claims, or
 * economic activation.
 */
export function evaluateTransferLedgerShadowEligibility(
  evaluation: Pick<FlagEvaluation, 'enabled' | 'reason' | 'payload'>,
): TransferLedgerShadowEligibility {
  const payload = evaluation.payload || {};
  const mode = normalizedString(payload.mode);
  const version = observationVersion(payload.observation_version);

  if (!evaluation.enabled) {
    return {
      eligible: false,
      reason: `feature_flag_${evaluation.reason || 'disabled'}`,
      mode,
      claimCapable: false,
      observationVersion: version,
    };
  }

  if (mode !== TRANSFER_LEDGER_SHADOW_MODE) {
    return {
      eligible: false,
      reason: 'transfer_mode_not_shadow',
      mode,
      claimCapable: false,
      observationVersion: version,
    };
  }

  if (payload.claim_capable !== false) {
    return {
      eligible: false,
      reason: 'claim_capable_contract_missing_or_unsafe',
      mode,
      claimCapable: false,
      observationVersion: version,
    };
  }

  if (version !== TRANSFER_LEDGER_OBSERVATION_VERSION) {
    return {
      eligible: false,
      reason: 'unsupported_observation_version',
      mode,
      claimCapable: false,
      observationVersion: version,
    };
  }

  return {
    eligible: true,
    reason: 'shadow_zero_claim_contract_satisfied',
    mode,
    claimCapable: false,
    observationVersion: version,
  };
}
