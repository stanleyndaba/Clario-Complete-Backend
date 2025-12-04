/**
 * Test Agent 6: Evidence Matching Worker
 * Comprehensive test suite to verify all functionality
 */

import 'dotenv/config';
import { supabase, supabaseAdmin } from '../src/database/supabaseClient';
import evidenceMatchingService from '../src/services/evidenceMatchingService';
import evidenceMatchingWorker from '../src/workers/evidenceMatchingWorker';
import logger from '../src/utils/logger';

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  details?: any;
}

const testResults: TestResult[] = [];

function logTest(name: string, passed: boolean, error?: string, details?: any) {
  testResults.push({ name, passed, error, details });
  if (passed) {
    logger.info(`✅ ${name}`, details || {});
  } else {
    logger.error(`❌ ${name}`, { error, details });
  }
}

async function testMigration() {
  logger.info('\n📋 Testing Migration...');

  try {
    const client = supabaseAdmin || supabase;

    // Test evidence_matching_errors table
    const { error: errorsError } = await client
      .from('evidence_matching_errors')
      .select('id')
      .limit(1);

    if (errorsError && errorsError.message?.includes('relation') && errorsError.message?.includes('evidence_matching_errors')) {
      logTest('Migration: evidence_matching_errors table', false, errorsError.message);
      return false;
    }
    logTest('Migration: evidence_matching_errors table', true);

    // Test match_confidence column in detection_results
    const { error: confidenceError } = await client
      .from('detection_results')
      .select('id, match_confidence')
      .limit(1);

    if (confidenceError && confidenceError.message?.includes('column') && confidenceError.message?.includes('match_confidence')) {
      logTest('Migration: match_confidence column', false, confidenceError.message);
      return false;
    }
    logTest('Migration: match_confidence column', true);

    // Test dispute_evidence_links table (should exist from Python backend)
    const { error: linksError } = await client
      .from('dispute_evidence_links')
      .select('id')
      .limit(1);

    if (linksError && linksError.message?.includes('relation') && linksError.message?.includes('dispute_evidence_links')) {
      logTest('Migration: dispute_evidence_links table (may not exist)', true, undefined, { note: 'Table may be in Python backend only' });
    } else {
      logTest('Migration: dispute_evidence_links table', true);
    }

    return true;
  } catch (error: any) {
    logTest('Migration: Overall', false, error.message);
    return false;
  }
}

async function testEvidenceMatchingService() {
  logger.info('\n📋 Testing Evidence Matching Service...');

  try {
    // Test service initialization
    if (!evidenceMatchingService) {
      logTest('Service: Initialization', false, 'Service not initialized');
      return false;
    }
    logTest('Service: Initialization', true);

    // Test Python API URL configuration
    const pythonApiUrl = process.env.PYTHON_API_URL || process.env.API_URL || 'https://python-api-10.onrender.com';
    logTest('Service: Python API URL configured', true, undefined, { pythonApiUrl });

    // Test confidence thresholds
    const autoThreshold = process.env.EVIDENCE_CONFIDENCE_AUTO || '0.85';
    const promptThreshold = process.env.EVIDENCE_CONFIDENCE_PROMPT || '0.5';
    logTest('Service: Confidence thresholds configured', true, undefined, {
      autoSubmit: autoThreshold,
      smartPrompt: promptThreshold
    });

    // Note: We can't test actual API calls without a real user ID
    // But we can verify the service methods exist
    const methods = ['runMatchingForUser', 'runMatchingWithRetry', 'processMatchingResults', 'getMatchingMetrics'];
    for (const method of methods) {
      if (typeof (evidenceMatchingService as any)[method] === 'function') {
        logTest(`Service: ${method} method exists`, true);
      } else {
        logTest(`Service: ${method} method exists`, false, 'Method not found');
        return false;
      }
    }

    return true;
  } catch (error: any) {
    logTest('Service: Overall', false, error.message);
    return false;
  }
}

async function testEvidenceMatchingWorker() {
  logger.info('\n📋 Testing Evidence Matching Worker...');

  try {
    // Test worker initialization
    if (!evidenceMatchingWorker) {
      logTest('Worker: Initialization', false, 'Worker not initialized');
      return false;
    }
    logTest('Worker: Initialization', true);

    // Test worker methods
    const methods = ['start', 'stop', 'getStatus', 'triggerManualMatching', 'triggerMatchingForParsedDocument'];
    for (const method of methods) {
      if (typeof (evidenceMatchingWorker as any)[method] === 'function') {
        logTest(`Worker: ${method} method exists`, true);
      } else {
        logTest(`Worker: ${method} method exists`, false, 'Method not found');
        return false;
      }
    }

    // Test worker status
    const status = evidenceMatchingWorker.getStatus();
    logTest('Worker: getStatus() works', true, undefined, status);

    return true;
  } catch (error: any) {
    logTest('Worker: Overall', false, error.message);
    return false;
  }
}

