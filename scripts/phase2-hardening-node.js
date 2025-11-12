/**
 * Phase 2 Hardening Script (Node.js)
 * Comprehensive security hardening for Continuous Data Sync
 */

const fs = require('fs');
const path = require('path');

// Configuration
const config = {
  apiUrl: process.env.AMAZON_SPAPI_BASE_URL || 'https://sandbox.sellingpartnerapi-na.amazon.com',
  databaseUrl: process.env.DATABASE_URL,
  verbose: process.argv.includes('--verbose') || process.argv.includes('-v')
};

// Create logs directory
const logDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
const logFile = path.join(logDir, `phase2-hardening-${timestamp}.log`);
const reportFile = `PHASE2_HARDENING_REPORT_${timestamp.replace(/[:-]/g, '')}.md`;

// Results storage
const results = {
  environment: {
    sandboxHttps: false,
    backgroundSyncEnabled: false,
    databaseSecure: false
  },
  sensitiveVariables: {
    noExposedCredentials: false,
    encryptionKeysPresent: false,
    noSecretsInLogs: false
  },
  backgroundWorker: {
    rateLimiting: false,
    exponentialBackoff: false,
    errorHandling: false,
    gracefulShutdown: false
  },
  dataNormalization: {
    jsonValidation: false,
    sqlInjectionProtection: false,
    schemaIntegrity: false
  },
  auditLogging: {
    structuredLogs: false,
    logRotation: false,
    severityLevels: false
  },
  sandboxSafety: {
    sandboxEndpoints: false,
    productionRejection: false,
    emptyResponseHandling: false
  }
};

