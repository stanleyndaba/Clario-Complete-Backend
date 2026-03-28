import { extractKeyFieldsFromText } from '../utils/pdfExtractor';

export type IngestionStrategy = 'FULL' | 'DEGRADED' | 'REJECTED';

export interface IngestionExplanation {
  reason: string;
  preserved_fields: string[];
  missing_fields: string[];
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return [...new Set(values
    .map(value => (typeof value === 'string' ? value.trim() : ''))
    .filter(Boolean))];
}

function collectMatches(text: string, regex: RegExp): string[] {
  const matches: string[] = [];
  const safeRegex = new RegExp(regex.source, regex.flags);
  let match: RegExpExecArray | null;

  while ((match = safeRegex.exec(text)) !== null) {
    matches.push((match[1] || match[0] || '').trim());
  }

  return uniqueStrings(matches);
}

export function createIngestionExplanation(
  reason: string,
  preservedFields: Array<string | null | undefined>,
  missingFields: Array<string | null | undefined> = []
): IngestionExplanation {
  return {
    reason,
    preserved_fields: uniqueStrings(preservedFields),
    missing_fields: uniqueStrings(missingFields)
  };
}

export function extractEvidenceLinkHints(
  fragments: Array<string | null | undefined>,
  extraHints: Record<string, any> = {}
): Record<string, any> {
  const cleanFragments = uniqueStrings(fragments);
  const combinedText = cleanFragments.join('\n');
  const baseHints = extractKeyFieldsFromText(combinedText);

  const purchaseOrderNumbers = collectMatches(
    combinedText,
    /\b(?:PO|P\.O\.|PURCHASE ORDER)[\s:#-]*([A-Z0-9-]{4,})\b/gi
  );
  const shipmentIds = collectMatches(
    combinedText,
    /\b(FBA[0-9A-Z]{6,16}|SHIP(?:MENT)?[-:# ]*[0-9A-Z-]{4,})\b/gi
  );
  const reimbursementReferences = collectMatches(
    combinedText,
    /\b(?:REIMBURSEMENT|CASE|REFERENCE|REF)[\s:#-]*([A-Z0-9-]{5,})\b/gi
  );
  const supplierNames = collectMatches(
    combinedText,
    /\b(?:FROM|SUPPLIER|VENDOR)[:\s]+([A-Z0-9&.,' -]{3,})/gi
  );

  return {
    order_ids: uniqueStrings([...(baseHints.orderIds || []), ...(extraHints.order_ids || [])]),
    asins: uniqueStrings([...(baseHints.asins || []), ...(extraHints.asins || [])]).map(value => value.toUpperCase()),
    skus: uniqueStrings([...(baseHints.skus || []), ...(extraHints.skus || [])]).map(value => value.toUpperCase()),
    fnskus: uniqueStrings([...(baseHints.fnskus || []), ...(extraHints.fnskus || [])]).map(value => value.toUpperCase()),
    tracking_numbers: uniqueStrings([...(baseHints.trackingNumbers || []), ...(extraHints.tracking_numbers || [])]).map(value => value.toUpperCase()),
    amounts: uniqueStrings([...(baseHints.amounts || []), ...(extraHints.amounts || [])]),
    invoice_numbers: uniqueStrings([...(baseHints.invoiceNumbers || []), ...(extraHints.invoice_numbers || [])]).map(value => value.toUpperCase()),
    dates: uniqueStrings([...(baseHints.dates || []), ...(extraHints.dates || [])]),
    purchase_order_numbers: uniqueStrings([...purchaseOrderNumbers, ...(extraHints.purchase_order_numbers || [])]).map(value => value.toUpperCase()),
    shipment_ids: uniqueStrings([...shipmentIds, ...(extraHints.shipment_ids || [])]).map(value => value.toUpperCase()),
    reimbursement_references: uniqueStrings([...reimbursementReferences, ...(extraHints.reimbursement_references || [])]).map(value => value.toUpperCase()),
    supplier_names: uniqueStrings([...supplierNames, ...(extraHints.supplier_names || [])]),
    claim_link_fragments: cleanFragments.slice(0, 12)
  };
}

export function buildIngestionMetadata(
  baseMetadata: Record<string, any> | null | undefined,
  strategy: IngestionStrategy,
  explanation: IngestionExplanation,
  extraMetadata: Record<string, any> = {}
): Record<string, any> {
  return {
    ...(baseMetadata || {}),
    ...extraMetadata,
    ingestion_strategy: strategy,
    ingestion_explanation: explanation
  };
}

export function buildParsedMetadataForIngestion(
  hints: Record<string, any>,
  strategy: IngestionStrategy,
  explanation: IngestionExplanation
): Record<string, any> {
  return {
    ...hints,
    ingestion_strategy: strategy,
    ingestion_explanation: explanation,
    metadata_only: strategy !== 'FULL',
    parsed_from: strategy === 'FULL' ? 'ingestion_with_file' : 'ingestion_metadata'
  };
}
