import { describe, expect, it } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import { TRANSFER_P135_AUDIT_REGISTRY } from '../../src/services/transferLedgerP135AuditRegistry';

const source = (...segments: string[]) => fs.readFileSync(path.resolve(__dirname, '../../src', ...segments), 'utf8');
const migration = () => fs.readFileSync(path.resolve(__dirname, '../../migrations/133_reconcile_transfer_ledger_observation_rail.sql'), 'utf8');

function expectNoRuntimeIntegration(content: string) {
  expect(content).not.toMatch(/from ['"].*(supabase|axios|pg|knex|ioredis|aws-sdk)/);
  expect(content).not.toMatch(/\b(fetch|axios|supabase|postgres|prisma)\b/);
}

describe('P51–P128 static Transfer safety boundary audit', () => {
  it('proves that P3 requires independently verified provider semantics and P5 cannot grant it', () => {
    const p3 = source('services', 'transferLedgerSemanticEvidence.ts');
    const p5 = source('services', 'transferLedgerProviderSemanticsCatalog.ts');
    expect(p3).toContain("evidence.providerSemantics.status !== 'VERIFIED_TRANSFER'");
    expect(p3).toContain("['PROVIDER_SEMANTICS_UNVERIFIED']");
    expect(p5).toContain("/** P5 cannot itself enable P3's VERIFIED_TRANSFER status. */");
    expect(p5).toContain("'PENDING_PROVIDER_SEMANTICS'");
  });

  it('proves that the observation rail persists only raw states and explicitly excludes transfer reconstruction, detection, valuation, and claim capability', () => {
    const observation = source('services', 'transferLedgerObservationService.ts');
    const sql = migration();
    expect(observation).toContain('writes inventory_transfers, emits a');
    expect(observation).toContain('detection result, assigns a valuation, or creates claim-capable output');
    expect(sql).toContain("observation_state IN ('UNPAIRED', 'AMBIGUOUS', 'PENDING_PROVIDER_SEMANTICS')");
    expect(sql).toContain("'connected_transfer_ledger_observation'");
    expect(sql).toContain("'{\"mode\":\"OFF\",\"claim_capable\":false,\"observation_version\":\"v1\"}'");
    expect(sql).not.toContain('CREATE TABLE inventory_transfers');
    expect(sql).not.toContain('CREATE TABLE detection_results');
  });

  it('proves the detector is a materially later, database and valuation-dependent boundary and is never imported by local P10/P11/P135 audit seams', () => {
    const detector = source('services', 'detection', 'core', 'detectors', 'warehouseTransferLossAlgorithm.ts');
    const p10 = source('services', 'transferLedgerCatalogChangeExecution.ts');
    const p11 = source('services', 'transferLedgerLocalCatalogReadPublication.ts');
    const p135 = source('services', 'transferLedgerP135AuditRegistry.ts');
    expect(detector).toContain(".from('inventory_transfers')");
    expect(detector).toContain(".from('detection_results')");
    expect(detector).toContain('buildSellerValuationContext');
    expect(detector).toContain('storeTransferLossResults');
    for (const content of [p10, p11, p135]) {
      expect(content).not.toMatch(/from ['\"][^'\"]*warehouseTransferLossAlgorithm['\"]/);
      expect(content).not.toMatch(/from ['\"][^'\"]*detectWarehouseTransferLoss['\"]/);
      expectNoRuntimeIntegration(content);
    }
  });

  it('proves that P10/P11/P135 retain permanent zero-claim output contracts and no active runtime path', () => {
    const p10 = source('services', 'transferLedgerCatalogChangeExecution.ts');
    const p11 = source('services', 'transferLedgerLocalCatalogReadPublication.ts');
    const p135 = source('services', 'transferLedgerP135AuditRegistry.ts');
    for (const content of [p10, p11, p135]) {
      expect(content).toContain('claimCapable: false');
      expect(content).toContain('recoveryDetected: false');
      expect(content).toContain('economicValue: null');
      expect(content).toContain('detectorResult: null');
    }
    expect(p11).toContain('transferActivationAuthorized: false');
    expect(p11).toContain('observationAuthorized: false');
    expect(p11).toContain('detectorAuthorized: false');
    expect(p135).toContain('productionAllowed: false');
    expect(p135).toContain('providerAllowed: false');
  });

  it('proves that P10/P11/P135 do not import recovery services or bridge any audit result into a claim/recovery lifecycle', () => {
    const p10 = source('services', 'transferLedgerCatalogChangeExecution.ts');
    const p11 = source('services', 'transferLedgerLocalCatalogReadPublication.ts');
    const p135 = source('services', 'transferLedgerP135AuditRegistry.ts');
    for (const content of [p10, p11, p135]) {
      expect(content).not.toMatch(/from ['\"][^'\"]*recovery[A-Za-z]*Service['\"]/);
      expect(content).not.toMatch(/from ['\"][^'\"]*recoveryIntentScoringService['\"]/);
      expect(content).not.toContain('claimCreated: true');
      expect(content).not.toContain('recoveryCreated: true');
      expect(content).not.toContain('economicValueCalculated: true');
    }
  });

  it('proves that every P11–P135 gate remains a local-only safety audit and no gate is marked as a provider or production operation', () => {
    expect(TRANSFER_P135_AUDIT_REGISTRY).toHaveLength(125);
    for (const gate of TRANSFER_P135_AUDIT_REGISTRY) {
      expect(gate.productionAllowed).toBe(false);
      expect(gate.providerAllowed).toBe(false);
      expect(gate.forbiddenBehavior).toContain('Provider access');
      expect(gate.forbiddenBehavior).toContain('production mutation');
      expect(gate.forbiddenBehavior).toContain('detector invocation');
      expect(gate.forbiddenBehavior).toContain('claim');
      expect(gate.forbiddenBehavior).toContain('economic calculation');
    }
  });
});
