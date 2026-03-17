import fs from 'fs';
import path from 'path';
import * as dotenv from 'dotenv';
import { CSVIngestionService } from '../src/services/csvIngestionService';
import logger from '../src/utils/logger';

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const userId = '00000000-0000-0000-0000-000000000000'; // Target user

async function runAudit() {
    const csvPath = path.resolve(__dirname, '../Inbound_Shipment_Ledger_Test.csv');
    
    if (!fs.existsSync(csvPath)) {
        console.error(`❌ CSV file not found: ${csvPath}`);
        process.exit(1);
    }

    console.log(`📂 Loading CSV: ${csvPath}`);
    const buffer = fs.readFileSync(csvPath);
    const file = {
        buffer,
        originalname: 'Inbound_Shipment_Ledger_Test.csv',
        mimetype: 'text/csv'
    };

    const ingestionService = new CSVIngestionService();

    console.log('🚀 Starting Ingestion and Detection Protocol...');
    
    try {
        const batchResult = await ingestionService.ingestFiles(userId, [file], {
            triggerDetection: true,
            explicitType: 'shipments'
        });

        console.log('\n📊 Audit Summary:');
        console.log('------------------');
        console.log(`✅ Success: ${batchResult.success}`);
        console.log(`🆔 Sync ID: ${batchResult.syncId}`);
        console.log(`🎯 Detection Triggered: ${batchResult.detectionTriggered}`);
        if (batchResult.detectionJobId) {
            console.log(`🆔 Detection Job ID: ${batchResult.detectionJobId}`);
        }

        batchResult.results.forEach((res, i) => {
            console.log(`\n📄 File ${i + 1}: ${res.fileName}`);
            console.log(`   Type Detect: ${res.csvType}`);
            console.log(`   Rows Processed: ${res.rowsProcessed}`);
            console.log(`   Rows Inserted: ${res.rowsInserted}`);
            if (res.errors.length > 0) {
                console.log(`   ❌ Errors: ${res.errors.join(', ')}`);
            }
        });

        if (batchResult.success) {
            console.log('\n✨ Audit Process Initiated Successfully.');
            console.log('The Enhanced Detection Engine (Agent 3) is now processing the data.');
        }

    } catch (error: any) {
        console.error('❌ Critical Failure during Audit:', error.message);
    }
}

runAudit();
