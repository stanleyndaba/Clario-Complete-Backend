export const RECOVERY_WORKSPACE_MONTHLY_PRODUCT = {
  key: 'recovery_workspace_monthly',
  displayName: 'Recovery Workspace',
  amountSubunits: 179900,
  currency: 'ZAR',
  interval: 'monthly',
} as const;

export const RECOVERY_WORKSPACE_ACTIVATION_PRODUCT = RECOVERY_WORKSPACE_MONTHLY_PRODUCT;

export type PaystackProductKey = typeof RECOVERY_WORKSPACE_MONTHLY_PRODUCT.key;
