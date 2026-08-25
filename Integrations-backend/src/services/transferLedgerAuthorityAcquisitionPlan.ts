import {
  AMAZON_REPORTS_API_ARTIFACT_VERSION,
  ProviderSemanticsCatalogStatus,
  TransferSemanticTarget,
  TRANSFER_PROVIDER_SEMANTICS_CATALOG_VERSION,
} from './transferLedgerProviderSemanticsCatalog';
import { AMAZON_LEDGER_DETAIL_REPORT_TYPE } from './transferLedgerProviderEvidenceReadiness';

export const TRANSFER_AUTHORITY_ACQUISITION_PLAN_VERSION = '1.0.0';

export type AuthorityClass =
  | 'AUTHORITATIVE_PROVIDER_DOCUMENTATION'
  | 'AUTHORITATIVE_PROVIDER_SCHEMA'
  | 'APPROVED_CONTROLLED_PROVIDER_EVIDENCE'
  | 'APPROVED_REDACTED_FIXTURE'
  | 'OBSERVED_RAW'
  | 'UNRESOLVED'
  | 'UNSUPPORTED';

export type AuthorityAcquisitionState =
  | 'EVIDENCE_REQUIRED'
  | 'EVIDENCE_ACQUIRED'
  | 'UNDER_REVIEW'
  | 'READY_FOR_SEPARATE_CATALOG_REVIEW'
  | 'UNRESOLVED'
  | 'REJECTED'
  | 'SUPERSEDED'
  | 'INVALIDATED'
  | 'UNSUPPORTED';

export type ReviewerStatus = 'NOT_SUBMITTED' | 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED';
export type ProposedCatalogUpgrade = 'APPROVED_EVIDENCE' | 'AUTHORITATIVELY_PROVEN';

export interface ProviderContextRequirement {
  provider: 'amazon_inventory_ledger';
  reportType: string;
  eventType: string | null;
  field: string;
  marketplaceIds: string[];
  artifactVersion: string;
}

export interface AuthorityAcquisitionTarget {
  id: string;
  version: string;
  semanticTarget: TransferSemanticTarget;
  currentStatus: 'UNRESOLVED_PROVIDER_SEMANTICS';
  proposition: string;
  minimumEvidenceRequired: string;
  acceptableAuthorityClasses: AuthorityClass[];
  providerContext: ProviderContextRequirement;
  negativeConditions: string[];
  reviewRequirements: string[];
  resultingAllowedUpgrade: ProposedCatalogUpgrade[];
}

export interface EvidenceAcquisitionRecord {
  evidenceId: string;
  targetId: string;
  provider: 'amazon_inventory_ledger';
  artifactType: string;
  sourceReference: string;
  retrievedAt: string;
  artifactVersion: string;
  marketplaceId: string;
  reportType: string;
  eventType: string | null;
  field: string;
  proposedSemanticTarget: TransferSemanticTarget;
  proposition: string;
  evidenceReference: string;
  evidenceExcerptOrLocator: string;
  provenanceHash: string | null;
  authorityClass: AuthorityClass;
  evidenceAssessment: 'CLEAR' | 'AMBIGUOUS';
  proposedCatalogUpgrade: ProposedCatalogUpgrade | null;
  reviewerStatus: ReviewerStatus;
  review: AuthorityReview;
  negativeConditions: string[];
  supersedes: string | null;
  supersededBy: string | null;
  invalidatedAt: string | null;
  invalidationReason: string | null;
  scope: {
    tenantId: string | null;
    userId: string | null;
    storeId: string | null;
    marketplaceId: string;
    crossTenantAssertionPermitted: false;
    crossStoreAssertionPermitted: false;
    crossMarketplaceAssertionPermitted: false;
  };
  notes: string | null;
}

export interface AuthorityReview {
  reviewerId: string | null;
  reviewedAt: string | null;
  exactPropositionAnswered: boolean;
  exactArtifactAnswered: boolean;
  authorityAnswered: boolean;
  providerContextAnswered: boolean;
  marketplaceAnswered: boolean;
  artifactVersionAnswered: boolean;
  negativeBoundaryAnswered: boolean;
  reproducibilityAnswered: boolean;
  provenanceAnswered: boolean;
  independentAuditAnswered: boolean;
  proposedUpgradeAnswered: boolean;
  p3FailClosedAnswered: boolean;
  notes: string | null;
}

