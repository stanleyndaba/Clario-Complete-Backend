import { DiscrepancyAnalysis } from '../services/inventoryReconciliationService';

export interface StandardizedDiscrepancy {
  product_id: string;
  sku: string;
  quantity_synced: number;
  quantity_actual: number;
  discrepancy_amount: number;
  marketplace: string;
  timestamp: string; // ISO string
  currency: string;
  metadata?: Record<string, any>;
  confidence?: number; // 0..1
}

export interface UpstreamConnectorHealth {
  name: string;
  enabled: boolean;
  healthy: boolean;
  lastRunAt?: string;
  lastError?: string;
}

export interface UpstreamConnector {
  name: string;
  isEnabled(): boolean;
  health(): Promise<UpstreamConnectorHealth>;
  collectDiscrepancies(userId: string): Promise<StandardizedDiscrepancy[]>;
}

export function mapToClaimDetector(discrepancy: StandardizedDiscrepancy): DiscrepancyAnalysis {
  return {
    sku: discrepancy.sku,
    discrepancyType: 'quantity',
    sourceSystem: discrepancy.marketplace,
    sourceValue: discrepancy.quantity_synced,
    targetSystem: 'actual',
    targetValue: discrepancy.quantity_actual,
    severity: Math.abs(discrepancy.discrepancy_amount) >= 10 ? 'high' : 'low',
    confidence: typeof discrepancy.confidence === 'number' ? discrepancy.confidence : 0.8,
    suggestedAction: 'investigate',
    metadata: {
      lastSyncTime: new Date(discrepancy.timestamp),
      historicalDrift: Math.abs(discrepancy.discrepancy_amount),
      impactScore: Math.abs(discrepancy.discrepancy_amount),
      currency: discrepancy.currency,
      product_id: discrepancy.product_id,
      marketplace: discrepancy.marketplace,
      ...discrepancy.metadata,
    },
  };
}



