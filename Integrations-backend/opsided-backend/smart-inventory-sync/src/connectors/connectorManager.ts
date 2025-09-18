import { UpstreamConnector, UpstreamConnectorHealth, StandardizedDiscrepancy, mapToClaimDetector } from './types';
import { getLogger } from '../../../shared/utils/logger';
import { ClaimDetectorIntegrationService } from '../services/claimDetectorIntegrationService';

const logger = getLogger('ConnectorManager');

export class ConnectorManager {
  private connectors: UpstreamConnector[] = [];
  private claimDetector: ClaimDetectorIntegrationService | null;

  constructor(claimDetector: ClaimDetectorIntegrationService | null) {
    this.claimDetector = claimDetector;
  }

  register(connector: UpstreamConnector) {
    this.connectors.push(connector);
  }

  list(): UpstreamConnector[] {
    return this.connectors;
  }

  async health(): Promise<UpstreamConnectorHealth[]> {
    return Promise.all(this.connectors.map(c => c.health()));
  }

  async runAll(userId: string): Promise<{ total: number; bySource: Record<string, number> }> {
    const bySource: Record<string, number> = {};
    let total = 0;

    for (const connector of this.connectors) {
      if (!connector.isEnabled()) continue;
      const standardDiscrepancies: StandardizedDiscrepancy[] = await connector.collectDiscrepancies(userId);
      const analyses = standardDiscrepancies.map(mapToClaimDetector);
      bySource[connector.name] = analyses.length;
      total += analyses.length;

      if (analyses.length && this.claimDetector) {
        try {
          await this.claimDetector.triggerClaimDetection(
            userId,
            {
              success: true,
              itemsProcessed: analyses.length,
              itemsUpdated: 0,
              itemsCreated: 0,
              itemsDeleted: 0,
              discrepanciesFound: analyses.length,
              discrepanciesResolved: 0,
              errors: [],
              metadata: {
                syncDuration: 0,
                lastSyncTimestamp: new Date(),
                sourceSystems: [connector.name],
                reconciliationRules: [],
              },
            },
            analyses,
            `connector-${connector.name}-${Date.now()}`
          );
        } catch (e) {
          logger.error(`Claim detection trigger failed for ${connector.name}`, e);
        }
      }
    }

    return { total, bySource };
  }
}



