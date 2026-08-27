import fs from 'fs';
import path from 'path';
import { describe, expect, it } from '@jest/globals';

const fixtureRoot = path.resolve(__dirname, '../fixtures/syntheticAuditCertification');
const manifest = JSON.parse(fs.readFileSync(path.join(fixtureRoot, 's0-s11-manifest.json'), 'utf8'));
const evidenceMap = JSON.parse(fs.readFileSync(path.join(fixtureRoot, 's0-s11-evidence-map.json'), 'utf8'));
const repoRoot = path.resolve(__dirname, '../..');

const expectedScenarioIds = Array.from({ length: 12 }, (_, index) => `S${index}`);
const requiredScenarioFields = [
  'id',
  'name',
  'input_facts',
  'expected_parser_state',
  'expected_source_coverage',
  'expected_detector_state',
  'expected_findings',
  'expected_monetary_result',
  'expected_unknowns',
  'expected_commercial_state',
  'expected_side_effects',
];

describe('complete synthetic audit certification matrix', () => {
  it('defines machine-readable expected outcomes for every S0–S11 scenario', () => {
    expect(manifest.provenance).toBe('SYNTHETIC_TRAINING_ONLY');
    expect(manifest.scope).toBe('internal_only');
    expect(manifest.scenarios.map((scenario: any) => scenario.id)).toEqual(expectedScenarioIds);

    for (const scenario of manifest.scenarios) {
      for (const field of requiredScenarioFields) {
        expect(scenario).toHaveProperty(field);
      }
      expect(scenario.expected_commercial_state).toBe('suppressed');
      expect(scenario.expected_side_effects).toBe('shared');
      expect(scenario.expected_unknowns).toEqual(expect.any(Array));
    }
  });

  it('links every S0–S11 scenario to executable real-contract evidence files', () => {
    expect(Object.keys(evidenceMap.scenarios)).toEqual(expectedScenarioIds);

    for (const scenarioId of expectedScenarioIds) {
      const evidence = evidenceMap.scenarios[scenarioId];
      expect(evidence.files.length).toBeGreaterThan(0);
      expect(evidence.assertions.length).toBeGreaterThan(0);
      for (const relativeFile of evidence.files) {
        expect(fs.existsSync(path.join(repoRoot, relativeFile))).toBe(true);
      }
    }

    for (const relativeFile of evidenceMap.shared_safety_files) {
      expect(fs.existsSync(path.join(repoRoot, relativeFile))).toBe(true);
    }
  });

  it('retains executable evidence for exact synthetic-route authorization failures', () => {
    expect(evidenceMap.authorization_boundary).toEqual(expect.objectContaining({
      files: expect.arrayContaining([
        'tests/services/syntheticAuditExecutionContext.test.ts',
        'tests/routes/csvUploadRoutes.syntheticTraining.test.ts',
        'tests/middleware/userIdMiddleware.syntheticTraining.test.ts',
      ]),
      assertions: expect.arrayContaining([
        expect.stringContaining('configured training tenants fail closed'),
        expect.stringContaining('must equal the configured dedicated tenant'),
      ]),
    }));

    for (const relativeFile of evidenceMap.authorization_boundary.files) {
      expect(fs.existsSync(path.join(repoRoot, relativeFile))).toBe(true);
    }
  });

  it('retains durable provenance and prohibits Transfer, provider, Redis, and commercial execution', () => {
    expect(manifest.authoritative_rules).toMatchObject({
      synthetic_authority: 'durable_server_provenance_only',
      sync_id_role: 'observability_only',
      commercial_state: 'suppressed',
      provider_actions: 'prohibited',
      transfer_execution: 'prohibited',
      redis_dependency: 'prohibited',
      normal_upload_promotion: 'prohibited',
    });

    const s11 = manifest.scenarios.find((scenario: any) => scenario.id === 'S11');
    expect(s11.expected_parser_state).toContain('ordinary_transfer_reports_rejected_pre_persistence');
    expect(s11.expected_detector_state).toContain('transfer_auditor_and_transfer_derived_whale_path_receive_no_prohibited_input');
    expect(s11.prohibited_conclusions).toEqual(expect.arrayContaining([
      'prohibited_transfer_creates_run_canonical_row_queue_audit_detector_or_monetary_finding',
    ]));
    expect(evidenceMap.excludes).toEqual(expect.arrayContaining([
      'legacy_transfer_positive_semantics_tests',
      'provider_calls',
      'redis_backed_execution',
      'production_runtime_submission',
    ]));
  });
});