export interface AuthorityAcquisitionResolution {
  planVersion: string;
  target: AuthorityAcquisitionTarget;
  record: EvidenceAcquisitionRecord | null;
  state: AuthorityAcquisitionState;
  reasonCodes: string[];
  /** P6 describes evidence; it never changes the P5 catalog. */
  proposedCatalogUpgrade: ProposedCatalogUpgrade | null;
  catalogMutationAuthorized: false;
  p3OverrideAuthorized: false;
  claimCapable: false;
  recoveryDetected: false;
  economicValue: null;
  detectorResult: null;
}

export const AUTHORITY_HIERARCHY: Readonly<Record<AuthorityClass, {
  rank: number;
  acceptableForReview: boolean;
  description: string;
}>> = {
  AUTHORITATIVE_PROVIDER_DOCUMENTATION: {
    rank: 4,
    acceptableForReview: true,
    description: 'Official provider documentation that explicitly defines the exact field/event proposition in the required context.',
  },
  AUTHORITATIVE_PROVIDER_SCHEMA: {
    rank: 4,
    acceptableForReview: true,
    description: 'Official provider schema or model that explicitly defines the exact field/event proposition in the required context.',
  },
  APPROVED_CONTROLLED_PROVIDER_EVIDENCE: {
    rank: 3,
    acceptableForReview: true,
    description: 'Separately authorized, provenance-complete, observation-only provider evidence reviewed under this plan.',
  },
  APPROVED_REDACTED_FIXTURE: {
    rank: 2,
    acceptableForReview: true,
    description: 'Traceable redacted fixture approved for review; it cannot silently establish a provider semantic by itself.',
  },
  OBSERVED_RAW: {
    rank: 1,
    acceptableForReview: false,
    description: 'Raw field presence only; not semantic authority.',
  },
  UNRESOLVED: {
    rank: 0,
    acceptableForReview: false,
    description: 'No evidence sufficient to review.',
  },
  UNSUPPORTED: {
    rank: 0,
    acceptableForReview: false,
    description: 'Evidence class is explicitly prohibited from becoming semantic authority.',
  },
};

const defaultContext = (field: string, eventType: string | null = 'WhseTransfers'): ProviderContextRequirement => ({
  provider: 'amazon_inventory_ledger',
  reportType: AMAZON_LEDGER_DETAIL_REPORT_TYPE,
  eventType,
  field,
  marketplaceIds: ['*'],
  artifactVersion: AMAZON_REPORTS_API_ARTIFACT_VERSION,
});

const sharedAuthorityClasses: AuthorityClass[] = [
  'AUTHORITATIVE_PROVIDER_DOCUMENTATION',
  'AUTHORITATIVE_PROVIDER_SCHEMA',
  'APPROVED_CONTROLLED_PROVIDER_EVIDENCE',
  'APPROVED_REDACTED_FIXTURE',
];

const sharedReviewRequirements = [
  'The reviewer must identify the exact semantic proposition and artifact locator.',
  'The reviewer must confirm authority, provider/report/event context, marketplace, and artifact version.',
  'The reviewer must record what the artifact does not prove and confirm reproducibility and provenance.',
  'The reviewer must confirm that P3 remains fail-closed and that P6 does not mutate P5.',
];

function target(
  id: string,
  semanticTarget: TransferSemanticTarget,
  field: string,
  proposition: string,
  minimumEvidenceRequired: string,
  negativeConditions: string[],
  eventType: string | null = 'WhseTransfers',
): AuthorityAcquisitionTarget {
  return {
    id,
    version: TRANSFER_AUTHORITY_ACQUISITION_PLAN_VERSION,
    semanticTarget,
    currentStatus: 'UNRESOLVED_PROVIDER_SEMANTICS',
    proposition,
    minimumEvidenceRequired,
    acceptableAuthorityClasses: sharedAuthorityClasses,
    providerContext: defaultContext(field, eventType),
    negativeConditions,
    reviewRequirements: sharedReviewRequirements,
    resultingAllowedUpgrade: ['APPROVED_EVIDENCE', 'AUTHORITATIVELY_PROVEN'],
  };
}

/**
 * P6 targets are deliberately independent. Proving one proposition cannot
 * prove identity, route, quantities, timestamps, lifecycle, or pairing for
 * any other target.
 */
