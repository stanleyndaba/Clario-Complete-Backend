import {
  evaluateTransferSemanticEvidence,
  ProviderSemanticStatus,
  TransferSemanticEvidence,
  TransferSemanticResolution,
} from './transferLedgerSemanticEvidence';
import { AMAZON_LEDGER_DETAIL_REPORT_TYPE } from './transferLedgerProviderEvidenceReadiness';

export const TRANSFER_PROVIDER_SEMANTICS_CATALOG_VERSION = '1.0.0';
export const AMAZON_REPORTS_API_ARTIFACT_VERSION = 'reports-api-2021-06-30';

export type ProviderSemanticsCatalogStatus =
  | 'AUTHORITATIVELY_PROVEN'
  | 'APPROVED_EVIDENCE'
  | 'OBSERVED_RAW_ONLY'
  | 'UNRESOLVED_PROVIDER_SEMANTICS'
  | 'UNSUPPORTED';

export type ProviderAuthorityKind =
  | 'OFFICIAL_AMAZON_DOCUMENT'
  | 'OFFICIAL_AMAZON_MODEL'
  | 'APPROVED_CONTROLLED_EVIDENCE'
  | 'REPOSITORY_PROVENANCE';

export type TransferSemanticTarget =
  | 'report_context'
  | 'provider_event_type'
  | 'transfer_identity'
  | 'source_location'
  | 'destination_location'
  | 'quantity_sent'
  | 'quantity_received'
  | 'dispatch_timestamp'
  | 'receipt_timestamp'
  | 'transfer_lifecycle'
  | 'counterpart_identity'
  | 'history_coverage';

export type AllowedAssertion = 'REPORT_CONTEXT_ONLY' | 'RAW_FIELD_ONLY' | 'NONE';

export interface ProviderSemanticsCatalogEntry {
  id: string;
  version: string;
  providerSource: 'amazon_inventory_ledger';
  reportType: string;
  providerEventTypeRaw: string | null;
  providerField: string;
  semanticTarget: TransferSemanticTarget;
  declaredMeaning: string;
  authority: {
    kind: ProviderAuthorityKind;
    reference: string;
    version: string | null;
  };
  scope: {
    marketplaceIds: string[];
    providerArtifactVersion: string | null;
  };
  status: ProviderSemanticsCatalogStatus;
  allowedAssertion: AllowedAssertion;
  negativeCondition: string;
}

export interface ProviderSemanticsLookup {
  providerSource: 'amazon_inventory_ledger';
  reportType: string;
  providerEventTypeRaw: string | null;
  providerField: string;
  semanticTarget: TransferSemanticTarget;
  marketplaceId: string;
  providerArtifactVersion: string | null;
}

export interface ProviderSemanticsCatalogResolution {
  catalogVersion: string;
  lookup: ProviderSemanticsLookup;
  entry: ProviderSemanticsCatalogEntry | null;
  status: ProviderSemanticsCatalogStatus;
  allowedAssertion: AllowedAssertion;
  reasonCodes: string[];
  /** P5 cannot itself enable P3's VERIFIED_TRANSFER status. */
  p3ProviderSemantics: {
    status: Extract<ProviderSemanticStatus, 'PENDING_PROVIDER_SEMANTICS' | 'UNSUPPORTED'>;
    evidenceReference: null;
  };
  claimCapable: false;
  recoveryDetected: false;
  economicValue: null;
}

function normalized(value: string | null | undefined): string {
  return (value || '').trim().toUpperCase();
}

function sameEventType(left: string | null, right: string | null): boolean {
  return normalized(left) === normalized(right);
}

function matches(entry: ProviderSemanticsCatalogEntry, lookup: ProviderSemanticsLookup): boolean {
  const marketplaceMatches = entry.scope.marketplaceIds.includes('*')
    || entry.scope.marketplaceIds.includes(lookup.marketplaceId);
  const artifactMatches = entry.scope.providerArtifactVersion === null
    || entry.scope.providerArtifactVersion === lookup.providerArtifactVersion;

  const eventTypeMatches = entry.providerEventTypeRaw === null
    || sameEventType(entry.providerEventTypeRaw, lookup.providerEventTypeRaw);

  return entry.providerSource === lookup.providerSource
    && entry.reportType === lookup.reportType
    && entry.providerField.toLowerCase() === lookup.providerField.toLowerCase()
    && entry.semanticTarget === lookup.semanticTarget
    && eventTypeMatches
    && marketplaceMatches
    && artifactMatches;
}

