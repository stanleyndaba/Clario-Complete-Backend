/**
 * Integration Example: Cost Documentation Module
 * 
 * This example demonstrates how to integrate the Cost Documentation module
 * with your existing detection pipeline and dashboard.
 */

import { costDocumentationWorker } from '../src/workers/costDocumentationWorker';
import { CostDocumentationService } from '../src/services/costDocumentationService';
import { AnomalyEvidence } from '../src/types/costDocumentation';

// Example 1: Automatic Trigger from Detection Pipeline
async function automaticTriggerExample() {
  console.log('🚀 Example 1: Automatic Trigger from Detection Pipeline');
  
  try {
    // This would be called automatically when your detection pipeline
    // identifies an anomaly that passes thresholds
    const evidence: AnomalyEvidence = {
      anomaly_id: 'auto-anomaly-001',
      type: 'lost_units',
      sku: 'AUTO-SKU-001',
      expected_units: 200,
      received_units: 185,
      loss: 15,
      cost_per_unit: 8.75,
      total_loss: 131.25,
      detected_at: new Date().toISOString(),
      evidence_links: [
        's3://artifacts/receiving_scan_001.pdf',
        's3://artifacts/invoice_001.pdf',
        's3://artifacts/shipping_manifest_001.pdf'
      ],
      seller_info: {
        seller_id: 'seller-auto-001',
        business_name: 'AutoCorp Inc.',
        email: 'claims@autocorp.com'
      }
    };

    // Queue the job for background processing
    const job = await costDocumentationWorker.addJob(evidence, {
      priority: 'normal'
    });

    console.log(`✅ Job queued successfully: ${job.id}`);
    console.log(`📋 Anomaly ID: ${evidence.anomaly_id}`);
    console.log(`💰 Total Loss: $${evidence.total_loss}`);
    
    return job.id;
  } catch (error) {
    console.error('❌ Failed to queue automatic job:', error);
    throw error;
  }
}

// Example 2: Manual Trigger from Dashboard
async function manualTriggerExample() {
  console.log('\n🎯 Example 2: Manual Trigger from Dashboard');
  
  try {
    const service = new CostDocumentationService();
    await service.initialize();

    // This would be called when a user clicks "Generate Documentation"
    // in your dashboard for a specific anomaly
    const evidence: AnomalyEvidence = {
      anomaly_id: 'manual-anomaly-002',
      type: 'overcharges',
      sku: 'MANUAL-SKU-002',
      cost_per_unit: 0,
      total_loss: 45.99,
      detected_at: new Date().toISOString(),
      evidence_links: [
        's3://artifacts/fee_statement_002.pdf',
        's3://artifacts/account_summary_002.pdf'
      ],
      seller_info: {
        seller_id: 'seller-manual-002',
        business_name: 'ManualCorp LLC',
        email: 'support@manualcorp.com'
      }
    };

    // Generate documentation immediately (bypasses queue)
    const result = await service.generateManualDocumentation(evidence);

    console.log(`✅ Manual documentation generated: ${result.id}`);
    console.log(`📄 PDF URL: ${result.pdf_url}`);
    console.log(`📊 File Size: ${result.file_size} bytes`);
    console.log(`⏰ Generated: ${result.generated_at}`);
    
    await service.cleanup();
    return result;
  } catch (error) {
    console.error('❌ Failed to generate manual documentation:', error);
    throw error;
  }
}

// Example 3: Check Job Status
async function checkJobStatusExample(jobId: string) {
  console.log('\n📊 Example 3: Check Job Status');
  
  try {
    const job = await costDocumentationWorker.getJob(jobId);
    
    if (job) {
      const state = await job.getState();
      console.log(`📋 Job ID: ${job.id}`);
      console.log(`📈 Status: ${state}`);
      console.log(`📊 Progress: ${job.progress()}%`);
      console.log(`⏰ Created: ${new Date(job.timestamp).toLocaleString()}`);
      
      if (job.processedOn) {
        console.log(`⚡ Processed: ${new Date(job.processedOn).toLocaleString()}`);
      }
      
      if (job.finishedOn) {
        console.log(`✅ Finished: ${new Date(job.finishedOn).toLocaleString()}`);
      }
    } else {
      console.log('❌ Job not found');
    }
  } catch (error) {
    console.error('❌ Failed to check job status:', error);
  }
}

