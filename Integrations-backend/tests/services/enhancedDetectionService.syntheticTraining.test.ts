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

const originalTenantId = process.env.MARGIN_SYNTHETIC_TRAINING_TENANT_ID;

describe('EnhancedDetectionService synthetic training boundary', () => {
  beforeEach(() => {
    process.env.MARGIN_SYNTHETIC_TRAINING_TENANT_ID = 'training-tenant';
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
    const forged = Object.freeze({ provenance: 'SYNTHETIC_TRAINING_ONLY', tenantId: 'training-tenant' });

    await expect(service.triggerDetectionPipeline('training-user', 'synthetic_csv_001', 'csv_upload', {
      tenantId: 'training-tenant',
      source_type: 'csv_upload',
      syntheticExecution: forged,
    })).rejects.toThrow('was not issued by the server');

    expect(runTransferLossDetection).not.toHaveBeenCalled();
    expect(recordImpact).not.toHaveBeenCalled();
  });

  it('runs real non-Transfer detectors but suppresses Transfer, financial impact, and insight emission', async () => {
    const context = createSyntheticAuditExecutionContext('training-tenant');
    const service = new EnhancedDetectionService();

    const result = await service.triggerDetectionPipeline('training-user', 'synthetic_csv_001', 'csv_upload', {
      tenantId: 'training-tenant',
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