function unresolvedResolution(
  lookup: ProviderSemanticsLookup,
  status: Extract<ProviderSemanticsCatalogStatus, 'UNRESOLVED_PROVIDER_SEMANTICS' | 'UNSUPPORTED'>,
  reason: string,
): ProviderSemanticsCatalogResolution {
  return {
    catalogVersion: TRANSFER_PROVIDER_SEMANTICS_CATALOG_VERSION,
    lookup,
    entry: null,
    status,
    allowedAssertion: 'NONE',
    reasonCodes: [reason],
    p3ProviderSemantics: {
      status: status === 'UNSUPPORTED' ? 'UNSUPPORTED' : 'PENDING_PROVIDER_SEMANTICS',
      evidenceReference: null,
    },
    claimCapable: false,
    recoveryDetected: false,
    economicValue: null,
  };
}

/**
 * P5 catalog entries state exactly what has been established and, just as
 * importantly, what must remain unresolved. The only authoritative default
 * entry is the narrow report-context fact. It does not authorize a Transfer
 * fact or set P3 provider semantics to VERIFIED_TRANSFER.
 */
export const TRANSFER_PROVIDER_SEMANTICS_CATALOG: readonly ProviderSemanticsCatalogEntry[] = [
  {
    id: 'amazon-ledger-detail-report-context',
    version: TRANSFER_PROVIDER_SEMANTICS_CATALOG_VERSION,
    providerSource: 'amazon_inventory_ledger',
    reportType: AMAZON_LEDGER_DETAIL_REPORT_TYPE,
    providerEventTypeRaw: null,
    providerField: '$reportType',
    semanticTarget: 'report_context',
    declaredMeaning: 'GET_LEDGER_DETAIL_VIEW_DATA is an official FBA Inventory Ledger detail report context.',
    authority: {
      kind: 'OFFICIAL_AMAZON_DOCUMENT',
      reference: 'https://developer-docs.amazon/sp-api/docs/report-type-values-fba',
      version: AMAZON_REPORTS_API_ARTIFACT_VERSION,
    },
    scope: { marketplaceIds: ['*'], providerArtifactVersion: AMAZON_REPORTS_API_ARTIFACT_VERSION },
    status: 'AUTHORITATIVELY_PROVEN',
    allowedAssertion: 'REPORT_CONTEXT_ONLY',
    negativeCondition: 'Report availability does not prove any row is a Transfer or assign lifecycle, route, quantity, or timestamp roles.',
  },
  {
    id: 'amazon-ledger-detail-event-type-raw',
    version: TRANSFER_PROVIDER_SEMANTICS_CATALOG_VERSION,
    providerSource: 'amazon_inventory_ledger',
    reportType: AMAZON_LEDGER_DETAIL_REPORT_TYPE,
    providerEventTypeRaw: null,
    providerField: 'Event Type',
    semanticTarget: 'provider_event_type',
    declaredMeaning: 'A raw event-type string is preserved exactly as provider-shaped evidence.',
    authority: {
      kind: 'REPOSITORY_PROVENANCE',
      reference: 'repository://src/services/inventoryLedgerSyncService.ts#convertReportRecords',
      version: 'p4-ledger-mapper-v1',
    },
    scope: { marketplaceIds: ['*'], providerArtifactVersion: AMAZON_REPORTS_API_ARTIFACT_VERSION },
    status: 'OBSERVED_RAW_ONLY',
    allowedAssertion: 'RAW_FIELD_ONLY',
    negativeCondition: 'A raw event label is not verified Transfer semantics or a lifecycle assertion.',
  },
  {
    id: 'amazon-ledger-detail-whse-transfers-unresolved',
    version: TRANSFER_PROVIDER_SEMANTICS_CATALOG_VERSION,
    providerSource: 'amazon_inventory_ledger',
    reportType: AMAZON_LEDGER_DETAIL_REPORT_TYPE,
    providerEventTypeRaw: 'WhseTransfers',
    providerField: 'Event Type',
    semanticTarget: 'transfer_lifecycle',
    declaredMeaning: 'WhseTransfers is an observed raw label whose required Transfer lifecycle meaning has not been authoritatively established.',
    authority: {
      kind: 'OFFICIAL_AMAZON_DOCUMENT',
      reference: 'https://developer-docs.amazon/sp-api/docs/report-type-values-fba',
      version: AMAZON_REPORTS_API_ARTIFACT_VERSION,
    },
    scope: { marketplaceIds: ['*'], providerArtifactVersion: AMAZON_REPORTS_API_ARTIFACT_VERSION },
    status: 'UNRESOLVED_PROVIDER_SEMANTICS',
    allowedAssertion: 'NONE',
    negativeCondition: 'WhseTransfers alone must not be interpreted as dispatched, received, closed, pairable, claimable, or recoverable.',
  },
  {
    id: 'amazon-ledger-detail-reference-id-unresolved',
    version: TRANSFER_PROVIDER_SEMANTICS_CATALOG_VERSION,
    providerSource: 'amazon_inventory_ledger',
    reportType: AMAZON_LEDGER_DETAIL_REPORT_TYPE,
    providerEventTypeRaw: null,
    providerField: 'Reference ID',
    semanticTarget: 'transfer_identity',
    declaredMeaning: 'Reference ID is a preserved raw value without established Transfer-identity semantics.',
    authority: {
      kind: 'REPOSITORY_PROVENANCE',
      reference: 'repository://src/services/inventoryLedgerSyncService.ts#convertReportRecords',
      version: 'p4-ledger-mapper-v1',
    },
    scope: { marketplaceIds: ['*'], providerArtifactVersion: AMAZON_REPORTS_API_ARTIFACT_VERSION },
    status: 'UNRESOLVED_PROVIDER_SEMANTICS',
    allowedAssertion: 'NONE',
    negativeCondition: 'Reference ID must not be interpreted as a Transfer identity merely because it is non-empty or unique.',
  },
  {
    id: 'amazon-ledger-detail-fulfillment-center-source-unresolved',
    version: TRANSFER_PROVIDER_SEMANTICS_CATALOG_VERSION,
    providerSource: 'amazon_inventory_ledger',
    reportType: AMAZON_LEDGER_DETAIL_REPORT_TYPE,
    providerEventTypeRaw: null,
    providerField: 'Fulfillment Center',
    semanticTarget: 'source_location',
    declaredMeaning: 'Fulfillment Center is a preserved raw location without established source-role semantics.',
    authority: {
      kind: 'REPOSITORY_PROVENANCE',
      reference: 'repository://src/services/inventoryLedgerSyncService.ts#convertReportRecords',
      version: 'p4-ledger-mapper-v1',
    },
    scope: { marketplaceIds: ['*'], providerArtifactVersion: AMAZON_REPORTS_API_ARTIFACT_VERSION },
    status: 'UNRESOLVED_PROVIDER_SEMANTICS',
    allowedAssertion: 'NONE',
    negativeCondition: 'Fulfillment Center must not be interpreted as a Transfer source solely because it appears on a Ledger row.',
  },
  {
    id: 'amazon-ledger-detail-fulfillment-center-destination-unresolved',
    version: TRANSFER_PROVIDER_SEMANTICS_CATALOG_VERSION,
    providerSource: 'amazon_inventory_ledger',
    reportType: AMAZON_LEDGER_DETAIL_REPORT_TYPE,
    providerEventTypeRaw: null,
    providerField: 'Fulfillment Center',
    semanticTarget: 'destination_location',
    declaredMeaning: 'Fulfillment Center is a preserved raw location without established destination-role semantics.',
    authority: {
      kind: 'REPOSITORY_PROVENANCE',
      reference: 'repository://src/services/inventoryLedgerSyncService.ts#convertReportRecords',
      version: 'p4-ledger-mapper-v1',
    },
    scope: { marketplaceIds: ['*'], providerArtifactVersion: AMAZON_REPORTS_API_ARTIFACT_VERSION },
    status: 'UNRESOLVED_PROVIDER_SEMANTICS',
    allowedAssertion: 'NONE',
    negativeCondition: 'A second occurrence or chronology must not turn a Fulfillment Center into a Transfer destination without authority.',
  },
  {
    id: 'amazon-ledger-detail-quantity-sent-unresolved',
    version: TRANSFER_PROVIDER_SEMANTICS_CATALOG_VERSION,
    providerSource: 'amazon_inventory_ledger',
    reportType: AMAZON_LEDGER_DETAIL_REPORT_TYPE,
    providerEventTypeRaw: null,
    providerField: 'Quantity',
    semanticTarget: 'quantity_sent',
    declaredMeaning: 'Quantity is a preserved raw signed value without established dispatched-quantity semantics.',
    authority: {
      kind: 'REPOSITORY_PROVENANCE',
      reference: 'repository://src/services/inventoryLedgerSyncService.ts#convertReportRecords',
      version: 'p4-ledger-mapper-v1',
    },
    scope: { marketplaceIds: ['*'], providerArtifactVersion: AMAZON_REPORTS_API_ARTIFACT_VERSION },
    status: 'UNRESOLVED_PROVIDER_SEMANTICS',
    allowedAssertion: 'NONE',
    negativeCondition: 'Quantity sign must not be interpreted as dispatched quantity without an authoritative event/lifecycle definition.',
  },
  {
    id: 'amazon-ledger-detail-quantity-received-unresolved',
    version: TRANSFER_PROVIDER_SEMANTICS_CATALOG_VERSION,
    providerSource: 'amazon_inventory_ledger',
    reportType: AMAZON_LEDGER_DETAIL_REPORT_TYPE,
    providerEventTypeRaw: null,
    providerField: 'Quantity',
    semanticTarget: 'quantity_received',
    declaredMeaning: 'Quantity is a preserved raw signed value without established received-quantity semantics.',
    authority: {
      kind: 'REPOSITORY_PROVENANCE',
      reference: 'repository://src/services/inventoryLedgerSyncService.ts#convertReportRecords',
      version: 'p4-ledger-mapper-v1',
    },
    scope: { marketplaceIds: ['*'], providerArtifactVersion: AMAZON_REPORTS_API_ARTIFACT_VERSION },
    status: 'UNRESOLVED_PROVIDER_SEMANTICS',
    allowedAssertion: 'NONE',
    negativeCondition: 'Quantity must not be interpreted as received quantity merely because it is positive or negative.',
  },
  {
    id: 'amazon-ledger-detail-date-dispatch-unresolved',
    version: TRANSFER_PROVIDER_SEMANTICS_CATALOG_VERSION,
    providerSource: 'amazon_inventory_ledger',
    reportType: AMAZON_LEDGER_DETAIL_REPORT_TYPE,
    providerEventTypeRaw: null,
    providerField: 'Date and Time',
    semanticTarget: 'dispatch_timestamp',
    declaredMeaning: 'Date and Time is a preserved raw timestamp without established dispatch-role semantics.',
    authority: {
      kind: 'REPOSITORY_PROVENANCE',
      reference: 'repository://src/services/inventoryLedgerSyncService.ts#convertReportRecords',
      version: 'p4-ledger-mapper-v1',
    },
    scope: { marketplaceIds: ['*'], providerArtifactVersion: AMAZON_REPORTS_API_ARTIFACT_VERSION },
    status: 'UNRESOLVED_PROVIDER_SEMANTICS',
    allowedAssertion: 'NONE',
    negativeCondition: 'Date and Time must not be treated as dispatch time merely because it precedes another row.',
  },
  {
    id: 'amazon-ledger-detail-date-receipt-unresolved',
    version: TRANSFER_PROVIDER_SEMANTICS_CATALOG_VERSION,
    providerSource: 'amazon_inventory_ledger',
    reportType: AMAZON_LEDGER_DETAIL_REPORT_TYPE,
    providerEventTypeRaw: null,
    providerField: 'Date and Time',
    semanticTarget: 'receipt_timestamp',
    declaredMeaning: 'Date and Time is a preserved raw timestamp without established receipt-role semantics.',
    authority: {
      kind: 'REPOSITORY_PROVENANCE',
      reference: 'repository://src/services/inventoryLedgerSyncService.ts#convertReportRecords',
      version: 'p4-ledger-mapper-v1',
    },
    scope: { marketplaceIds: ['*'], providerArtifactVersion: AMAZON_REPORTS_API_ARTIFACT_VERSION },
    status: 'UNRESOLVED_PROVIDER_SEMANTICS',
    allowedAssertion: 'NONE',
    negativeCondition: 'Date and Time must not be treated as receipt time merely because it follows another row.',
  },
  {
    id: 'amazon-ledger-detail-lifecycle-unsupported',
    version: TRANSFER_PROVIDER_SEMANTICS_CATALOG_VERSION,
    providerSource: 'amazon_inventory_ledger',
    reportType: AMAZON_LEDGER_DETAIL_REPORT_TYPE,
    providerEventTypeRaw: null,
    providerField: '$lifecycle',
    semanticTarget: 'transfer_lifecycle',
    declaredMeaning: 'No authoritative Ledger-detail provider lifecycle field was established for Transfer dispatch, in-transit, receipt, or closure.',
    authority: {
      kind: 'OFFICIAL_AMAZON_DOCUMENT',
      reference: 'https://developer-docs.amazon/sp-api/docs/report-type-values-fba',
      version: AMAZON_REPORTS_API_ARTIFACT_VERSION,
    },
    scope: { marketplaceIds: ['*'], providerArtifactVersion: AMAZON_REPORTS_API_ARTIFACT_VERSION },
    status: 'UNSUPPORTED',
    allowedAssertion: 'NONE',
    negativeCondition: 'Margin must not manufacture a Transfer lifecycle enum from raw Ledger chronology or event labels.',
  },
];

