import { UpstreamConnector, StandardizedDiscrepancy, UpstreamConnectorHealth } from './types';
import { AmazonSPAPIService } from '../services/amazonSPAPIService';
import { getLogger } from '../../../shared/utils/logger';
import { InventoryItem } from '../models/InventoryItem';
import { buildProofMetadata } from '../utils/proofHelpers';

const logger = getLogger('AmazonConnector');

export class AmazonConnector implements UpstreamConnector {
  name = 'amazon';
  private svc: AmazonSPAPIService;
  private lastRunAt?: string;
  private lastError?: string;

  constructor(service: AmazonSPAPIService) {
    this.svc = service;
  }

  isEnabled(): boolean {
    return process.env.ENABLE_AMAZON !== 'false';
  }

  async health(): Promise<UpstreamConnectorHealth> {
    return {
      name: this.name,
      enabled: this.isEnabled(),
      healthy: !this.lastError,
      lastRunAt: this.lastRunAt,
      lastError: this.lastError,
    };
  }

  async collectDiscrepancies(userId: string): Promise<StandardizedDiscrepancy[]> {
    if (!this.isEnabled()) return [];
    try {
      const summaries = await this.svc.fetchInventoryItems([process.env.AMAZON_MARKETPLACE_ID || 'ATVPDKIKX0DER']);
      const now = new Date().toISOString();
      const env: any = (globalThis as any).process ? (globalThis as any).process.env : {};
      const result: StandardizedDiscrepancy[] = [];

      for (const item of summaries as any[]) {
        const amazonQty = Number(item.quantity) || 0;
        const sku = item.sku;
        const internal = await InventoryItem.findBySku(sku, item.sellerId);
        const internalQty = internal?.quantity_available ?? 0;
        const delta = amazonQty - internalQty;
        if (delta === 0) continue;

        const { proof, confidence, valueComparison, mcdeDocumentUrl } = await buildProofMetadata(
          item.sellerId,
          sku,
          amazonQty,
          internalQty,
          {
            claimDetectorUrl: env.CLAIM_DETECTOR_URL,
            mcdeBaseUrl: env.MCDE_BASE_URL,
            mcdeApiKey: env.MCDE_API_KEY,
          }
        );

        result.push({
          product_id: item.asin || item.fnSku || sku,
          sku,
          quantity_synced: amazonQty,
          quantity_actual: internalQty,
          discrepancy_amount: delta,
          marketplace: 'amazon',
          timestamp: now,
          currency: 'USD',
          confidence,
          metadata: {
            marketplaceId: item.marketplaceId,
            sellerId: item.sellerId,
            proof,
            valueComparison,
            mcdeDocumentUrl,
          },
        });
      }

      this.lastRunAt = now;
      return result;
    } catch (e: any) {
      logger.error('AmazonConnector.collectDiscrepancies failed', e);
      this.lastError = e?.message || 'Unknown error';
      return [];
    }
  }
}