export const TRANSFER_AUTHORITY_ACQUISITION_TARGETS: readonly AuthorityAcquisitionTarget[] = [
  target(
    'transfer-identity',
    'transfer_identity',
    'Reference ID',
    'In the stated Ledger report and event context, Reference ID identifies one Transfer business identity and its uniqueness/scope rules.',
    'An official field definition or schema explicitly tying Reference ID to a Transfer identifier in the same report/event context, or separately approved controlled evidence with matching provenance and review.',
    [
      'Reference ID does not prove Transfer identity merely because it is populated or unique.',
      'Reference ID does not prove source, destination, sent quantity, received quantity, lifecycle, claimability, or recovery.',
    ],
  ),
  target(
    'source-location',
    'source_location',
    'Fulfillment Center',
    'In the stated Ledger report and event context, Fulfillment Center identifies the source location role.',
    'An official definition that names the field as a source/origin in the exact event context, or approved controlled evidence linking the role to an authoritative provider artifact.',
    [
      'Fulfillment Center is not a source merely because it appears on a movement row.',
      'One location value does not prove a destination or a completed transfer.',
    ],
  ),
  target(
    'destination-location',
    'destination_location',
    'Fulfillment Center',
    'In the stated Ledger report and event context, a provider field identifies the destination location role.',
    'An official definition that names the destination field/role in the exact event context, or approved controlled evidence linked to authoritative provider documentation.',
    [
      'Fulfillment Center is not a destination merely because it appears later or in a second row.',
      'Chronology and field-name similarity do not establish a destination role.',
    ],
  ),
  target(
    'sent-quantity',
    'quantity_sent',
    'Quantity',
    'In the stated Ledger report and event context, Quantity (including sign) represents units dispatched from the source.',
    'An official definition of Quantity sign and event-state semantics in the exact context, or approved controlled evidence tied to such a definition.',
    [
      'Quantity sign alone does not establish dispatched units.',
      'Quantity does not prove received units, lifecycle completion, value, or loss.',
    ],
  ),
  target(
    'received-quantity',
    'quantity_received',
    'Quantity',
    'In the stated Ledger report and event context, Quantity (including sign) represents units received at the destination.',
    'An official definition of Quantity sign and receipt-state semantics in the exact context, or approved controlled evidence tied to such a definition.',
    [
      'Positive or negative Quantity alone does not establish received units.',
      'Quantity does not prove dispatch, lifecycle completion, value, or loss.',
    ],
  ),
  target(
    'dispatch-timestamp',
    'dispatch_timestamp',
    'Date and Time',
    'In the stated Ledger report and event context, Date and Time represents the dispatch timestamp.',
    'An official field definition that assigns Date/Date and Time the dispatch role in the exact event context, or approved controlled evidence tied to that artifact.',
    [
      'An earlier timestamp does not establish dispatch.',
      'A timestamp does not prove receipt, lifecycle completion, identity, or route.',
    ],
  ),
  target(
    'receipt-timestamp',
    'receipt_timestamp',
    'Date and Time',
    'In the stated Ledger report and event context, Date and Time represents the receipt timestamp.',
    'An official field definition that assigns Date/Date and Time the receipt role in the exact event context, or approved controlled evidence tied to that artifact.',
    [
      'A later timestamp does not establish receipt.',
      'A timestamp does not prove dispatch, lifecycle completion, identity, or route.',
    ],
  ),
  target(
    'lifecycle-status',
    'transfer_lifecycle',
    '$lifecycle',
    'The provider exposes an explicit lifecycle state corresponding to dispatched, in-transit, received, closed, or an exactly defined equivalent.',
    'An official lifecycle enum/state definition tied to the exact report/event context, or approved controlled evidence linked to an authoritative specification.',
    [
      'Margin must not manufacture lifecycle state from chronology, count, sign, or labels.',
      'Lifecycle evidence does not by itself prove identity, route, quantity role, claimability, or recovery.',
    ],
    null,
  ),
  target(
    'whse-transfers-meaning',
    'transfer_lifecycle',
    'Event Type',
    'WhseTransfers has an official provider-defined meaning and lifecycle relation in the exact Ledger context.',
    'An official provider definition for WhseTransfers in the exact report/version/marketplace context, or approved controlled evidence directly anchored to one.',
    [
      'WhseTransfers alone is not a completed Transfer.',
      'WhseTransfers alone does not prove sent/received quantities, route, pairing, claimability, or recovery.',
    ],
  ),
  target(
    'counterpart-pairing-semantics',
    'counterpart_identity',
    '$counterpart_pair',
    'The provider defines a stable relationship that permits two scoped Ledger records to be paired as one Transfer counterpart set.',
    'An official pairing/identity rule for the exact report/event context, or approved controlled evidence with authoritative linkage and replay-safe fingerprint evidence.',
    [
      'Pairability does not prove lifecycle completion.',
      'Matching Reference ID, FNSKU, chronology, or Quantity alone does not prove a counterpart relationship.',
    ],
  ),
];

