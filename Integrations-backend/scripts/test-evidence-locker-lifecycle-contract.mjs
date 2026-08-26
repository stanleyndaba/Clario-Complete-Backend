import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const documentsRoute = read('src/routes/documentsRoutes.ts');
const evidenceRoute = read('src/routes/evidenceRoutes.ts');
const assertions = [];
const check = (condition, description) => {
  assert.ok(condition, description);
  assertions.push(description);
};

check(documentsRoute.includes("router.post('/upload', upload.any()"), 'verified multipart upload route remains available');
check(documentsRoute.includes(".eq('tenant_id', tenantId)"), 'document route continues to scope sensitive operations to the active tenant');
check(documentsRoute.includes("router.post('/:id/archive'"), 'archive lifecycle route is present');
check(documentsRoute.includes("router.post('/:id/supersede'"), 'supersession lifecycle route is present');
check(documentsRoute.includes("lifecycle_state: 'archived'"), 'archive records a durable lifecycle state');
check(documentsRoute.includes("superseded_by_document_id"), 'supersession records replacement lineage');
check(documentsRoute.includes("supersedes_document_id"), 'replacement records its original artifact lineage');
check(documentsRoute.includes('evidenceAuditService.logManualEdit'), 'archive and supersession preserve an audit-history mutation');
check(documentsRoute.includes("evidence_state: 'Archived'"), 'archived artifacts have a truthful non-active evidence state');
check(documentsRoute.includes("evidence_state: 'Superseded'"), 'superseded artifacts have a truthful non-active evidence state');
check(documentsRoute.includes('Destructive deletion is disabled to preserve evidence provenance'), 'primary destructive delete route is disabled');
check(evidenceRoute.includes('Destructive deletion is disabled to preserve evidence provenance'), 'legacy v1 destructive delete route is disabled');
check(evidenceRoute.includes('Bulk destructive deletion is disabled to preserve evidence provenance'), 'legacy bulk destructive delete route is disabled');

console.log(`Evidence Locker lifecycle contract passed: ${assertions.length} assertions.`);
for (const description of assertions) console.log(`✓ ${description}`);