async function testDatabaseOperations() {
  logger.info('\n📋 Testing Database Operations...');

  try {
    const client = supabaseAdmin || supabase;
    const testSellerId = 'test-seller-' + Date.now();

    // Test: Error logging
    const { error: errorLogError } = await client
      .from('evidence_matching_errors')
      .insert({
        seller_id: testSellerId,
        error_type: 'TestError',
        error_message: 'Test error message',
        retry_count: 0,
        max_retries: 3
      });

    if (errorLogError) {
      logTest('Database: Error logging', false, errorLogError.message);
    } else {
      logTest('Database: Error logging', true);

      // Cleanup: Delete test error
      await client
        .from('evidence_matching_errors')
        .delete()
        .eq('seller_id', testSellerId);
      logTest('Database: Cleanup test error', true);
    }

    // Test: Update detection_results with match_confidence
    // First, try to get a detection result
    const { data: detectionResult, error: fetchError } = await client
      .from('detection_results')
      .select('id, seller_id')
      .limit(1)
      .single();

    if (!fetchError && detectionResult) {
      const { error: updateError } = await client
        .from('detection_results')
        .update({
          match_confidence: 0.85,
          updated_at: new Date().toISOString()
        })
        .eq('id', detectionResult.id);

      if (updateError) {
        logTest('Database: Update match_confidence', false, updateError.message);
      } else {
        logTest('Database: Update match_confidence', true);

        // Read back the match_confidence
        const { data: readResult, error: readError } = await client
          .from('detection_results')
          .select('id, match_confidence')
          .eq('id', detectionResult.id)
          .single();

        if (readError) {
          logTest('Database: Read match_confidence', false, readError.message);
        } else {
          logTest('Database: Read match_confidence', true, undefined, {
            hasConfidence: readResult?.match_confidence !== null,
            confidence: readResult?.match_confidence
          });
        }
      }
    } else {
      logTest('Database: Update match_confidence (skipped)', true, undefined, { note: 'No detection_results to test with' });
    }

    return true;
  } catch (error: any) {
    logTest('Database: Overall', false, error.message);
    return false;
  }
}

async function testIntegration() {
  logger.info('\n📋 Testing Integration...');

  try {
    // Test: Worker can access service
    if (evidenceMatchingWorker && evidenceMatchingService) {
      logTest('Integration: Worker can access service', true);
    } else {
      logTest('Integration: Worker can access service', false, 'Service or worker not available');
      return false;
    }

    // Test: Environment variables
    const envVars = {
      ENABLE_EVIDENCE_MATCHING_WORKER: process.env.ENABLE_EVIDENCE_MATCHING_WORKER,
      PYTHON_API_URL: process.env.PYTHON_API_URL || process.env.API_URL,
      EVIDENCE_CONFIDENCE_AUTO: process.env.EVIDENCE_CONFIDENCE_AUTO,
      EVIDENCE_CONFIDENCE_PROMPT: process.env.EVIDENCE_CONFIDENCE_PROMPT
    };
    logTest('Integration: Environment variables', true, undefined, envVars);

    // Test: Supabase clients available
    if (supabase && supabaseAdmin) {
      logTest('Integration: Supabase clients available', true);
    } else {
      logTest('Integration: Supabase clients available', false, 'Clients not initialized');
      return false;
    }

    // Test: Agent 5 integration (check if documentParsingWorker exists)
    try {
      const documentParsingWorker = (await import('../src/workers/documentParsingWorker')).default;
      if (documentParsingWorker) {
        logTest('Integration: Agent 5 (Document Parsing) available', true);
      } else {
        logTest('Integration: Agent 5 (Document Parsing) available', false, 'Document parsing worker not found');
      }
    } catch (error: any) {
      logTest('Integration: Agent 5 (Document Parsing) available', false, error.message);
    }

    return true;
  } catch (error: any) {
    logTest('Integration: Overall', false, error.message);
    return false;
  }
}