export const P6_FUTURE_CONTROLLED_PROVIDER_TEST_PLAN = {
  status: 'DESIGN_ONLY_DO_NOT_EXECUTE' as const,
  requiredAuthorization: 'Explicit user authorization after P6 review and a separately reviewed P5 catalog update path.',
  executionMode: 'OBSERVATION_ONLY_REVERSIBLE' as const,
  requiredControls: [
    'Narrow tenant, user, store, and marketplace scope.',
    'Transfer feature remains OFF, rollout 0, and claim_capable false.',
    'No claims, recoveries, economic computation, detector invocation, or activation.',
    'Complete raw provenance, source-run identity, provider fingerprint, and raw payload hash.',
    'Pagination and history-coverage evidence.',
    'Replay/idempotency validation and cross-tenant, cross-store, and cross-marketplace isolation.',
    'Independent audit log and automatic fail-closed behavior on missing or ambiguous evidence.',
  ],
} as const;

function hasExpectedContext(record: EvidenceAcquisitionRecord, targetDefinition: AuthorityAcquisitionTarget): boolean {
  const context = targetDefinition.providerContext;
  return record.provider === context.provider
    && record.reportType === context.reportType
    && record.field.toLowerCase() === context.field.toLowerCase()
    && (context.eventType === null || (record.eventType || '').toUpperCase() === context.eventType.toUpperCase())
    && (context.marketplaceIds.includes('*') || context.marketplaceIds.includes(record.marketplaceId))
    && record.scope.marketplaceId === record.marketplaceId
    && record.artifactVersion === context.artifactVersion;
}

function hasCompleteReview(review: AuthorityReview, status: ReviewerStatus): boolean {
  return status === 'APPROVED'
    && Boolean(review.reviewerId)
    && Boolean(review.reviewedAt)
    && review.exactPropositionAnswered
    && review.exactArtifactAnswered
    && review.authorityAnswered
    && review.providerContextAnswered
    && review.marketplaceAnswered
    && review.artifactVersionAnswered
    && review.negativeBoundaryAnswered
    && review.reproducibilityAnswered
    && review.provenanceAnswered
    && review.independentAuditAnswered
    && review.proposedUpgradeAnswered
    && review.p3FailClosedAnswered;
}

function unresolved(
  targetDefinition: AuthorityAcquisitionTarget,
  record: EvidenceAcquisitionRecord | null,
  state: AuthorityAcquisitionState,
  ...reasonCodes: string[]
): AuthorityAcquisitionResolution {
  return {
    planVersion: TRANSFER_AUTHORITY_ACQUISITION_PLAN_VERSION,
    target: targetDefinition,
    record,
    state,
    reasonCodes,
    proposedCatalogUpgrade: null,
    catalogMutationAuthorized: false,
    p3OverrideAuthorized: false,
    claimCapable: false,
    recoveryDetected: false,
    economicValue: null,
    detectorResult: null,
  };
}

/**
 * Validates a prospective acquisition record. A successful record is only
 * ready for a later, separately authorized P5 catalog review. P6 cannot write
 * the catalog and cannot change P3 provider semantics.
 */
