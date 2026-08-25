import { buildTransferLedgerP135Registry } from '../src/services/transferLedgerP135AuditRegistry';

/**
 * Local certification evidence renderer. The registry is pure data: this
 * runner neither opens a network connection nor starts a worker, migration,
 * detector, recovery, or feature-activation path.
 */
function run(): void {
  const registry = buildTransferLedgerP135Registry();
  console.log(JSON.stringify({
    verdict: registry.verdict,
    p134Status: registry.p134Status,
    blockers: registry.blockers,
    safetyAssertions: registry.safetyAssertions,
    registryHash: registry.registryHash,
    gates: registry.gates.map((gate) => ({
      id: gate.id,
      title: gate.title,
      testStatus: gate.testStatus,
      verdict: gate.verdict,
      blockers: gate.blockers,
    })),
  }, null, 2));
}

run();
