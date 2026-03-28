import { supabase, supabaseAdmin } from '../database/supabaseClient';
import logger from '../utils/logger';

export interface ProofPacketInput {
  tenantId?: string;
  sellerId: string;
  disputeId: string;
  summary: {
    packetKind?: 'filing_ready' | 'smart_filing' | 'manual_review' | 'recovery_review';
    filingRecommendation?: 'filing_ready' | 'smart_filing' | 'ineligible';
    missingRequirements?: string[];
    riskFlags?: string[];
    sku?: string;
    asin?: string;
    lostUnits?: number;
    amountRecovered?: number;
    paidDate?: string;
    expectedAmount?: number;
    expectedPaidDate?: string;
    confidence?: number;
    evidenceDocumentId?: string;
  };
  packetUrl: string; // pre-generated PDF URL (generation handled elsewhere or by a worker)
}

export const proofPacketService = {
  async createPacket(input: ProofPacketInput): Promise<string> {
    const client = supabaseAdmin || supabase;
    const timestamp = new Date().toISOString();
    const summary = {
      generated_at: timestamp,
      ...input.summary
    };

    let existingQuery = client
      .from('proof_packets')
      .select('id')
      .eq('dispute_case_id', input.disputeId);

    if (input.tenantId) {
      existingQuery = existingQuery.eq('tenant_id', input.tenantId);
    }

    const { data: existingPacket, error: existingError } = await existingQuery
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingError) {
      throw new Error(`Failed to lookup proof packet: ${existingError.message}`);
    }

    if (existingPacket?.id) {
      const { error: updateError } = await client
        .from('proof_packets')
        .update({
          seller_id: input.sellerId,
          packet_url: input.packetUrl,
          summary
        })
        .eq('id', existingPacket.id);

      if (updateError) {
        throw new Error(`Failed to update proof packet: ${updateError.message}`);
      }

      return existingPacket.id as string;
    }

    const insertPayload: Record<string, any> = {
      seller_id: input.sellerId,
      dispute_case_id: input.disputeId,
      packet_url: input.packetUrl,
      summary
    };

    if (input.tenantId) {
      insertPayload.tenant_id = input.tenantId;
    }

    const { data, error } = await client
      .from('proof_packets')
      .insert(insertPayload)
      .select('id')
      .single();
    if (error) throw new Error(`Failed to create proof packet: ${error.message}`);
    logger.info('[PROOF PACKET] Upserted proof packet', {
      disputeId: input.disputeId,
      tenantId: input.tenantId || null,
      packetKind: input.summary.packetKind || 'smart_filing'
    });
    return data.id as string;
  }
};

export default proofPacketService;