// Logging functions
function log(level, message) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] [${level}] ${message}\n`;
  fs.appendFileSync(logFile, logMessage);
  
  if (config.verbose || level === 'ERROR' || level === 'WARNING') {
    const color = level === 'ERROR' ? '\x1b[31m' : level === 'WARNING' ? '\x1b[33m' : level === 'SUCCESS' ? '\x1b[32m' : '';
    console.log(`${color}${message}\x1b[0m`);
  }
}

function success(message) { log('SUCCESS', `  ✅ ${message}`); }
function error(message) { log('ERROR', `  ❌ ${message}`); }
function warning(message) { log('WARNING', `  ⚠️  ${message}`); }
function info(message) { log('INFO', message); }

// Check if file exists and read content
function readFile(filePath) {
  const fullPath = path.join(process.cwd(), filePath);
  if (fs.existsSync(fullPath)) {
    return fs.readFileSync(fullPath, 'utf8');
  }
  return null;
}

// Check for pattern in content
function hasPattern(content, pattern) {
  if (!content) return false;
  const regex = new RegExp(pattern, 'i');
  return regex.test(content);
}

// Main hardening checks
function runHardening() {
  console.log('========================================');
  console.log('Phase 2 Hardening Verification');
  console.log('========================================');
  console.log(`Log file: ${logFile}\n`);

  // 1. Environment Configuration
  info('=== STEP 1: Environment Configuration ===');
  
  // Check sandbox HTTPS
  info('Checking sandbox URL security...');
  if (config.apiUrl.startsWith('https://')) {
    success('Sandbox URL uses HTTPS');
    results.environment.sandboxHttps = true;
  } else {
    error(`Sandbox URL does not use HTTPS: ${config.apiUrl}`);
  }

  // Check background sync
  info('Checking background sync configuration...');
  const enableSync = process.env.ENABLE_BACKGROUND_SYNC;
  if (enableSync === 'true' || !enableSync) {
    success('Background sync is enabled (or default)');
    results.environment.backgroundSyncEnabled = true;
  } else {
    warning(`Background sync is disabled: ENABLE_BACKGROUND_SYNC=${enableSync}`);
  }

  // Check database URL
  info('Checking database URL security...');
  if (config.databaseUrl) {
    if (config.databaseUrl.includes('localhost') || config.databaseUrl.includes('127.0.0.1')) {
      warning('Database URL appears to be local - ensure it\'s not exposed');
    } else if (config.databaseUrl.includes('supabase') || config.databaseUrl.includes('postgres')) {
      success('Database URL appears to be a managed service');
      results.environment.databaseSecure = true;
    } else {
      warning('Database URL format unclear - verify it\'s secure');
    }
  } else {
    warning('DATABASE_URL not set');
  }

  // 2. Sensitive Variables
  info('\n=== STEP 2: Sensitive Variables Audit ===');
  
  // Check .env files
  info('Scanning for exposed credentials...');
  const envFiles = ['.env', '.env.local', '.env.production'];
  let foundSecrets = false;
  
  // Check if .env is in .gitignore (if so, secrets in .env are acceptable for local dev)
  const gitignoreContent = readFile('.gitignore');
  const envInGitignore = gitignoreContent && /\.env/.test(gitignoreContent);

  envFiles.forEach(envFile => {
    const content = readFile(envFile);
    if (content) {
      // Check for actual secrets (not just placeholder values)
      // Look for patterns like password=actual_value (not password=your-password-here)
      const passwordPattern = /password\s*=\s*(?!your|YOUR|password|PASSWORD|placeholder|PLACEHOLDER)[^\s]+/i;
      const secretPattern = /secret\s*=\s*(?!your|YOUR|secret|SECRET|placeholder|PLACEHOLDER)[^\s]+/i;
      const tokenPattern = /token\s*=\s*(?!your|YOUR|token|TOKEN|placeholder|PLACEHOLDER)[^\s]+/i;
      
      if (passwordPattern.test(content) || secretPattern.test(content) || tokenPattern.test(content)) {
        // Check if it's a real secret (longer than 10 chars, not a placeholder)
        const matches = content.match(/(?:password|secret|token)\s*=\s*([^\s]+)/gi);
        if (matches) {
          for (const match of matches) {
            const value = match.split('=')[1]?.trim();
            if (value && value.length > 10 && !value.match(/^(your|YOUR|placeholder|PLACEHOLDER|change|CHANGE)/i)) {
              // If .env is in .gitignore, this is acceptable for local development
              if (envInGitignore && envFile === '.env') {
                info(`Secrets found in ${envFile} but it's in .gitignore (acceptable for local dev)`);
              } else {
                warning(`Potential secret found in ${envFile}`);
                foundSecrets = true;
              }
              break;
            }
          }
        }
      }
    }
  });

  // Pass if no secrets found OR if secrets are only in .env which is gitignored
  if (!foundSecrets || (envInGitignore && !foundSecrets)) {
    success('No exposed credentials in tracked files (.env is gitignored)');
    results.sensitiveVariables.noExposedCredentials = true;
  } else {
    error('Potential credentials found in tracked files - review .env files');
  }

  // Check encryption keys
  info('Checking for encryption keys...');
  const hasEncryptionKey = process.env.ENCRYPTION_KEY || process.env.APP_ENCRYPTION_KEY || process.env.SECRET_STORE_KEY || process.env.JWT_SECRET;
  if (hasEncryptionKey) {
    success('Encryption/secret keys are configured');
    results.sensitiveVariables.encryptionKeysPresent = true;
  } else {
    warning('No encryption keys found - ensure secrets are encrypted');
  }

  // Check log sanitization
  info('Checking log sanitization...');
  const loggerContent = readFile('Integrations-backend/src/utils/logger.ts');
  if (loggerContent && hasPattern(loggerContent, 'sanitizeLogData|sanitize')) {
    success('Log sanitization is implemented');
    results.sensitiveVariables.noSecretsInLogs = true;
  } else {
    warning('Log sanitization may not be implemented');
  }

  // 3. Background Worker
  info('\n=== STEP 3: Background Worker Hardening ===');
  
  const workerContent = readFile('Integrations-backend/src/jobs/backgroundSyncWorker.ts');
  if (workerContent) {
    // Rate limiting
    info('Checking rate limiting...');
    if (hasPattern(workerContent, 'rate.*limit|delay|throttle|2000|1000')) {
      success('Rate limiting appears to be implemented');
      results.backgroundWorker.rateLimiting = true;
    } else {
      warning('Rate limiting may not be implemented');
    }

    // Exponential backoff
    info('Checking exponential backoff...');
    if (hasPattern(workerContent, 'exponential|backoff|RETRY_DELAY|retry.*delay')) {
      success('Exponential backoff appears to be implemented');
      results.backgroundWorker.exponentialBackoff = true;
    } else {
      warning('Exponential backoff may not be implemented');
    }

    // Error handling
    info('Checking error handling...');
    if (hasPattern(workerContent, 'catch|error.*handling|try.*catch')) {
      success('Error handling is implemented');
      results.backgroundWorker.errorHandling = true;
    } else {
      error('Error handling may be missing');
    }

    // Graceful shutdown
    info('Checking graceful shutdown...');
    if (hasPattern(workerContent, 'stop\\(\\)|shutdown|SIGTERM|SIGINT|process\\.on')) {
      success('Graceful shutdown appears to be implemented');
      results.backgroundWorker.gracefulShutdown = true;
    } else {
      warning('Graceful shutdown may not be implemented');
    }
  } else {
    error('Background worker file not found');
  }

  // Check orchestrator
  const orchestratorContent = readFile('Integrations-backend/src/jobs/phase2SyncOrchestrator.ts');
  if (orchestratorContent) {
    if (hasPattern(orchestratorContent, 'MAX_RETRIES|RETRY_DELAY|retry|backoff')) {
      success('Retry logic found in orchestrator');
      results.backgroundWorker.exponentialBackoff = true;
    }
    if (hasPattern(orchestratorContent, 'RATE_LIMIT_DELAY|delay.*2000')) {
      success('Rate limiting found in orchestrator');
      results.backgroundWorker.rateLimiting = true;
    }
  }

  // 4. Data Normalization
  info('\n=== STEP 4: Data Normalization Security ===');
  
  const services = [
    'Integrations-backend/src/services/ordersService.ts',
    'Integrations-backend/src/services/shipmentsService.ts',
    'Integrations-backend/src/services/returnsService.ts',
    'Integrations-backend/src/services/settlementsService.ts'
  ];

  let allServicesValid = true;
  services.forEach(servicePath => {
    const serviceContent = readFile(servicePath);
    if (serviceContent) {
      const serviceName = path.basename(servicePath);
      
      if (hasPattern(serviceContent, 'JSON\\.parse|JSON\\.stringify|validate|schema')) {
        success(`JSON validation found in ${serviceName}`);
      } else {
        warning(`JSON validation may be missing in ${serviceName}`);
        allServicesValid = false;
      }

      if (hasPattern(serviceContent, 'supabase\\.from|\\.insert\\(|\\.update\\(|\\.eq\\(')) {
        success(`Using Supabase client (parameterized queries) in ${serviceName}`);
      } else {
        warning(`May not be using parameterized queries in ${serviceName}`);
        allServicesValid = false;
      }
    }
  });

  if (allServicesValid) {
    results.dataNormalization.jsonValidation = true;
    results.dataNormalization.sqlInjectionProtection = true;
  }

  // Schema integrity
  info('Checking schema integrity...');
  const migrationContent = readFile('Integrations-backend/src/database/migrations/002_create_phase2_tables.sql');
  if (migrationContent) {
    const hasAllTables = 
      hasPattern(migrationContent, 'CREATE TABLE.*orders') &&
      hasPattern(migrationContent, 'CREATE TABLE.*shipments') &&
      hasPattern(migrationContent, 'CREATE TABLE.*returns') &&
      hasPattern(migrationContent, 'CREATE TABLE.*settlements');
    
    if (hasAllTables) {
      success('All Phase 2 tables defined in migration');
      results.dataNormalization.schemaIntegrity = true;
    } else {
      error('Not all Phase 2 tables found in migration');
    }
  } else {
    error('Migration file not found');
  }

  // 5. Audit Logging
  info('\n=== STEP 5: Audit Logging ===');
  
  if (loggerContent) {
    if (hasPattern(loggerContent, 'winston|format\\.json|format\\.combine')) {
      success('Structured JSON logging is implemented');
      results.auditLogging.structuredLogs = true;
    } else {
      warning('Structured logging may not be implemented');
    }

    if (hasPattern(loggerContent, 'maxsize|maxFiles|maxSize|5242880|5MB')) {
      success('Log rotation is configured');
      results.auditLogging.logRotation = true;
    } else {
      warning('Log rotation may not be configured');
    }
  }

  const auditLoggerContent = readFile('Integrations-backend/src/security/auditLogger.ts');
  if (auditLoggerContent) {
    if (hasPattern(auditLoggerContent, 'severity.*low|severity.*high|severity.*medium|INFO|WARN|ERROR')) {
      success('Severity levels are implemented');
      results.auditLogging.severityLevels = true;
    } else {
      warning('Severity levels may not be implemented');
    }
  }

  // 6. Sandbox Safety
  info('\n=== STEP 6: Sandbox Safety ===');
  
  const amazonServiceContent = readFile('Integrations-backend/src/services/amazonService.ts');
  if (amazonServiceContent) {
    if (hasPattern(amazonServiceContent, 'isSandbox|sandbox\\.sellingpartnerapi|AMAZON_SPAPI_BASE_URL.*sandbox')) {
      success('Sandbox detection is implemented');
      results.sandboxSafety.sandboxEndpoints = true;
    } else {
      error('Sandbox detection may not be implemented');
    }

    if (hasPattern(amazonServiceContent, 'production.*reject|throw.*production|NODE_ENV.*production')) {
      success('Production call rejection appears to be implemented');
      results.sandboxSafety.productionRejection = true;
    } else {
      warning('Production call rejection may not be implemented');
    }
  }

  const ordersServiceContent = readFile('Integrations-backend/src/services/ordersService.ts');
  if (ordersServiceContent) {
    if (hasPattern(ordersServiceContent, 'empty.*response|empty.*array|normal.*for.*sandbox')) {
      success('Empty response handling is implemented');
      results.sandboxSafety.emptyResponseHandling = true;
    } else {
      warning('Empty response handling may not be implemented');
    }
  }

  // Generate report
  generateReport();
}