// Example 4: Queue Management
async function queueManagementExample() {
  console.log('\n⚙️ Example 4: Queue Management');
  
  try {
    // Get queue statistics
    const stats = await costDocumentationWorker.getQueueStats();
    
    console.log('📊 Queue Statistics:');
    console.log(`⏳ Waiting: ${stats.waiting}`);
    console.log(`🔄 Active: ${stats.active}`);
    console.log(`✅ Completed: ${stats.completed}`);
    console.log(`❌ Failed: ${stats.failed}`);
    console.log(`⏰ Delayed: ${stats.delayed}`);
    
    // Get failed jobs
    const failedJobs = await costDocumentationWorker.getJobs('failed');
    
    if (failedJobs.length > 0) {
      console.log(`\n⚠️ Found ${failedJobs.length} failed jobs:`);
      
      for (const job of failedJobs.slice(0, 3)) { // Show first 3
        console.log(`  - Job ${job.id}: ${job.failedReason}`);
      }
      
      // Retry the first failed job
      if (failedJobs.length > 0) {
        await costDocumentationWorker.retryJob(failedJobs[0].id.toString());
        console.log(`🔄 Retried job: ${failedJobs[0].id}`);
      }
    } else {
      console.log('✅ No failed jobs found');
    }
    
  } catch (error) {
    console.error('❌ Failed to get queue statistics:', error);
  }
}

// Example 5: Retrieve Generated Documentation
async function retrieveDocumentationExample() {
  console.log('\n📚 Example 5: Retrieve Generated Documentation');
  
  try {
    const service = new CostDocumentationService();
    await service.initialize();

    // Get documentation by anomaly ID
    const anomalyId = 'auto-anomaly-001';
    const documentation = await service.getDocumentationByAnomalyId(anomalyId);
    
    if (documentation) {
      console.log(`✅ Found documentation for anomaly: ${anomalyId}`);
      console.log(`📄 PDF ID: ${documentation.id}`);
      console.log(`🔗 URL: ${documentation.pdf_url}`);
      console.log(`📊 Size: ${documentation.file_size} bytes`);
      console.log(`⏰ Generated: ${documentation.generated_at}`);
      console.log(`🏷️ Template: ${documentation.template_used}`);
    } else {
      console.log(`❌ No documentation found for anomaly: ${anomalyId}`);
    }

    // Get all documentation for a seller
    const sellerId = 'seller-auto-001';
    const sellerDocs = await service.getDocumentationBySellerId(sellerId);
    
    console.log(`\n📚 Found ${sellerDocs.length} documents for seller: ${sellerId}`);
    
    sellerDocs.forEach((doc, index) => {
      console.log(`  ${index + 1}. Anomaly: ${doc.anomaly_id}`);
      console.log(`     📄 PDF: ${doc.pdf_url}`);
      console.log(`     ⏰ Date: ${doc.generated_at}`);
    });
    
    await service.cleanup();
  } catch (error) {
    console.error('❌ Failed to retrieve documentation:', error);
  }
}

// Example 6: Error Handling and Retry Logic
async function errorHandlingExample() {
  console.log('\n🛡️ Example 6: Error Handling and Retry Logic');
  
  try {
    // Simulate a job with invalid data
    const invalidEvidence = {
      anomaly_id: 'invalid-anomaly',
      // Missing required fields
    } as any;

    try {
      await costDocumentationWorker.addJob(invalidEvidence);
      console.log('❌ Should have failed validation');
    } catch (error) {
      console.log('✅ Properly caught validation error:', error.message);
    }

    // Simulate service errors
    const service = new CostDocumentationService();
    
    try {
      // This would fail in a real environment without proper setup
      await service.initialize();
    } catch (error) {
      console.log('✅ Properly caught initialization error:', error.message);
    }
    
  } catch (error) {
    console.error('❌ Unexpected error in error handling example:', error);
  }
}

// Main execution function
async function runExamples() {
  console.log('🎯 Cost Documentation Module - Integration Examples\n');
  
  try {
    // Run examples sequentially
    const jobId = await automaticTriggerExample();
    
    await manualTriggerExample();
    
    // Wait a bit for the automatic job to process
    console.log('\n⏳ Waiting 2 seconds for job processing...');
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    await checkJobStatusExample(jobId);
    await queueManagementExample();
    await retrieveDocumentationExample();
    await errorHandlingExample();
    
    console.log('\n🎉 All examples completed successfully!');
    
  } catch (error) {
    console.error('\n💥 Examples failed:', error);
  } finally {
    // Cleanup
    console.log('\n🧹 Cleaning up...');
    await costDocumentationWorker.shutdown();
    process.exit(0);
  }
}

// Run examples if this file is executed directly
if (require.main === module) {
  runExamples().catch(console.error);
}

export {
  automaticTriggerExample,
  manualTriggerExample,
  checkJobStatusExample,
  queueManagementExample,
  retrieveDocumentationExample,
  errorHandlingExample
};








