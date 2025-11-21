import 'dotenv/config';
import { Client } from 'pg';

async function checkDashboardNumbers() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  
  try {
    await client.connect();
    console.log('✅ Connected to database\n');
    
    // Check detection_results (Agent 3)
    const detections = await client.query(`
      SELECT 
        COUNT(*) as total_claims,
        COUNT(*) FILTER (WHERE confidence_score >= 0.85) as high_confidence,
        COUNT(*) FILTER (WHERE confidence_score >= 0.7 AND confidence_score < 0.85) as medium_confidence,
        COUNT(*) FILTER (WHERE confidence_score < 0.7) as low_confidence,
        COUNT(*) FILTER (WHERE status = 'pending') as pending,
        COUNT(*) FILTER (WHERE status = 'reviewed') as reviewed,
        COUNT(*) FILTER (WHERE status = 'disputed') as disputed,
        SUM(estimated_value) as total_estimated_value
      FROM detection_results
    `);
    
    console.log('📊 Detection Results (Agent 3):');
    console.log(`   Total Claims: ${detections.rows[0].total_claims}`);
    console.log(`   High Confidence (≥85%): ${detections.rows[0].high_confidence}`);
    console.log(`   Medium Confidence (70-84%): ${detections.rows[0].medium_confidence}`);
    console.log(`   Low Confidence (<70%): ${detections.rows[0].low_confidence}`);
    console.log(`   Total Estimated Value: $${detections.rows[0].total_estimated_value || 0}`);
    console.log(`   Status - Pending: ${detections.rows[0].pending}, Reviewed: ${detections.rows[0].reviewed}, Disputed: ${detections.rows[0].disputed}`);
    
    // Check recoveries (Agent 8)
    const recoveries = await client.query(`
      SELECT 
        COUNT(*) as total_recoveries,
        COUNT(*) FILTER (WHERE reconciliation_status = 'reconciled') as reconciled,
        SUM(actual_amount) as total_recovered,
        SUM(expected_amount) as total_expected
      FROM recoveries
    `);
    
    console.log('\n💰 Recoveries (Agent 8):');
    console.log(`   Total Recoveries: ${recoveries.rows[0].total_recoveries}`);
    console.log(`   Reconciled: ${recoveries.rows[0].reconciled}`);
    console.log(`   Total Recovered: $${recoveries.rows[0].total_recovered || 0}`);
    console.log(`   Total Expected: $${recoveries.rows[0].total_expected || 0}`);
    
    // Check dispute_cases (Agent 7)
    const disputes = await client.query(`
      SELECT 
        COUNT(*) as total_cases,
        COUNT(*) FILTER (WHERE status = 'approved') as approved,
        COUNT(*) FILTER (WHERE status = 'pending') as pending,
        COUNT(*) FILTER (WHERE status = 'rejected') as rejected,
        SUM(claim_amount) FILTER (WHERE status = 'approved') as approved_amount
      FROM dispute_cases
    `);
    
    console.log('\n📝 Dispute Cases (Agent 7):');
    console.log(`   Total Cases: ${disputes.rows[0].total_cases}`);
    console.log(`   Approved: ${disputes.rows[0].approved}`);
    console.log(`   Pending: ${disputes.rows[0].pending}`);
    console.log(`   Rejected: ${disputes.rows[0].rejected}`);
    console.log(`   Approved Amount: $${disputes.rows[0].approved_amount || 0}`);
    
    // Check sync_progress (Agent 2)
    const syncs = await client.query(`
      SELECT 
        COUNT(*) as total_syncs,
        COUNT(*) FILTER (WHERE status = 'completed') as completed,
        COUNT(*) FILTER (WHERE status = 'running') as running,
        COUNT(*) FILTER (WHERE status = 'failed') as failed
      FROM sync_progress
    `);
    
    console.log('\n🔄 Sync Progress (Agent 2):');
    console.log(`   Total Syncs: ${syncs.rows[0].total_syncs}`);
    console.log(`   Completed: ${syncs.rows[0].completed}`);
    console.log(`   Running: ${syncs.rows[0].running}`);
    console.log(`   Failed: ${syncs.rows[0].failed}`);
    
    // Check if data is from mock or real
    const mockCheck = await client.query(`
      SELECT 
        COUNT(*) FILTER (WHERE is_sandbox = true OR metadata->>'is_mock' = 'true') as mock_count,
        COUNT(*) FILTER (WHERE is_sandbox = false AND (metadata->>'is_mock' IS NULL OR metadata->>'is_mock' = 'false')) as real_count
      FROM detection_queue
    `);
    
    console.log('\n🔍 Data Source Check:');
    console.log(`   Mock/Sandbox: ${mockCheck.rows[0].mock_count || 0}`);
    console.log(`   Real Data: ${mockCheck.rows[0].real_count || 0}`);
    
    // Sample some detection results
    const samples = await client.query(`
      SELECT 
        id, 
        anomaly_type, 
        confidence_score, 
        estimated_value, 
        status,
        created_at,
        seller_id
      FROM detection_results
      ORDER BY created_at DESC
      LIMIT 5
    `);
    
    console.log('\n📋 Sample Detection Results:');
    samples.rows.forEach((row, i) => {
      console.log(`   ${i + 1}. ${row.anomaly_type} - ${(row.confidence_score * 100).toFixed(0)}% - $${row.estimated_value || 0} - ${row.status}`);
      console.log(`      ID: ${row.id.substring(0, 8)}... Created: ${row.created_at}`);
    });
    
  } catch (error: any) {
    console.error('❌ Error:', error.message);
  } finally {
    await client.end();
  }
}

checkDashboardNumbers();

