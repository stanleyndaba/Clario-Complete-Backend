import { supabase } from '../database/supabaseClient';
import logger from '../utils/logger';

export interface ProofPacketInput {
  sellerId: string;
  disputeId: string;
  summary: {
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
    const { data, error } = await supabase
      .from('proof_packets')
      .insert({ seller_id: input.sellerId, dispute_case_id: input.disputeId, packet_url: input.packetUrl, summary: input.summary })
      .select('id')
      .single();
    if (error) throw new Error(`Failed to create proof packet: ${error.message}`);
    return data.id as string;
  }
};

export default proofPacketService;


