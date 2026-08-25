import { describe, expect, it } from '@jest/globals';
import {
  buildTransferLedgerP135Registry,
  getExpectedTransferLedgerGateIds,
  transferLedgerP135GateDefinitions,
} from '../../src/services/transferLedgerP135AuditRegistry';

describe('Transfer Ledger P135 independent audit registry', () => {
  it('locks exactly P110 through P135 in deterministic order', () => {
    expect(getExpectedTransferLedgerGateIds()).toEqual([
      'P110', 'P111', 'P112', 'P113', 'P114', 'P115', 'P116', 'P117', 'P118',
      'P119', 'P120', 'P121', 'P122', 'P123', 'P124', 'P125', 'P126', 'P127',
      'P128', 'P129', 'P130', 'P131', 'P132', 'P133', 'P134', 'P135',
    ]);
    expect(transferLedgerP135GateDefinitions.map((gate) => gate.id)).toEqual(getExpectedTransferLedgerGateIds());
    expect(transferLedgerP135GateDefinitions).toHaveLength(26);
  });

  it('requires deterministic metadata and valid dependencies for every gate', () => {
    const gateIds = new Set(getExpectedTransferLedgerGateIds());
    for (const gate of transferLedgerP135GateDefinitions) {
      expect(gate.title.trim()).not.toBe('');
      expect(gate.domain.trim()).not.toBe('');
      expect(gate.requiredEvidence.length).toBeGreaterThan(0);
      expect(gate.safetyAssertions.length).toBeGreaterThan(0);
      expect(new Set(gate.dependencies).size).toBe(gate.dependencies.length);
      expect(gate.dependencies).not.toContain(gate.id);
      for (const dependency of gate.dependencies) {
        expect(gateIds).toContain(dependency);
      }
    }
  });

  it('reports the actual incomplete state as NOT_CERTIFIED with blockers', () => {
    const registry = buildTransferLedgerP135Registry();

    expect(registry.verdict).toBe('NOT_CERTIFIED');
    expect(registry.p134Status).toBe('NOT_RUN');
    expect(registry.blockers.length).toBeGreaterThan(0);
    expect(registry.gates.find((gate) => gate.id === 'P119')).toEqual(expect.objectContaining({
      testStatus: 'NOT_IMPLEMENTED',
      verdict: 'BLOCKED',
    }));
    expect(registry.gates.find((gate) => gate.id === 'P135')).toEqual(expect.objectContaining({
      verdict: 'BLOCKED',
    }));
  });

  it('is hash-stable and purely declarative for identical local evidence', () => {
    const first = buildTransferLedgerP135Registry();
    const second = buildTransferLedgerP135Registry();

    expect(first.registryHash).toMatch(/^[a-f0-9]{64}$/);
    expect(second.registryHash).toBe(first.registryHash);
    expect(second).toEqual(first);
  });

  it('can only report CERTIFIED when every gate and P134 are explicitly supplied as passing evidence', () => {
    const evidenceOverrides = Object.fromEntries(
      getExpectedTransferLedgerGateIds().map((id) => [id, { testStatus: 'PASS' as const, blockers: [] }]),
    );
    const registry = buildTransferLedgerP135Registry({
      evidenceOverrides,
      p134Status: 'PASS',
    });

    expect(registry.gates.every((gate) => gate.verdict === 'PASS')).toBe(true);
    expect(registry.blockers).toEqual([]);
    expect(registry.verdict).toBe('CERTIFIED');
  });

  it('never converts even a CERTIFIED documentation verdict into an activation capability', () => {
    const evidenceOverrides = Object.fromEntries(
      getExpectedTransferLedgerGateIds().map((id) => [id, { testStatus: 'PASS' as const, blockers: [] }]),
    );
    const registry = buildTransferLedgerP135Registry({ evidenceOverrides, p134Status: 'PASS' });

    expect(registry.safetyAssertions).toEqual({
      transferActivation: 'OFF',
      providerAccess: 'NONE',
      economicOutput: 'NONE',
      productionMutation: 'NONE',
    });
  });

  it('changes the hash and remains NOT_CERTIFIED when a supplied gate is blocked', () => {
    const baseline = buildTransferLedgerP135Registry();
    const overridden = buildTransferLedgerP135Registry({
      evidenceOverrides: {
        P111: { testStatus: 'FAIL', blockers: ['Adversarial taxonomy bypass reproduced locally.'] },
      },
    });

    expect(overridden.registryHash).not.toBe(baseline.registryHash);
    expect(overridden.verdict).toBe('NOT_CERTIFIED');
    expect(overridden.blockers).toContain('P111: Adversarial taxonomy bypass reproduced locally.');
  });
});
