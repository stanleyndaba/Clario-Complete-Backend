export const RECOVERY_WORKSPACE_MONTHLY_PRODUCT = {
  key: 'recovery_workspace_monthly',
  displayName: 'Recovery Workspace',
  amountSubunits: 179900,
  currency: 'ZAR',
  interval: 'monthly',
} as const;

export const RECOVERY_WORKSPACE_ACTIVATION_PRODUCT = RECOVERY_WORKSPACE_MONTHLY_PRODUCT;

export const RECOVER_ONCE_PRODUCT = {
  key: 'recover_once',
  displayName: 'Recover Once',
  currency: 'ZAR',
  interval: 'one_time',
} as const;

export const RECOVER_ONCE_QUOTE_AMOUNTS = {
  light: 149900,
  standard: 299900,
  complex: 499900,
} as const;

export type PaystackProductKey =
  | typeof RECOVERY_WORKSPACE_MONTHLY_PRODUCT.key
  | typeof RECOVER_ONCE_PRODUCT.key;
