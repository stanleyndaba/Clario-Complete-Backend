/**
 * Proof Packet Worker
 * Bundles evidence for a dispute and creates a proof packet.
 * 
 * MULTI-TENANT: Uses tenant-scoped queries for data isolation
 */

import proofPacketService, { ProofPacketInput } from '../services/proofPacketService';
import { supabase } from '../database/supabaseClient';
import { createTenantScopedQueryById } from '../database/tenantScopedClient';
import logger from '../utils/logger';

/**
 * Skeleton worker that bundles evidence for a dispute and creates a proof packet.
 * MULTI-TENANT: Uses tenant-scoped queries for data isolation
 * Replace the packetUrl creation with real PDF generation + storage upload.
 */
export async function generateProofPacketForDispute(
  disputeId: string,
  sellerId: string,
  tenantId: string // MULTI-TENANT: Required for data isolation
): Promise<string | null> {
  try {
    // MULTI-TENANT: Load dispute basics with tenant-scoped query
    const disputeQuery = createTenantScopedQueryById(tenantId, 'dispute_cases');
    const { data: dispute } = await disputeQuery
      .select('id, resolution_amount, resolution_date, expected_amount, expected_paid_date, status')
      .eq('id', disputeId)
      .eq('seller_id', sellerId)
      .single();

    // MULTI-TENANT: Load evidence links with tenant-scoped query
    const linksQuery = createTenantScopedQueryById(tenantId, 'dispute_evidence_links');
    const { data: links } = await linksQuery
      .select('evidence_document_id')
      .eq('dispute_case_id', disputeId);

    const evidenceDocId = links && links[0]?.evidence_document_id;

    // TODO: Build a real PDF and upload to storage; for now, stub URL
    const packetUrl = `https://storage.example.com/proof-packets/${disputeId}.pdf`;

    const input: ProofPacketInput = {
      sellerId,
      disputeId,
      packetUrl,
      summary: {
        amountRecovered: dispute?.resolution_amount,
        paidDate: dispute?.resolution_date,
        expectedAmount: (dispute as any)?.expected_amount,
        expectedPaidDate: (dispute as any)?.expected_paid_date,
        evidenceDocumentId: evidenceDocId
      }
    };

    const id = await proofPacketService.createPacket(input);
    return id;
  } catch (error) {
    logger.error('generateProofPacketForDispute failed', { error, disputeId, sellerId, tenantId });
    return null;
  }
}


