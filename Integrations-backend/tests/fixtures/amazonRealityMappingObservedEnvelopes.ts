export const AMAZON_REALITY_MAPPING_PROVENANCE = {
  source: 'user_owned_sp_api_read_only_probe',
  observedAt: '2026-08-26',
  constraints: [
    'GET-only discovery run',
    'no report creation or document retrieval',
    'no raw seller records retained',
    'field names and empty/populated counts only',
  ],
  populatedFixtureStatus: 'BLOCKED_MISSING_OBSERVED_POPULATED_FIELD_SHAPES',
} as const;

/**
 * These fixtures retain only response envelopes directly observed on the user-owned
 * low-activity SP-API account. All placeholder dates and identifiers are synthetic
 * structural values and must never be represented as seller data.
 */
export const amazonRealityMappingObservedEmptyEnvelopes = {
  orders: {
    payload: {
      Orders: [],
      CreatedBefore: '2099-01-01T00:00:00.000Z',
    },
  },
  financialEvents: {
    payload: {
      FinancialEvents: {},
    },
  },
  inventorySummaries: {
    payload: {
      granularity: {},
      inventorySummaries: [],
    },
  },
  settlementReports: {
    reports: [],
  },
  inventoryReports: {
    reports: [],
  },
  returnsReportMetadata: {
    reports: [{
      reportType: 'SYNTHETIC_OBSERVED_REPORT_TYPE',
      processingEndTime: '2099-01-01T00:01:00.000Z',
      processingStatus: 'DONE',
      marketplaceIds: ['SYNTHETIC_MARKETPLACE'],
      reportId: 'SYNTHETIC_REPORT_ID',
      dataEndTime: '2099-01-01T00:00:00.000Z',
      createdTime: '2099-01-01T00:00:00.000Z',
      processingStartTime: '2099-01-01T00:00:30.000Z',
      dataStartTime: '2098-12-01T00:00:00.000Z',
    }],
  },
  catalogSearch: {
    numberOfResults: 1,
    pagination: { nextToken: 'SYNTHETIC_NEXT_TOKEN' },
    refinements: { brands: {}, classifications: {} },
    items: [{ asin: 'SYNTHETIC_ASIN', summaries: [] }],
  },
} as const;
