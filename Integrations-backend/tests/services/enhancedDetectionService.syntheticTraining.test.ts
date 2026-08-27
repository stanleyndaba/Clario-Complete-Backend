import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

const runLostInventoryDetection: any = jest.fn();
const runRefundWithoutReturnDetection: any = jest.fn();
const runFeeOverchargeDetection: any = jest.fn();
const runInboundDetection: any = jest.fn();
const runDamagedInventoryDetection: any = jest.fn();
const runTransferLossDetection: any = jest.fn();
const runSentinelDetection: any = jest.fn();
const recordImpact: any = jest.fn();
const generateInsights: any = jest.fn();

jest.mock('../../src/services/detection/core/registry', () => ({
  runLostInventoryDetection,
  runRefundWithoutReturnDetection,
  runFeeOverchargeDetection,
  runInboundDetection,
  runDamagedInventoryDetection,
  runTransferLossDetection,
  runSentinelDetection,
}));

jest.mock('../../src/services/financialImpactService', () => ({
  financialImpactService: { recordImpact },
  ImpactStatus: { DETECTED: 'DETECTED' },
}));

jest.mock('../../src/services/detection/patternAnalyzer', () => ({ generateInsights }));
jest.mock('../../src/services/detection/confidenceCalibrator', () => ({
  calculateCalibratedConfidence: jest.fn(async (_type: string, confidence: number) => ({ calibrated_confidence: confidence })),
}));
jest.mock('../../src/services/closedLoopIntelligenceService', () => ({
  getAdaptiveDetectionDecision: jest.fn(async (input: any) => ({
    suppressed: false,
    adjustedConfidence: input.rawConfidence,
  })),
}));
jest.mock('../../src/database/supabaseClient', () => ({
  supabaseAdmin: { from: jest.fn() },
}));

import { EnhancedDetectionService } from '../../src/services/enhancedDetectionService';
import { createSyntheticAuditExecutionContext } from '../../src/services/syntheticAuditExecutionContext';
import { supabaseAdmin } from '../../src/database/supabaseClient';

const originalTenantId = process.env.MARGIN_SYNTHETIC_TRAINING_TENANT_ID;