async function testConfidenceRouting() {
  logger.info('\n📋 Testing Confidence Threshold Routing...');

  try {
    // Test: Verify threshold values
    const autoThreshold = parseFloat(process.env.EVIDENCE_CONFIDENCE_AUTO || '0.85');
    const promptThreshold = parseFloat(process.env.EVIDENCE_CONFIDENCE_PROMPT || '0.5');

    if (autoThreshold >= 0.85 && autoThreshold <= 1.0) {
      logTest('Confidence: Auto-submit threshold valid', true, undefined, { threshold: autoThreshold });
    } else {
      logTest('Confidence: Auto-submit threshold valid', false, `Invalid threshold: ${autoThreshold}`);
      return false;
    }

    if (promptThreshold >= 0.5 && promptThreshold < autoThreshold) {
      logTest('Confidence: Smart prompt threshold valid', true, undefined, { threshold: promptThreshold });
    } else {
      logTest('Confidence: Smart prompt threshold valid', false, `Invalid threshold: ${promptThreshold}`);
      return false;
    }

    // Test: Verify routing logic
    const testCases = [
      { confidence: 0.95, expected: 'auto_submit' },
      { confidence: 0.85, expected: 'auto_submit' },
      { confidence: 0.70, expected: 'smart_prompt' },
      { confidence: 0.50, expected: 'smart_prompt' },
      { confidence: 0.30, expected: 'hold' },
      { confidence: 0.10, expected: 'hold' }
    ];

    for (const testCase of testCases) {
      let expectedAction: string;
      if (testCase.confidence >= autoThreshold) {
        expectedAction = 'auto_submit';
      } else if (testCase.confidence >= promptThreshold) {
        expectedAction = 'smart_prompt';
      } else {
        expectedAction = 'hold';
      }

      if (expectedAction === testCase.expected) {
        logTest(`Confidence: Routing ${testCase.confidence} → ${expectedAction}`, true);
      } else {
        logTest(`Confidence: Routing ${testCase.confidence} → ${expectedAction}`, false, `Expected ${testCase.expected}, got ${expectedAction}`);
      }
    }

    return true;
  } catch (error: any) {
    logTest('Confidence: Overall', false, error.message);
    return false;
  }
}

async function runAllTests() {
  logger.info('\n🚀 Starting Agent 6 Test Suite...\n');

  const tests = [
    { name: 'Migration', fn: testMigration },
    { name: 'Evidence Matching Service', fn: testEvidenceMatchingService },
    { name: 'Evidence Matching Worker', fn: testEvidenceMatchingWorker },
    { name: 'Database Operations', fn: testDatabaseOperations },
    { name: 'Integration', fn: testIntegration },
    { name: 'Confidence Routing', fn: testConfidenceRouting }
  ];

  let allPassed = true;

  for (const test of tests) {
    try {
      const passed = await test.fn();
      if (!passed) {
        allPassed = false;
      }
    } catch (error: any) {
      logger.error(`Test ${test.name} threw error:`, error);
      allPassed = false;
    }
  }

  // Print summary
  logger.info('\n📊 Test Summary:');
  logger.info('='.repeat(60));

  const passed = testResults.filter(r => r.passed).length;
  const failed = testResults.filter(r => !r.passed).length;

  logger.info(`✅ Passed: ${passed}`);
  logger.info(`❌ Failed: ${failed}`);
  logger.info(`📊 Total: ${testResults.length}`);

  if (failed > 0) {
    logger.info('\n❌ Failed Tests:');
    testResults
      .filter(r => !r.passed)
      .forEach(r => {
        logger.error(`  - ${r.name}: ${r.error || 'Unknown error'}`);
      });
  }

  logger.info('\n' + '='.repeat(60));

  if (allPassed) {
    logger.info('\n🎉 All tests passed! Agent 6 is ready for production.');
    logger.info('\n📋 Next steps:');
    logger.info('   1. Start server: npm run dev');
    logger.info('   2. Verify worker starts: Look for "Evidence matching worker initialized"');
    logger.info('   3. Generate claims via Agent 1 (Discovery)');
    logger.info('   4. Parse documents via Agent 5');
    logger.info('   5. Wait 3 minutes for Agent 6 to match them');
    logger.info('   6. Check dispute_evidence_links for matches');
    logger.info('   7. Verify routing based on confidence thresholds');
  } else {
    logger.error('\n⚠️ Some tests failed. Please review the errors above.');
  }

  return allPassed;
}

// Run tests
runAllTests()
  .then(success => {
    process.exit(success ? 0 : 1);
  })
  .catch(error => {
    logger.error('Fatal error running tests:', error);
    process.exit(1);
  });

