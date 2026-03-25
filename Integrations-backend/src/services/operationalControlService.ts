import featureFlagService from './featureFlagService';

type ControlName =
  | 'auto_filing'
  | 'recovery_reconciliation'
  | 'billing_charge'
  | 'new_ingestion';

const ENV_KEYS: Record<ControlName, string> = {
  auto_filing: 'AUTO_FILING_ENABLED',
  recovery_reconciliation: 'RECOVERY_RECONCILIATION_ENABLED',
  billing_charge: 'BILLING_CHARGE_ENABLED',
  new_ingestion: 'NEW_INGESTION_ENABLED'
};

const FLAG_KEYS: Record<ControlName, string> = {
  auto_filing: 'agent7_filing_enabled',
  recovery_reconciliation: 'agent8_reconciliation_enabled',
  billing_charge: 'agent9_billing_enabled',
  new_ingestion: 'agent2_ingestion_enabled'
};

function parseBoolean(value: string | undefined): boolean | null {
  if (value === undefined) return null;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'enabled', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'disabled', 'off'].includes(normalized)) return false;
  return null;
}

class OperationalControlService {
  async isEnabled(controlName: ControlName, defaultEnabled: boolean = true): Promise<boolean> {
    const envValue = parseBoolean(process.env[ENV_KEYS[controlName]]);
    if (envValue !== null) {
      return envValue;
    }

    const flag = await featureFlagService.getFlag(FLAG_KEYS[controlName]);
    if (flag) {
      return Boolean(flag.is_enabled);
    }

    return defaultEnabled;
  }
}

const operationalControlService = new OperationalControlService();

export default operationalControlService;
