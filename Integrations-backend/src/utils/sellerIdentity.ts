const PENDING_AMAZON_SELLER_PREFIX = 'pending-amazon-seller-';

export function buildPendingAmazonSellerId(userId: string): string {
  const normalized = String(userId || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
  const suffix = normalized || 'anonymous';
  return `${PENDING_AMAZON_SELLER_PREFIX}${suffix}`.slice(0, 255);
}

export function isPendingAmazonSellerId(value?: string | null): boolean {
  return typeof value === 'string' && value.startsWith(PENDING_AMAZON_SELLER_PREFIX);
}

export function normalizeResolvedAmazonSellerId(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    if (!value || isPendingAmazonSellerId(value)) {
      continue;
    }

    return value;
  }

  return null;
}
