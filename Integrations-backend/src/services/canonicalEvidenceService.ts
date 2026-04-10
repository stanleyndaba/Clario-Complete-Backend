import { supabaseAdmin } from '../database/supabaseClient';

export interface CanonicalEvidenceTruth {
  disputeCaseId: string | null;
  linkedDocuments: any[];
  linkedDocumentIds: string[];
  linkedDocumentCount: number;
  requiredRequirements: string[];
  missingRequirements: string[];
  blockReasons: string[];
  proofSnapshotPresent: boolean;
  isEvidenceComplete: boolean;
}

function normalize(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

function parseJsonObject(value: any): Record<string, any> {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return {};
    }
  }
  return typeof value === 'object' ? value : {};
}

function getEvidenceItems(document: any): any[] {
  const extract = parseJsonObject(document?.parsed_metadata) || parseJsonObject(document?.extracted) || {};
  return Array.isArray(extract?.items) ? extract.items : [];
}

function hasUnitCostEvidence(documents: any[]) {
  return documents.some((document) => {
    const items = getEvidenceItems(document);
    return items.some((item) => {
      const unitCost = Number(item?.unit_cost ?? item?.unitPrice ?? item?.cost);
      return Number.isFinite(unitCost) && unitCost > 0;
    });
  });
}

function dedupeDocuments(documents: any[]): any[] {
  const seen = new Set<string>();
  const deduped: any[] = [];

  for (const document of Array.isArray(documents) ? documents : []) {
    const id = String(document?.id || '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    deduped.push(document);
  }

  return deduped;
}

function extractEvidenceRequirements(disputeCase: any) {
  const evidenceAttachments = parseJsonObject(disputeCase?.evidence_attachments);
  const decisionIntelligence = parseJsonObject(evidenceAttachments?.decision_intelligence);
  const proofSnapshot = parseJsonObject(decisionIntelligence?.proof_snapshot);
  const rawRequirements = Array.isArray(proofSnapshot?.requiredRequirements)
    ? proofSnapshot.requiredRequirements
    : [];

  const requiredRequirements = rawRequirements
    .map((requirement: unknown) => String(requirement || '').trim())
    .filter((requirement) =>
      requirement === 'unit_cost_proof' ||
      requirement.startsWith('document_type:') ||
      requirement.startsWith('document_family:')
    );

  return {
    proofSnapshotPresent: rawRequirements.length > 0,
    requiredRequirements
  };
}

export function evaluateCanonicalEvidenceTruth(params: {
  disputeCase: any;
  linkedDocuments: any[];
}): CanonicalEvidenceTruth {
  const disputeCase = params.disputeCase || {};
  const linkedDocuments = dedupeDocuments(params.linkedDocuments || []);
  const linkedDocumentIds = linkedDocuments
    .map((document) => String(document?.id || '').trim())
    .filter(Boolean);
  const linkedDocumentCount = linkedDocumentIds.length;
  const docTypes = new Set(
    linkedDocuments
      .map((document) => normalize(document?.doc_type))
      .filter(Boolean)
  );
  const { proofSnapshotPresent, requiredRequirements } = extractEvidenceRequirements(disputeCase);
  const missingRequirements: string[] = [];
  const blockReasons: string[] = [];

  if (!proofSnapshotPresent) {
    missingRequirements.push('proof_snapshot');
    blockReasons.push('missing_proof_snapshot');
  }

  if (linkedDocumentCount === 0) {
    missingRequirements.push('supporting_document');
    blockReasons.push('missing_evidence_links');
  }

  for (const requirement of requiredRequirements) {
    if (requirement.startsWith('document_type:')) {
      const requiredType = normalize(requirement.split(':')[1]);
      if (!requiredType || !docTypes.has(requiredType)) {
        missingRequirements.push(`document_type:${requiredType}`);
        blockReasons.push(`missing_required_document_type:${requiredType}`);
      }
      continue;
    }

    if (requirement.startsWith('document_family:')) {
      const family = requirement.split(':')[1] || '';
      const familyTypes = family
        .split('|')
        .map((value) => normalize(value))
        .filter(Boolean);

      if (!familyTypes.some((docType) => docTypes.has(docType))) {
        missingRequirements.push(`document_family:${family}`);
        blockReasons.push(`missing_required_document_family:${family}`);
      }
      continue;
    }

    if (requirement === 'unit_cost_proof' && !hasUnitCostEvidence(linkedDocuments)) {
      missingRequirements.push('unit_cost_proof');
      blockReasons.push('missing_unit_cost_proof');
    }
  }

  return {
    disputeCaseId: String(disputeCase?.id || '').trim() || null,
    linkedDocuments,
    linkedDocumentIds,
    linkedDocumentCount,
    requiredRequirements,
    missingRequirements: Array.from(new Set(missingRequirements)),
    blockReasons: Array.from(new Set(blockReasons)),
    proofSnapshotPresent,
    isEvidenceComplete: missingRequirements.length === 0
  };
}

export function isEvidenceComplete(disputeCase: any, linkedDocuments: any[] = []): boolean {
  return evaluateCanonicalEvidenceTruth({ disputeCase, linkedDocuments }).isEvidenceComplete;
}

export async function loadCanonicalEvidenceTruth(
  caseId: string,
  tenantId: string,
  disputeCase?: any
): Promise<CanonicalEvidenceTruth> {
  let resolvedCase = disputeCase;

  if (!resolvedCase || typeof resolvedCase !== 'object' || !('evidence_attachments' in resolvedCase)) {
    const { data: fetchedCase, error: caseError } = await supabaseAdmin
      .from('dispute_cases')
      .select('*')
      .eq('id', caseId)
      .eq('tenant_id', tenantId)
      .single();

    if (caseError || !fetchedCase) {
      throw new Error('Dispute case not found');
    }

    resolvedCase = fetchedCase;
  }

  const { data: evidenceLinks, error: evidenceError } = await supabaseAdmin
    .from('dispute_evidence_links')
    .select('evidence_document_id, evidence_documents(id, filename, doc_type, raw_text, extracted, parsed_metadata, parser_status, created_at, ingested_at, source_provider, parser_version, match_confidence, metadata)')
    .eq('tenant_id', tenantId)
    .eq('dispute_case_id', caseId);

  if (evidenceError) {
    throw new Error(`Failed to load canonical evidence links: ${evidenceError.message}`);
  }

  const linkedDocuments = (evidenceLinks || [])
    .map((link: any) => {
      const document = Array.isArray(link?.evidence_documents)
        ? link.evidence_documents[0]
        : link?.evidence_documents;
      return document || null;
    })
    .filter(Boolean);

  return evaluateCanonicalEvidenceTruth({
    disputeCase: resolvedCase,
    linkedDocuments
  });
}
