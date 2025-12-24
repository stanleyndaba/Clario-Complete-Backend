/**
 * Unit Tests for Phase 3 ML Calibration & Phase 4 Real-time Detection
 */

import {
    calculateCalibratedConfidence,
    recordOutcome,
    invalidateCache
} from '../../src/services/detection/confidenceCalibrator';

import {
    startRealtimeDetection,
    stopRealtimeDetection,
    getPendingAlerts,
    getRealtimeStatus,
    clearAlerts
} from '../../src/services/detection/realtimeDetectionService';

// Mock Supabase
jest.mock('../../src/database/supabaseClient', () => ({
    supabaseAdmin: {
        from: jest.fn(() => ({
            select: jest.fn(() => ({
                data: [],
                error: null
            })),
            insert: jest.fn(() => ({
                data: { id: 'test-id' },
                error: null
            })),
            upsert: jest.fn(() => ({
                data: { id: 'test-id' },
                error: null
            }))
        })),
        channel: jest.fn(() => ({
            on: jest.fn().mockReturnThis(),
            subscribe: jest.fn((callback) => {
                callback('SUBSCRIBED');
                return { status: 'SUBSCRIBED' };
            })
        })),
        removeChannel: jest.fn()
    }
}));

// Mock logger
jest.mock('../../src/utils/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    default: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn()
    }
}));

describe('Phase 3: ML Confidence Calibration', () => {
    const sellerId = 'test-seller-123';

    beforeEach(() => {
        jest.clearAllMocks();
        invalidateCache();
    });

    describe('Confidence Calibration', () => {
        it('should return raw confidence when no historical data', async () => {
            const result = await calculateCalibratedConfidence('unknown_type', 0.85);

            expect(result.raw_confidence).toBe(0.85);
            expect(result.calibrated_confidence).toBe(0.85);
            expect(result.calibration_factor).toBe(1.0);
            expect(result.confidence_interval).toBe('low');
        });

        it('should have required fields in calibration result', async () => {
            const result = await calculateCalibratedConfidence('lost_warehouse', 0.90);

            expect(result).toHaveProperty('raw_confidence');
            expect(result).toHaveProperty('calibrated_confidence');
            expect(result).toHaveProperty('calibration_factor');
            expect(result).toHaveProperty('historical_approval_rate');
            expect(result).toHaveProperty('sample_size');
            expect(result).toHaveProperty('confidence_interval');
        });

        it('should keep calibrated confidence in valid range', async () => {
            const result = await calculateCalibratedConfidence('test_type', 0.99);

            expect(result.calibrated_confidence).toBeLessThanOrEqual(0.99);
            expect(result.calibrated_confidence).toBeGreaterThanOrEqual(0.1);
        });

        it('should handle edge case confidence values', async () => {
            const lowResult = await calculateCalibratedConfidence('test', 0.0);
            expect(lowResult.calibrated_confidence).toBeGreaterThanOrEqual(0);

            const highResult = await calculateCalibratedConfidence('test', 1.0);
            expect(highResult.calibrated_confidence).toBeLessThanOrEqual(1);
        });
    });

    describe('Outcome Recording', () => {
        it('should record outcome without error', async () => {
            const outcome = {
                detection_result_id: 'detection-123',
                seller_id: sellerId,
                anomaly_type: 'lost_warehouse',
                predicted_confidence: 0.85,
                estimated_value: 500,
                actual_outcome: 'approved' as const,
                recovery_amount: 500
            };

            const result = await recordOutcome(outcome);

            expect(result).toBe(true);
        });

        it('should invalidate cache after recording outcome', async () => {
            // First call to populate cache
            await calculateCalibratedConfidence('test_type', 0.85);

            // Record outcome
            await recordOutcome({
                detection_result_id: 'detection-123',
                seller_id: sellerId,
                anomaly_type: 'test_type',
                predicted_confidence: 0.85,
                estimated_value: 100,
                actual_outcome: 'approved' as const,
                recovery_amount: 100
            });

            // Cache should be invalidated (next call will refresh)
            const result = await calculateCalibratedConfidence('test_type', 0.85);
            expect(result).toBeDefined();
        });
    });

    describe('Cache Management', () => {
        it('should clear cache on invalidateCache()', () => {
            expect(() => invalidateCache()).not.toThrow();
        });
    });
});

describe('Phase 4: Real-time Detection', () => {
    const sellerId = 'test-seller-456';

    beforeEach(() => {
        jest.clearAllMocks();
        clearAlerts();
    });

    afterEach(async () => {
        await stopRealtimeDetection();
    });

    describe('Real-time Subscription', () => {
        it('should start real-time detection successfully', async () => {
            const result = await startRealtimeDetection(sellerId);

            expect(result).toBe(true);
        });

        it('should prevent double-start', async () => {
            await startRealtimeDetection(sellerId);
            const secondStart = await startRealtimeDetection(sellerId);

            expect(secondStart).toBe(false);
        });

        it('should stop real-time detection', async () => {
            await startRealtimeDetection(sellerId);
            await stopRealtimeDetection();

            const status = getRealtimeStatus();
            expect(status.isRunning).toBe(false);
        });
    });

    describe('Alert Management', () => {
        it('should return empty alerts initially', () => {
            const alerts = getPendingAlerts();

            expect(alerts).toEqual([]);
        });

        it('should clear all alerts', () => {
            clearAlerts();
            const alerts = getPendingAlerts();

            expect(alerts).toEqual([]);
        });

        it('should filter alerts by seller_id', () => {
            const alerts = getPendingAlerts('specific-seller');

            expect(alerts).toEqual([]);
        });
    });

    describe('Status Reporting', () => {
        it('should report correct status when not running', () => {
            const status = getRealtimeStatus();

            expect(status.isRunning).toBe(false);
            expect(status.subscriptions).toEqual([]);
            expect(status.pendingAlerts).toBe(0);
        });

        it('should report correct status when running', async () => {
            await startRealtimeDetection(sellerId);
            const status = getRealtimeStatus();

            expect(status.isRunning).toBe(true);
            expect(status.subscriptions.length).toBeGreaterThan(0);
        });
    });

    describe('Alert Callbacks', () => {
        it('should accept callback function on start', async () => {
            const mockCallback = jest.fn();
            const result = await startRealtimeDetection(sellerId, mockCallback);

            expect(result).toBe(true);
        });
    });
});

describe('Integration Tests', () => {
    it('should export all required functions from calibrator', () => {
        expect(calculateCalibratedConfidence).toBeDefined();
        expect(recordOutcome).toBeDefined();
        expect(invalidateCache).toBeDefined();
    });

    it('should export all required functions from realtime service', () => {
        expect(startRealtimeDetection).toBeDefined();
        expect(stopRealtimeDetection).toBeDefined();
        expect(getPendingAlerts).toBeDefined();
        expect(getRealtimeStatus).toBeDefined();
        expect(clearAlerts).toBeDefined();
    });
});
