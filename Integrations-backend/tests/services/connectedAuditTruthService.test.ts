// @ts-nocheck
import { classifyConnectedAuditTruth } from '../../src/services/connectedAuditTruthService';

describe('connectedAuditTruthService', () => {
  it('labels a completed, connected SP-API sync with zero records as connected zero operational data', () => {
    const actual = classifyConnectedAuditTruth({
      sourceType: 'sp_api',
      syncStatus: 'completed',
      recordsReviewed: 0,
      findingsCount: 0,
      sourcesUnavailable: [],
    });

    expect(actual).toEqual({
      state: 'connected_zero_operational_data',
      message: 'Amazon connected successfully, but no usable Amazon records were available for this audit. No recovery conclusion can be made until operational data is available.',
      retryable: true,
      hasUsableOperationalData: false,
    });
  });

  it('retains the no-recovery-conclusion boundary when connected zero data also has unavailable sources', () => {
    const actual = classifyConnectedAuditTruth({
      sourceType: 'sp-api',
      syncStatus: 'completed',
      recordsReviewed: 0,
      findingsCount: 0,
      sourcesUnavailable: ['Orders', 'Finances'],
    });

    expect(actual.state).toBe('connected_zero_operational_data');
    expect(actual.message).toContain('Amazon connected successfully');
    expect(actual.message).toContain('no usable Amazon records');
    expect(actual.message).toContain('no recovery conclusion can be made');
    expect(actual.retryable).toBe(true);
    expect(actual.hasUsableOperationalData).toBe(false);
  });

  it('does not relabel a manual CSV audit as connected zero operational data', () => {
    const actual = classifyConnectedAuditTruth({
      sourceType: 'csv_upload',
      syncStatus: 'completed',
      recordsReviewed: 0,
      findingsCount: 0,
      sourcesUnavailable: ['Orders'],
    });

    expect(actual).toMatchObject({
      state: 'limited_coverage',
      retryable: true,
      hasUsableOperationalData: false,
    });
    expect(actual.message).not.toContain('Amazon connected successfully');
  });

  it('keeps reviewed no-opportunity distinct when usable data was actually reviewed', () => {
    const actual = classifyConnectedAuditTruth({
      sourceType: 'sp_api',
      syncStatus: 'completed',
      recordsReviewed: 12,
      findingsCount: 0,
      sourcesUnavailable: [],
    });

    expect(actual).toEqual({
      state: 'reviewed_no_opportunities',
      message: 'Margin reviewed the available Amazon activity and did not identify recovery opportunities in that audit window.',
      retryable: false,
      hasUsableOperationalData: true,
    });
  });

  it('does not allow a zero-record completed source to manufacture a finding or recovery conclusion', () => {
    const actual = classifyConnectedAuditTruth({
      sourceType: 'sp_api',
      syncStatus: 'completed',
      recordsReviewed: 0,
      findingsCount: 0,
      sourcesUnavailable: [],
    });

    expect(actual.state).not.toBe('findings_available');
    expect(actual.message).not.toMatch(/no recovery opportunities/i);
  });
});
