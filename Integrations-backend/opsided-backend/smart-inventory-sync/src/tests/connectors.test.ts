import { ConnectorManager } from '../connectors/connectorManager';
import { UpstreamConnector, StandardizedDiscrepancy } from '../connectors/types';

class MockConnector implements UpstreamConnector {
  name = 'mock';
  constructor(private enabled: boolean, private count: number) {}
  isEnabled(): boolean { return this.enabled; }
  async health() { return { name: this.name, enabled: this.enabled, healthy: true }; }
  async collectDiscrepancies(): Promise<StandardizedDiscrepancy[]> {
    return Array.from({ length: this.count }).map((_, i) => ({
      product_id: `p-${i}`,
      sku: `sku-${i}`,
      quantity_synced: 10,
      quantity_actual: 8,
      discrepancy_amount: -2,
      marketplace: 'mock',
      timestamp: new Date().toISOString(),
      currency: 'USD',
    }));
  }
}

describe('ConnectorManager', () => {
  it('aggregates discrepancies and triggers claim detection (no-op without detector)', async () => {
    const manager = new ConnectorManager(null);
    manager.register(new MockConnector(true, 3));
    manager.register(new MockConnector(false, 5));
    const result = await manager.runAll('user-1');
    expect(result.total).toBe(3);
    expect(result.bySource['mock']).toBe(3);
  });
});



