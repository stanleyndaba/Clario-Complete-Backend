/**
 * Evaluate Calibration Script
 * 
 * Runs the detection flow (using mock detection) against the generated dataset.
 * Compares results with claims_ground_truth.csv to calculate Precision, Recall, and F1.
 * Generates a reliability diagram (text-based).
 * 
 * Usage:
 *   ts-node src/scripts/evaluate-calibration.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { parse as csvParse } from 'csv-parse/sync';
import agent2DataSyncService from '../services/agent2DataSyncService';
import logger from '../utils/logger';

// Mock environment variables
process.env.MOCK_DETECTION_API = 'true';
process.env.MOCK_SCENARIO = 'realistic';

const DATA_DIR = path.join(__dirname, '../../mock_data_realistic');
const GROUND_TRUTH_FILE = path.join(DATA_DIR, 'claims_ground_truth.csv');

interface GroundTruth {
    entity_id: string;
    entity_type: string;
    is_claimable: number;
    anomaly_type: string;
}

async function evaluateCalibration() {
    console.log('🚀 Starting Calibration Evaluation...');

    // 1. Load Ground Truth
    if (!fs.existsSync(GROUND_TRUTH_FILE)) {
        console.error(`❌ Ground truth file not found: ${GROUND_TRUTH_FILE}`);
        console.error('   Please run: ts-node src/scripts/generate-realistic-dataset.ts first');
        process.exit(1);
    }

    const groundTruthRaw = fs.readFileSync(GROUND_TRUTH_FILE, 'utf-8');
    const groundTruthRecords = csvParse(groundTruthRaw, { columns: true }) as GroundTruth[];
    const groundTruthMap = new Map(groundTruthRecords.map(r => [r.entity_id, r]));

    console.log(`✅ Loaded ${groundTruthRecords.length} ground truth anomalies`);

    // 2. Load Generated Data (Simulate reading from DB)
    // We'll read the CSVs we generated to construct the input for Agent 2
    console.log('📂 Loading dataset...');

    const orders = loadCSV('orders.csv');
    const shipments = loadCSV('shipments.csv');
    const returns = loadCSV('returns.csv');
    const settlements = loadCSV('settlements.csv');

    // Normalize data structures to match what Agent 2 expects from DB
    // (Simplified normalization for this script)
    const normalizedData = {
        orders: orders.map(o => ({ ...o, order_id: o.AmazonOrderId, total_fees: 0 })), // minimal mapping
        shipments: shipments.map(s => ({ ...s, items: JSON.parse(s.items || '[]') })),
        returns: returns.map(r => ({ ...r, items: JSON.parse(r.items || '[]') })),
        settlements: settlements,
        inventory: [], // Skip inventory for now as it's complex to map back to claims in this simple script
        claims: []
    };

    console.log(`   - Orders: ${orders.length}`);
    console.log(`   - Shipments: ${shipments.length}`);
    console.log(`   - Returns: ${returns.length}`);
    console.log(`   - Settlements: ${settlements.length}`);

    // 3. Run Detection (Mock Mode)
    console.log('🔍 Running Detection (Mock Mode)...');

    // We need to access the private method callDiscoveryAgent or simulate its flow
    // Since it's private, we'll use the public syncUserData but that requires full DB setup.
    // Instead, we'll use a trick or just instantiate the service and call the private method via 'any' cast
    // OR better, we'll extract the detection logic we want to test.

    // Actually, we modified Agent 2 to have `simulateDetection`. We can test that directly if we can access it,
    // or we can call `callDiscoveryAgent` via cast.

    const service = agent2DataSyncService as any;

    // We need to mock the `signalDetectionCompletion` and `storeDetectionResults` to avoid DB errors
    service.signalDetectionCompletion = async () => { };
    service.storeDetectionResults = async (results: any[]) => {
        // Capture results here
        evaluateResults(results, groundTruthMap);
    };
    service.sendSyncLog = () => { }; // Silence logs

    try {
        await service.callDiscoveryAgent(
            'test-user',
            'test-sync-id',
            'test-detection-id',
            normalizedData
        );
    } catch (error: any) {
        console.error('❌ Detection failed:', error.message);
    }
}

function loadCSV(filename: string): any[] {
    const filePath = path.join(DATA_DIR, filename);
    if (!fs.existsSync(filePath)) return [];
    const content = fs.readFileSync(filePath, 'utf-8');
    return csvParse(content, { columns: true, skip_empty_lines: true });
}

function evaluateResults(results: any[], groundTruthMap: Map<string, GroundTruth>) {
    console.log('\n📊 Evaluation Results');
    console.log('==================================================');
    console.log(`Total Predictions: ${results.length}`);

    // Metrics at different thresholds
    const thresholds = [0.5, 0.6, 0.7, 0.8, 0.9];

    thresholds.forEach(threshold => {
        let tp = 0;
        let fp = 0;
        let fn = 0;

        const predictedPositives = results.filter(r => r.confidence_score >= threshold);

        predictedPositives.forEach(p => {
            // Extract entity ID from claim_id
            let entityId = '';
            const parts = p.claim_id.split('_');
            if (parts.length >= 4) {
                entityId = parts[2];
            }

            // Direct lookup
            const gtMatch = groundTruthMap.get(entityId);

            if (gtMatch) {
                tp++;
            } else {
                fp++;
            }
        });

        const totalGT = groundTruthMap.size;
        fn = totalGT - tp;

        const precision = tp / (tp + fp) || 0;
        const recall = tp / (tp + fn) || 0;
        const f1 = 2 * (precision * recall) / (precision + recall) || 0;

        console.log(`\nThreshold ${threshold}:`);
        console.log(`  Precision: ${(precision * 100).toFixed(2)}%`);
        console.log(`  Recall:    ${(recall * 100).toFixed(2)}%`);
        console.log(`  F1 Score:  ${(f1 * 100).toFixed(2)}`);
        console.log(`  (TP: ${tp}, FP: ${fp}, FN: ${fn})`);
    });

    // Reliability Diagram (Binning)
    console.log('\n📈 Reliability Diagram');
    console.log('Conf.  | Obs. Acc. | Count');
    console.log('-------|-----------|-------');

    const bins = [0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
    for (let i = 0; i < bins.length - 1; i++) {
        const min = bins[i];
        const max = bins[i + 1];

        const binItems = results.filter(r => r.confidence_score >= min && r.confidence_score < max);
        if (binItems.length === 0) continue;

        let correct = 0;
        binItems.forEach(p => {
            const parts = p.claim_id.split('_');
            const entityId = parts.length >= 4 ? parts[2] : '';
            if (groundTruthMap.has(entityId)) correct++;
        });

        const accuracy = correct / binItems.length;
        console.log(`${min.toFixed(1)}-${max.toFixed(1)} | ${(accuracy * 100).toFixed(1)}%     | ${binItems.length}`);
    }
}

evaluateCalibration().catch(console.error);