describe('EnhancedDetectionService synthetic training boundary', () => {
  beforeEach(() => {
    process.env.MARGIN_SYNTHETIC_TRAINING_TENANT_ID = '22222222-2222-4222-8222-222222222222';
    jest.clearAllMocks();
    runLostInventoryDetection.mockResolvedValue([]);
    runRefundWithoutReturnDetection.mockResolvedValue([]);
    runFeeOverchargeDetection.mockResolvedValue([]);
    runInboundDetection.mockResolvedValue([]);
    runDamagedInventoryDetection.mockResolvedValue([]);
    runSentinelDetection.mockResolvedValue([]);
  });

  afterEach(() => {
    if (originalTenantId === undefined) delete process.env.MARGIN_SYNTHETIC_TRAINING_TENANT_ID;
    else process.env.MARGIN_SYNTHETIC_TRAINING_TENANT_ID = originalTenantId;
  });

  it('rejects a forged JSON-shaped synthetic context before any detector can run', async () => {
    const service = new EnhancedDetectionService();
    const forged = Object.freeze({ provenance: 'SYNTHETIC_TRAINING_ONLY', tenantId: '22222222-2222-4222-8222-222222222222' });

    await expect(service.triggerDetectionPipeline('training-user', 'synthetic_csv_001', 'csv_upload', {
      tenantId: '22222222-2222-4222-8222-222222222222',
      source_type: 'csv_upload',
      syntheticExecution: forged,
    })).rejects.toThrow('was not issued by the server');

    expect(runTransferLossDetection).not.toHaveBeenCalled();
    expect(recordImpact).not.toHaveBeenCalled();
  });

  it('S9-SAME-HARD-REFERENCE: counts a shared Whale and Inbound source event only once while retaining both findings', async () => {
    const query: any = {
      select: jest.fn(() => query),
      eq: jest.fn(() => query),
      in: jest.fn(() => query),
      then: (resolve: any) => Promise.resolve({ data: [], error: null }).then(resolve),
    };
    (supabaseAdmin.from as jest.Mock).mockReturnValue(query);
    const whaleFinding: any = {
      seller_id: 'training-user',
      sync_id: 'synthetic_csv_001',
      anomaly_type: 'lost_in_transit',
      severity: 'medium',
      estimated_value: 40,
      currency: 'USD',
      confidence_score: 0.9,
      evidence: {
        fnsku: 'S9-SHARED-FNSKU',
        sku: 'S9-SHARED-SKU',
        physical_loss_units: 2,
        transfer_reference_ids: ['S9-SHARED-SHIPMENT-1'],
      },
    };
    const inboundFinding: any = {
      seller_id: 'training-user',
      sync_id: 'synthetic_csv_001',
      anomaly_type: 'shipment_shortage',
      severity: 'medium',
      estimated_value: 40,
      currency: 'USD',
      confidence_score: 0.9,
      shipment_id: 'S9-SHARED-SHIPMENT-1',
      sku: 'S9-SHARED-SKU',
      fnsku: 'S9-SHARED-FNSKU',
      evidence: {
        shipment_id: 'S9-SHARED-SHIPMENT-1',
        sku: 'S9-SHARED-SKU',
        fnsku: 'S9-SHARED-FNSKU',
      },
    };
    runLostInventoryDetection.mockResolvedValue([whaleFinding]);
    runInboundDetection.mockResolvedValue([inboundFinding]);
    const context = createSyntheticAuditExecutionContext('22222222-2222-4222-8222-222222222222');
    const service = new EnhancedDetectionService();

    const result = await service.triggerDetectionPipeline('training-user', 'synthetic_csv_001', 'csv_upload', {
      tenantId: '22222222-2222-4222-8222-222222222222',
      source_type: 'csv_upload',
      syntheticExecution: context,
    });

    expect(result).toMatchObject({ success: true, detectionsFound: 2, estimatedRecovery: 40 });
    expect(whaleFinding.evidence).toMatchObject({
      cross_rail_overlap: expect.objectContaining({ status: 'overlaps_inbound_inspector', linked_shipment_ids: ['S9-SHARED-SHIPMENT-1'] }),
      economic_rollup: expect.objectContaining({ status: 'linked_not_counted', counted_value: 0, authoritative_detector: 'Inbound Inspector' }),
    });
    expect(inboundFinding.evidence).toMatchObject({
      cross_rail_overlap: expect.objectContaining({ status: 'authoritative_inbound_shipment_loss' }),
      economic_rollup: expect.objectContaining({ status: 'counted', counted_value: 40, authoritative_detector: 'Inbound Inspector' }),
    });
    expect(runTransferLossDetection).not.toHaveBeenCalled();
    expect(recordImpact).not.toHaveBeenCalled();
  });

  it('S9-SAME-REFERENCE-FNSKU-CONFLICT: retains separate values when a shared reference has explicitly incompatible observed inventory identity', async () => {
    const query: any = {
      select: jest.fn(() => query),
      eq: jest.fn(() => query),
      in: jest.fn(() => query),
      then: (resolve: any) => Promise.resolve({ data: [], error: null }).then(resolve),
    };
    (supabaseAdmin.from as jest.Mock).mockReturnValue(query);
    runLostInventoryDetection.mockResolvedValue([{
      seller_id: 'training-user', sync_id: 'synthetic_csv_001', anomaly_type: 'lost_in_transit', severity: 'medium',
      estimated_value: 40, currency: 'USD', confidence_score: 0.9,
      evidence: { fnsku: 'S9-CONFLICT-FNSKU-A', sku: 'S9-CONFLICT-SKU', physical_loss_units: 2, transfer_reference_ids: ['S9-CONFLICT-SHIPMENT-1'] },
    }]);
    runInboundDetection.mockResolvedValue([{
      seller_id: 'training-user', sync_id: 'synthetic_csv_001', anomaly_type: 'shipment_shortage', severity: 'medium',
      estimated_value: 40, currency: 'USD', confidence_score: 0.9, shipment_id: 'S9-CONFLICT-SHIPMENT-1',
      sku: 'S9-CONFLICT-SKU', fnsku: 'S9-CONFLICT-FNSKU-B',
      evidence: { shipment_id: 'S9-CONFLICT-SHIPMENT-1', sku: 'S9-CONFLICT-SKU', fnsku: 'S9-CONFLICT-FNSKU-B' },
    }]);
    const context = createSyntheticAuditExecutionContext('22222222-2222-4222-8222-222222222222');
    const result = await new EnhancedDetectionService().triggerDetectionPipeline('training-user', 'synthetic_csv_001', 'csv_upload', {
      tenantId: '22222222-2222-4222-8222-222222222222', source_type: 'csv_upload', syntheticExecution: context,
    });

    expect(result).toMatchObject({ success: true, detectionsFound: 2, estimatedRecovery: 80 });
    expect(runTransferLossDetection).not.toHaveBeenCalled();
    expect(recordImpact).not.toHaveBeenCalled();
  });

  it('S9-DIFFERENT-HARD-REFERENCES: retains separate values for the same inventory family when source identifiers differ', async () => {
    const query: any = {
      select: jest.fn(() => query),
      eq: jest.fn(() => query),
      in: jest.fn(() => query),
      then: (resolve: any) => Promise.resolve({ data: [], error: null }).then(resolve),
    };
    (supabaseAdmin.from as jest.Mock).mockReturnValue(query);
    runLostInventoryDetection.mockResolvedValue([{
      seller_id: 'training-user', sync_id: 'synthetic_csv_001', anomaly_type: 'lost_in_transit', severity: 'medium',
      estimated_value: 40, currency: 'USD', confidence_score: 0.9,
      evidence: { fnsku: 'S9-DISTINCT-FNSKU', sku: 'S9-DISTINCT-SKU', physical_loss_units: 2, transfer_reference_ids: ['S9-WHALE-REFERENCE-1'] },
    }]);
    runInboundDetection.mockResolvedValue([{
      seller_id: 'training-user', sync_id: 'synthetic_csv_001', anomaly_type: 'shipment_shortage', severity: 'medium',
      estimated_value: 40, currency: 'USD', confidence_score: 0.9, shipment_id: 'S9-INBOUND-SHIPMENT-1',
      sku: 'S9-DISTINCT-SKU', fnsku: 'S9-DISTINCT-FNSKU',
      evidence: { shipment_id: 'S9-INBOUND-SHIPMENT-1', sku: 'S9-DISTINCT-SKU', fnsku: 'S9-DISTINCT-FNSKU' },
    }]);
    const context = createSyntheticAuditExecutionContext('22222222-2222-4222-8222-222222222222');
    const result = await new EnhancedDetectionService().triggerDetectionPipeline('training-user', 'synthetic_csv_001', 'csv_upload', {
      tenantId: '22222222-2222-4222-8222-222222222222', source_type: 'csv_upload', syntheticExecution: context,
    });

    expect(result).toMatchObject({ success: true, detectionsFound: 2, estimatedRecovery: 80 });
    expect(runTransferLossDetection).not.toHaveBeenCalled();
    expect(recordImpact).not.toHaveBeenCalled();
  });

  it('runs real non-Transfer detectors but suppresses Transfer, financial impact, and insight emission', async () => {
    const context = createSyntheticAuditExecutionContext('22222222-2222-4222-8222-222222222222');
    const service = new EnhancedDetectionService();

    const result = await service.triggerDetectionPipeline('training-user', 'synthetic_csv_001', 'csv_upload', {
      tenantId: '22222222-2222-4222-8222-222222222222',
      source_type: 'csv_upload',
      syntheticExecution: context,
    });

    expect(result.success).toBe(true);
    expect(runLostInventoryDetection).toHaveBeenCalledWith('training-user', 'synthetic_csv_001');
    expect(runRefundWithoutReturnDetection).toHaveBeenCalledWith('training-user', 'synthetic_csv_001');
    expect(runDamagedInventoryDetection).toHaveBeenCalledWith('training-user', 'synthetic_csv_001');
    expect(runFeeOverchargeDetection).toHaveBeenCalledWith('training-user', 'synthetic_csv_001');
    expect(runInboundDetection).toHaveBeenCalledWith('training-user', 'synthetic_csv_001');
    expect(runSentinelDetection).toHaveBeenCalledWith('training-user', 'synthetic_csv_001');
    expect(runTransferLossDetection).not.toHaveBeenCalled();
    expect(recordImpact).not.toHaveBeenCalled();
    expect(generateInsights).not.toHaveBeenCalled();
  });
});
