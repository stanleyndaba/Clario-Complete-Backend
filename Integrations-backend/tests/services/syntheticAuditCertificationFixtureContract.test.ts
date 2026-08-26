import { describe, expect, it } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import { parseManualAuditDelimitedRecords } from '../../src/services/csvIngestionService';

const fixtureDirectory = path.resolve(__dirname, '../fixtures/syntheticAuditCertification');
const readFixture = (fileName: string) => fs.readFileSync(path.join(fixtureDirectory, fileName), 'utf8');

describe('synthetic audit certification fixture contract', () => {
  const canonicalFiles = [
    'orders_control.csv',
    'shipments_control.csv',
    'returns_control.csv',
    'settlements_control.csv',
    'financial_events_control.csv',
    'fees_control.csv',
    'inventory_ledger_control.txt',
  ];

  it('labels the fixture pack as synthetic training only and forbids live/commercial/Transfer assertions', () => {
    const manifest = JSON.parse(readFixture('manifest.json'));

    expect(manifest.provenance).toBe('SYNTHETIC_TRAINING_ONLY');
    expect(manifest.forbidden_assertions).toEqual(expect.arrayContaining([
      'live_amazon_provider_certification',
      'seller_recovery_exists',
      'claim_capable',
      'transfer_semantics',
      'transfer_economic_value',
      'commercial_eligibility',
    ]));
    expect(manifest.transfer_status).toMatchObject({
      enabled: false,
      rollout_percent: 0,
      claim_capable: false,
      p3: 'UNRESOLVED',
    });
  });

  it('parses every canonical CSV/TXT source fixture with at least one source row and no structural ambiguity', () => {
    for (const fileName of canonicalFiles) {
      const content = readFixture(fileName);
      const rows = parseManualAuditDelimitedRecords(content);

      expect(rows.length).toBeGreaterThan(0);
      expect(content).toContain('SYNTHETIC_TRAINING_ONLY');
    }
  });

  it('keeps meaningful identity, chronology, and money/quantity fields explicit in every canonical source', () => {
    const orders = parseManualAuditDelimitedRecords(readFixture('orders_control.csv'));
    const shipments = parseManualAuditDelimitedRecords(readFixture('shipments_control.csv'));
    const returns = parseManualAuditDelimitedRecords(readFixture('returns_control.csv'));
    const settlements = parseManualAuditDelimitedRecords(readFixture('settlements_control.csv'));
    const financialEvents = parseManualAuditDelimitedRecords(readFixture('financial_events_control.csv'));
    const fees = parseManualAuditDelimitedRecords(readFixture('fees_control.csv'));
    const ledger = parseManualAuditDelimitedRecords(readFixture('inventory_ledger_control.txt'));

    expect(orders[0]).toMatchObject({ AmazonOrderId: 'SYN-ORDER-001', PurchaseDate: '2026-07-01T10:00:00Z', OrderTotal: '120.00' });
    expect(shipments[0]).toMatchObject({ ShipmentId: 'SYN-SHIP-001', QuantityShipped: '10', QuantityReceived: '10', QuantityMissing: '0' });
    expect(returns[0]).toMatchObject({ ReturnId: 'SYN-RETURN-001', Quantity: '1', FNSKU: 'SYN-FNSKU-A' });
    expect(settlements[1]).toMatchObject({ SettlementId: 'SYN-SETTLEMENT-002', TransactionType: 'reimbursement', Amount: '120.00' });
    expect(financialEvents[0]).toMatchObject({ AdjustmentEventId: 'SYN-EVENT-REIMB-001', Amount: '120.00', Quantity: '1' });
    expect(fees[0]).toMatchObject({ EventId: 'SYN-FEE-001', FeeAmount: '-12.00' });
    expect(ledger[0]).toMatchObject({ 'Event Type': 'Receipts', Quantity: '10', 'Reference ID': 'SYN-LEDGER-RECEIPT-001' });
  });

  it('excludes Transfer fixtures and Transfer event types from the certification control pack', () => {
    const manifest = JSON.parse(readFixture('manifest.json'));
    const serializedManifest = JSON.stringify(manifest.scenarios).toLowerCase();

    expect(manifest.transfer_status.fixture_policy).toContain('No transfer fixture');
    expect(serializedManifest).not.toContain('transfer');
    for (const fileName of canonicalFiles) {
      expect(readFixture(fileName)).not.toMatch(/\btransfer\b/i);
    }
  });

  it('fails malformed synthetic parser scenarios before those files could be treated as valid records', () => {
    expect(() => parseManualAuditDelimitedRecords(readFixture('orders_duplicate_normalized_header.csv')))
      .toThrow('Duplicate normalized header');
    expect(() => parseManualAuditDelimitedRecords(readFixture('orders_extra_column.csv')))
      .toThrow('Malformed row 2: expected 4 columns but received 5');
  });
});