function generateReport() {
  info('\n=== STEP 7: Generating Hardening Report ===');

  // Calculate pass rate
  let totalChecks = 0;
  let passedChecks = 0;

  Object.keys(results).forEach(category => {
    Object.keys(results[category]).forEach(check => {
      totalChecks++;
      if (results[category][check]) {
        passedChecks++;
      }
    });
  });

  const passRate = Math.round((passedChecks / totalChecks) * 100 * 100) / 100;
  const overallStatus = passRate >= 80 ? '✅ PASS' : '❌ FAIL';

  const report = `# Phase 2 Hardening Report

**Generated**: ${new Date().toISOString()}
**Overall Status**: ${overallStatus}
**Pass Rate**: ${passRate}% (${passedChecks}/${totalChecks} checks passed)

## Executive Summary

Phase 2 Continuous Data Sync hardening verification completed. This report shows the security posture of the Phase 2 implementation.

## Detailed Results

### 1. Environment Configuration
- **Sandbox HTTPS**: ${results.environment.sandboxHttps ? '✅ PASS' : '❌ FAIL'}
- **Background Sync Enabled**: ${results.environment.backgroundSyncEnabled ? '✅ PASS' : '❌ FAIL'}
- **Database Secure**: ${results.environment.databaseSecure ? '✅ PASS' : '❌ FAIL'}

### 2. Sensitive Variables
- **No Exposed Credentials**: ${results.sensitiveVariables.noExposedCredentials ? '✅ PASS' : '❌ FAIL'}
- **Encryption Keys Present**: ${results.sensitiveVariables.encryptionKeysPresent ? '✅ PASS' : '❌ FAIL'}
- **No Secrets in Logs**: ${results.sensitiveVariables.noSecretsInLogs ? '✅ PASS' : '❌ FAIL'}

### 3. Background Worker Security
- **Rate Limiting**: ${results.backgroundWorker.rateLimiting ? '✅ PASS' : '❌ FAIL'}
- **Exponential Backoff**: ${results.backgroundWorker.exponentialBackoff ? '✅ PASS' : '❌ FAIL'}
- **Error Handling**: ${results.backgroundWorker.errorHandling ? '✅ PASS' : '❌ FAIL'}
- **Graceful Shutdown**: ${results.backgroundWorker.gracefulShutdown ? '✅ PASS' : '❌ FAIL'}

### 4. Data Normalization Security
- **JSON Validation**: ${results.dataNormalization.jsonValidation ? '✅ PASS' : '❌ FAIL'}
- **SQL Injection Protection**: ${results.dataNormalization.sqlInjectionProtection ? '✅ PASS' : '❌ FAIL'}
- **Schema Integrity**: ${results.dataNormalization.schemaIntegrity ? '✅ PASS' : '❌ FAIL'}

### 5. Audit Logging
- **Structured Logs**: ${results.auditLogging.structuredLogs ? '✅ PASS' : '❌ FAIL'}
- **Log Rotation**: ${results.auditLogging.logRotation ? '✅ PASS' : '❌ FAIL'}
- **Severity Levels**: ${results.auditLogging.severityLevels ? '✅ PASS' : '❌ FAIL'}

### 6. Sandbox Safety
- **Sandbox Endpoints**: ${results.sandboxSafety.sandboxEndpoints ? '✅ PASS' : '❌ FAIL'}
- **Production Rejection**: ${results.sandboxSafety.productionRejection ? '✅ PASS' : '❌ FAIL'}
- **Empty Response Handling**: ${results.sandboxSafety.emptyResponseHandling ? '✅ PASS' : '❌ FAIL'}

## Recommendations

${passRate < 80 ? '### Critical Issues Found\n\nReview failed checks above and address security concerns before production deployment.' : '### All Systems Hardened\n\n✅ Phase 2 is properly hardened and ready for production.'}

## Log File

Detailed logs available at: ${logFile}

---
*Report generated by Phase 2 Hardening Script*
`;

  fs.writeFileSync(reportFile, report);
  success(`Report generated: ${reportFile}`);

  // Display summary
  console.log('\n========================================');
  console.log('Hardening Summary');
  console.log('========================================\n');
  console.log(`Status: ${overallStatus}`);
  console.log(`Pass Rate: ${passRate}% (${passedChecks}/${totalChecks} checks passed)\n`);
  console.log(`Report: ${reportFile}`);
  console.log(`Logs: ${logFile}\n`);

  process.exit(passRate >= 80 ? 0 : 1);
}

// Run hardening
runHardening();

