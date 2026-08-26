// @ts-nocheck
import {
  AMAZON_REALITY_MAPPING_PROVENANCE,
  amazonRealityMappingObservedEmptyEnvelopes,
} from '../fixtures/amazonRealityMappingObservedEnvelopes';

describe('Amazon Reality Mapping fixture contract', () => {
  it('labels the fixture set as a GET-only user-owned structural observation', () => {
    expect(AMAZON_REALITY_MAPPING_PROVENANCE).toMatchObject({
      source: 'user_owned_sp_api_read_only_probe',
      populatedFixtureStatus: 'BLOCKED_MISSING_OBSERVED_POPULATED_FIELD_SHAPES',
    });
    expect(AMAZON_REALITY_MAPPING_PROVENANCE.constraints).toContain('no raw seller records retained');
    expect(AMAZON_REALITY_MAPPING_PROVENANCE.constraints).toContain('no report creation or document retrieval');
  });

  it('preserves the observed zero-data envelopes without manufacturing Amazon operational rows', () => {
    expect(amazonRealityMappingObservedEmptyEnvelopes.orders.payload.Orders).toEqual([]);
    expect(amazonRealityMappingObservedEmptyEnvelopes.financialEvents.payload.FinancialEvents).toEqual({});
    expect(amazonRealityMappingObservedEmptyEnvelopes.inventorySummaries.payload.inventorySummaries).toEqual([]);
    expect(amazonRealityMappingObservedEmptyEnvelopes.settlementReports.reports).toEqual([]);
    expect(amazonRealityMappingObservedEmptyEnvelopes.inventoryReports.reports).toEqual([]);
  });

  it('uses synthetic report metadata only as a structural fixture, never as a live report document', () => {
    const report = amazonRealityMappingObservedEmptyEnvelopes.returnsReportMetadata.reports[0];

    expect(report.reportId).toBe('SYNTHETIC_REPORT_ID');
    expect(report.marketplaceIds).toEqual(['SYNTHETIC_MARKETPLACE']);
    expect(Object.keys(report).sort()).toEqual([
      'createdTime',
      'dataEndTime',
      'dataStartTime',
      'marketplaceIds',
      'processingEndTime',
      'processingStartTime',
      'processingStatus',
      'reportId',
      'reportType',
    ]);
  });
});
