export const RECOVERY_WORKSPACE_ACTIVATION_PRODUCT = {
  key: 'recovery_workspace_activation',
  displayName: 'Recovery Workspace',
  amountSubunits: 179900,
  currency: 'ZAR',
} as const;

export type PaystackProductKey = typeof RECOVERY_WORKSPACE_ACTIVATION_PRODUCT.key;