/** Resolves one field/context against the versioned catalog without creating any Transfer assertion. */
export function resolveProviderSemanticsCatalog(
  lookup: ProviderSemanticsLookup,
  entries: readonly ProviderSemanticsCatalogEntry[] = TRANSFER_PROVIDER_SEMANTICS_CATALOG,
): ProviderSemanticsCatalogResolution {
  const matchingEntries = entries.filter((entry) => matches(entry, lookup));
  if (matchingEntries.length === 0) {
    return unresolvedResolution(lookup, 'UNRESOLVED_PROVIDER_SEMANTICS', 'NO_CATALOG_MAPPING');
  }
  if (matchingEntries.length > 1) {
    return unresolvedResolution(lookup, 'UNRESOLVED_PROVIDER_SEMANTICS', 'AMBIGUOUS_CATALOG_MAPPING');
  }

  const entry = matchingEntries[0];
  const p3Status = entry.status === 'UNSUPPORTED'
    ? 'UNSUPPORTED'
    : 'PENDING_PROVIDER_SEMANTICS';
  return {
    catalogVersion: TRANSFER_PROVIDER_SEMANTICS_CATALOG_VERSION,
    lookup,
    entry,
    status: entry.status,
    allowedAssertion: entry.allowedAssertion,
    reasonCodes: [entry.status],
    p3ProviderSemantics: { status: p3Status, evidenceReference: null },
    claimCapable: false,
    recoveryDetected: false,
    economicValue: null,
  };
}

/**
 * Ensures P5 cannot bypass the P3 evaluator. This local catalog release never
 * upgrades provider semantics to VERIFIED_TRANSFER; future evidence must be
 * separately reviewed before any versioned catalog policy can do so.
 */
export function evaluateCatalogThenP3(
  evidence: TransferSemanticEvidence,
  catalogResolution: ProviderSemanticsCatalogResolution,
): TransferSemanticResolution {
  return evaluateTransferSemanticEvidence({
    ...evidence,
    providerSemantics: catalogResolution.p3ProviderSemantics,
  });
}
