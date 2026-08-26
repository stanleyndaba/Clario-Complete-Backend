#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (relativePath) => readFileSync(resolve(root, relativePath), 'utf8');
let checks = 0;

function expectIncludes(source, expected, description) {
  assert.ok(source.includes(expected), `${description}\nExpected to find: ${expected}`);
  checks += 1;
}

function expectExcludes(source, unexpected, description) {
  assert.ok(!source.includes(unexpected), `${description}\nUnexpected text found: ${unexpected}`);
  checks += 1;
}

const service = read('src/services/auditRunService.ts');
const routes = read('src/routes/auditRoutes.ts');
const frontend = read('../../opside-complete-frontend/src/pages/audit.tsx');
const frontendApi = read('../../opside-complete-frontend/src/lib/api.ts');

expectIncludes(service, "process.env.ENABLE_AUDIT_SCHEDULE_WORKER === 'true'", 'Schedule execution availability must reflect the actual worker gate.');
expectIncludes(service, "completion_notification: 'in_app' as const", 'The schedule API must state that completed-audit notice is in-app.');
expectIncludes(service, 'completion_email_enabled: false', 'The schedule API must not imply completion email delivery.');
expectIncludes(service, 'Automatic audit scheduling is not currently available.', 'A disabled worker must reject a new active schedule rather than save a nonfunctional preference.');
expectIncludes(service, "async startAudit(userId: string, email?: string | null, auditIntentId?: string | null, preferredTenantSlug?: string | null)", 'Starting an audit must accept the active workspace identity.');
expectIncludes(service, 'ensureAuthenticatedUserWorkspace({ userId, email, preferredTenantSlug })', 'Audit bootstrap must honor the active workspace rather than a default membership.');
expectIncludes(service, "async getLatestAudit(userId: string, tenantId?: string | null)", 'Current Audit must accept an active tenant scope.');
expectIncludes(service, "query = query.eq('tenant_id', tenantId);", 'Audit service reads must filter by tenant when a tenant is resolved.');
expectIncludes(service, "async getAuditHistory(userId: string, limit = 18, tenantId?: string | null)", 'Audit history must accept an active tenant scope.');
expectIncludes(service, "async getSchedule(userId: string, tenantId: string)", 'Schedule lookup must derive from the active workspace, not latest audit state.');
expectIncludes(service, "lastRunStatus === 'audit_started'", 'Existing started-attempt metadata must surface as a running schedule state.');
expectIncludes(service, "async saveSchedule(userId: string, tenantId: string", 'Schedule save must bind to an explicit workspace.');

expectIncludes(routes, 'function getResolvedTenantId', 'Audit routes must fail closed without a resolved workspace context.');
expectIncludes(routes, 'String((req as any).tenant?.tenantSlug || \'\').trim() || null', 'Audit start route must pass the active workspace to bootstrap.');
expectIncludes(routes, 'auditRunService.getLatestAudit(userId, tenantId)', 'Current Audit route must pass tenant scope.');
expectIncludes(routes, 'auditRunService.getAuditHistory(userId, limit, tenantId)', 'Audit history route must pass tenant scope.');
expectIncludes(routes, 'auditRunService.getSchedule(userId, tenantId)', 'Schedule read route must pass tenant scope.');
expectIncludes(routes, 'auditRunService.saveSchedule(userId, tenantId, {', 'Schedule save route must pass tenant scope.');
expectIncludes(routes, 'auditRunService.getExportSummary(auditId, userId, tenantId)', 'Export route must reject cross-workspace audit IDs.');
expectIncludes(routes, 'auditRunService.getActivity(auditId, userId, tenantId)', 'Activity route must reject cross-workspace audit IDs.');
expectIncludes(routes, 'auditRunService.getResults(auditId, userId, tenantId)', 'Results route must reject cross-workspace audit IDs.');

expectIncludes(frontendApi, 'export interface AuditScheduleExecutionStatus', 'Frontend must type the schedule execution capability explicitly.');
expectIncludes(frontendApi, 'execution: AuditScheduleExecutionStatus;', 'Schedule API responses must expose execution capability to the seller UI.');
expectIncludes(frontend, 'Automatic execution is not active in this environment.', 'Schedule UI must tell the seller when execution is unavailable.');
expectIncludes(frontend, 'completion email is not enabled from this schedule.', 'Schedule UI must not imply email delivery.');
expectIncludes(frontend, 'Margin will not save a new active schedule because it could not run it.', 'Schedule UI must explain the fail-closed behavior.');
expectIncludes(frontend, 'A seller-readable record of preparation, coverage, analysis, and result for the selected audit.', 'Activity UI must distinguish the seller lifecycle from a live execution log.');
expectIncludes(frontend, 'it is not a live event stream.', 'Activity UI must not claim non-existent live streaming.');
expectExcludes(frontend, 'Live Audit Log', 'The seller UI must not retain the inaccurate Live Audit Log label.');
expectIncludes(frontend, 'It downloads in this browser only;', 'Export UI must state its actual client-side delivery behavior.');
expectIncludes(frontend, 'Margin does not retain a copy or send it by email.', 'Export UI must not imply server persistence or email delivery.');

console.log(`PASS: ${checks} Audit operational contract assertions`);