export function reviewAuthorityAcquisitionRecord(
  targetDefinition: AuthorityAcquisitionTarget,
  record: EvidenceAcquisitionRecord | null,
): AuthorityAcquisitionResolution {
  if (!record) return unresolved(targetDefinition, null, 'EVIDENCE_REQUIRED', 'MISSING_EVIDENCE_RECORD');
  if (record.targetId !== targetDefinition.id
    || record.proposedSemanticTarget !== targetDefinition.semanticTarget
    || record.proposition !== targetDefinition.proposition) {
    return unresolved(targetDefinition, record, 'UNRESOLVED', 'TARGET_MISMATCH');
  }
  if (record.supersededBy) return unresolved(targetDefinition, record, 'SUPERSEDED', 'EVIDENCE_SUPERSEDED');
  if (record.invalidatedAt) return unresolved(targetDefinition, record, 'INVALIDATED', 'EVIDENCE_INVALIDATED');
  if (!AUTHORITY_HIERARCHY[record.authorityClass].acceptableForReview
    || !targetDefinition.acceptableAuthorityClasses.includes(record.authorityClass)) {
    return unresolved(targetDefinition, record, 'UNSUPPORTED', 'UNSUPPORTED_AUTHORITY_CLASS');
  }
  if (!hasExpectedContext(record, targetDefinition)) {
    return unresolved(targetDefinition, record, 'UNRESOLVED', 'CONTEXT_OR_SCOPE_MISMATCH');
  }
  if (!record.provenanceHash || !/^[a-f0-9]{64}$/i.test(record.provenanceHash)) {
    return unresolved(targetDefinition, record, 'UNRESOLVED', 'MISSING_OR_INVALID_PROVENANCE');
  }
  if (!record.evidenceReference || !record.evidenceExcerptOrLocator || !record.sourceReference || !record.retrievedAt) {
    return unresolved(targetDefinition, record, 'UNRESOLVED', 'INCOMPLETE_EVIDENCE_RECORD');
  }
  if (record.evidenceAssessment === 'AMBIGUOUS') {
    return unresolved(targetDefinition, record, 'UNRESOLVED', 'AMBIGUOUS_EVIDENCE');
  }
  if (record.reviewerStatus === 'REJECTED') return unresolved(targetDefinition, record, 'REJECTED', 'REVIEW_REJECTED');
  if (!hasCompleteReview(record.review, record.reviewerStatus)) {
    return unresolved(targetDefinition, record, 'UNDER_REVIEW', 'INCOMPLETE_REVIEW');
  }
  if (!record.proposedCatalogUpgrade || !targetDefinition.resultingAllowedUpgrade.includes(record.proposedCatalogUpgrade)) {
    return unresolved(targetDefinition, record, 'UNRESOLVED', 'UNAPPROVED_PROPOSED_UPGRADE');
  }
  if (record.proposedCatalogUpgrade === 'AUTHORITATIVELY_PROVEN'
    && record.authorityClass !== 'AUTHORITATIVE_PROVIDER_DOCUMENTATION'
    && record.authorityClass !== 'AUTHORITATIVE_PROVIDER_SCHEMA') {
    return unresolved(targetDefinition, record, 'UNRESOLVED', 'INSUFFICIENT_AUTHORITY_FOR_PROPOSED_UPGRADE');
  }
  if (record.negativeConditions.length === 0 || !targetDefinition.negativeConditions.every((rule) => record.negativeConditions.includes(rule))) {
    return unresolved(targetDefinition, record, 'UNRESOLVED', 'NEGATIVE_CONDITIONS_INCOMPLETE');
  }

  return {
    planVersion: TRANSFER_AUTHORITY_ACQUISITION_PLAN_VERSION,
    target: targetDefinition,
    record,
    state: 'READY_FOR_SEPARATE_CATALOG_REVIEW',
    reasonCodes: ['EVIDENCE_REQUIRES_SEPARATE_P5_CATALOG_REVIEW'],
    proposedCatalogUpgrade: record.proposedCatalogUpgrade,
    catalogMutationAuthorized: false,
    p3OverrideAuthorized: false,
    claimCapable: false,
    recoveryDetected: false,
    economicValue: null,
    detectorResult: null,
  };
}

/** P6 records remain planning evidence and can never yield an executable detector result. */
export function authorityAcquisitionDetectorResult(_: AuthorityAcquisitionResolution): null {
  return null;
}

/** Exported solely to make the P5/P6 version boundary explicit to review tooling. */
export const P6_DEPENDENCY_VERSIONS = {
  p5CatalogVersion: TRANSFER_PROVIDER_SEMANTICS_CATALOG_VERSION,
  p6PlanVersion: TRANSFER_AUTHORITY_ACQUISITION_PLAN_VERSION,
  requiredP5Status: 'UNRESOLVED_PROVIDER_SEMANTICS' as ProviderSemanticsCatalogStatus,
} as const;
