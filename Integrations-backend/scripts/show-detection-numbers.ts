/**
 * Script to show actual detection results with numbers from database
 */

import 'dotenv/config';
import { supabaseAdmin } from '../src/database/supabaseClient';

async function showDetectionNumbers() {
  console.log('📊 Querying Detection Results from Database...\n');

  try {
    // Get recent detection results
    const { data: results, error } = await supabaseAdmin
      .from('detection_results')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) {
      console.error('❌ Error querying database:', error);
      return;
    }

    if (!results || results.length === 0) {
      console.log('⚠️  No detection results found in database');
      return;
    }

    console.log(`✅ Found ${results.length} detection results\n`);

    // Calculate totals
    const totalValue = results.reduce((sum, r) => sum + (r.estimated_value || 0), 0);
    const avgConfidence = results.reduce((sum, r) => sum + (r.confidence_score || 0), 0) / results.length;
    const highConfidence = results.filter(r => (r.confidence_score || 0) >= 0.8).length;
    const mediumConfidence = results.filter(r => (r.confidence_score || 0) >= 0.5 && (r.confidence_score || 0) < 0.8).length;
    const lowConfidence = results.filter(r => (r.confidence_score || 0) < 0.5).length;

    // Group by anomaly type
    const byType: Record<string, number> = {};
    const bySeverity: Record<string, number> = {};
    results.forEach(r => {
      byType[r.anomaly_type || 'unknown'] = (byType[r.anomaly_type || 'unknown'] || 0) + 1;
      bySeverity[r.severity || 'unknown'] = (bySeverity[r.severity || 'unknown'] || 0) + 1;
    });

    console.log('📈 SUMMARY STATISTICS');
    console.log('====================');
    console.log(`Total Detections: ${results.length}`);
    console.log(`Total Estimated Value: $${totalValue.toFixed(2)}`);
    console.log(`Average Confidence: ${(avgConfidence * 100).toFixed(1)}%`);
    console.log(`\nConfidence Breakdown:`);
    console.log(`  High (≥80%): ${highConfidence}`);
    console.log(`  Medium (50-79%): ${mediumConfidence}`);
    console.log(`  Low (<50%): ${lowConfidence}`);

    console.log(`\nBy Anomaly Type:`);
    Object.entries(byType).forEach(([type, count]) => {
      console.log(`  ${type}: ${count}`);
    });

    console.log(`\nBy Severity:`);
    Object.entries(bySeverity).forEach(([severity, count]) => {
      console.log(`  ${severity}: ${count}`);
    });

    console.log('\n\n📋 RECENT DETECTIONS (Top 10)');
    console.log('================================');
    results.slice(0, 10).forEach((r, i) => {
      console.log(`\n${i + 1}. ${r.anomaly_type || 'Unknown'}`);
      console.log(`   Value: $${(r.estimated_value || 0).toFixed(2)} ${r.currency || 'USD'}`);
      console.log(`   Confidence: ${((r.confidence_score || 0) * 100).toFixed(1)}%`);
      console.log(`   Severity: ${r.severity || 'unknown'}`);
      console.log(`   Status: ${r.status || 'unknown'}`);
      console.log(`   Days Remaining: ${r.days_remaining !== null ? r.days_remaining : 'N/A'}`);
      console.log(`   Created: ${new Date(r.created_at).toLocaleString()}`);
    });

    // Get sync stats
    const { data: syncStats } = await supabaseAdmin
      .from('detection_results')
      .select('sync_id')
      .not('sync_id', 'is', null);

    const uniqueSyncs = new Set(syncStats?.map(s => s.sync_id) || []);
    console.log(`\n\n🔄 SYNC STATISTICS`);
    console.log('==================');
    console.log(`Total Unique Syncs: ${uniqueSyncs.size}`);
    console.log(`Average Detections per Sync: ${(results.length / uniqueSyncs.size).toFixed(1)}`);

  } catch (error: any) {
    console.error('❌ Error:', error.message);
  }
}

showDetectionNumbers()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });

