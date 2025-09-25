import { supabase } from '../database/supabaseClient';
import logger from '../utils/logger';
import axios from 'axios';

export interface AutoClaimConfirmation {
  disputeId: string;
  amountRecovered: number;
  paidDate: string;
  proofDocUrl?: string;
}

export const payoutConfirmationService = {
  async confirmPayout(disputeId: string, userId: string): Promise<AutoClaimConfirmation> {
    // Try SP-API Financial Events first; fallback to DB values
    try {
      const spKey = process.env['SP_API_KEY'];
      const spSecret = process.env['SP_API_SECRET'];
      const region = process.env['SP_API_REGION'] || 'na';
      if (spKey && spSecret) {
        // Placeholder: call your SP-API gateway/service that wraps listFinancialEvents
        const spApiUrl = process.env['SP_API_EVENTS_URL'];
        if (spApiUrl) {
          const resp = await axios.get(`${spApiUrl}/financial-events`, {
            params: { userId, disputeId },
            headers: { 'X-Api-Key': spKey, 'X-Api-Secret': spSecret, 'X-Region': region },
            timeout: 15000
          });
          const events = resp.data?.events || [];
          const matched = events.find((e: any) => e.disputeId === disputeId || e.claimId === disputeId || e.metadata?.disputeId === disputeId);
          if (matched) {
            const amount = Number(matched.amount) || 0;
            const paid = matched.paidDate || matched.postedDate || new Date().toISOString();
            // persist
            await supabase
              .from('dispute_cases')
              .update({ status: 'approved', resolution_amount: amount, resolution_date: paid })
              .eq('id', disputeId)
              .eq('seller_id', userId);
            return { disputeId, amountRecovered: amount, paidDate: paid };
          }
        }
      }
    } catch (err) {
      logger.warn('SP-API financial events unavailable, using DB fallback', { err: err instanceof Error ? err.message : String(err) });
    }

    // Fallback: DB values
    const { data, error } = await supabase
      .from('dispute_cases')
      .select('resolution_amount, resolution_date')
      .eq('id', disputeId)
      .eq('seller_id', userId)
      .single();
    if (error || !data) throw new Error('Dispute not found');
    return {
      disputeId,
      amountRecovered: data.resolution_amount || 0,
      paidDate: data.resolution_date || new Date().toISOString()
    };
  }
};

export default payoutConfirmationService;
import { supabase } from '../database/supabaseClient';
import logger from '../utils/logger';

export interface FinancialEvent {
  seller_id: string;
  event_type: 'fee' | 'reimbursement' | 'return' | 'shipment';
  amount: number;
  currency: string;
  raw_payload: any;
  amazon_event_id?: string;
  amazon_order_id?: string;
  amazon_sku?: string;
  event_date?: Date;
}

export interface FinancialEventRecord {
  id: string;
  seller_id: string;
  event_type: 'fee' | 'reimbursement' | 'return' | 'shipment';
  amount: number;
  currency: string;
  raw_payload: any;
  amazon_event_id?: string;
  amazon_order_id?: string;
  amazon_sku?: string;
  event_date?: string;
  created_at: string;
  updated_at: string;
}

export class FinancialEventsService {
  /**
   * Ingest and archive a financial event
   */
  async ingestEvent(event: FinancialEvent): Promise<FinancialEventRecord> {
    try {
      logger.info('Ingesting financial event', {
        seller_id: event.seller_id,
        event_type: event.event_type,
        amount: event.amount,
        amazon_event_id: event.amazon_event_id
      });

      const { data, error } = await supabase
        .from('financial_events')
        .insert({
          seller_id: event.seller_id,
          event_type: event.event_type,
          amount: event.amount,
          currency: event.currency,
          raw_payload: event.raw_payload,
          amazon_event_id: event.amazon_event_id,
          amazon_order_id: event.amazon_order_id,
          amazon_sku: event.amazon_sku,
          event_date: event.event_date?.toISOString()
        })
        .select()
        .single();

      if (error) {
        logger.error('Error ingesting financial event', { error, event });
        throw new Error(`Failed to ingest financial event: ${error.message}`);
      }

      logger.info('Financial event ingested successfully', {
        event_id: data.id,
        seller_id: event.seller_id,
        event_type: event.event_type
      });

      return data as FinancialEventRecord;
    } catch (error) {
      logger.error('Error in ingestEvent', { error, event });
      throw error;
    }
  }

  /**
   * Ingest multiple financial events in batch
   */
  async ingestEvents(events: FinancialEvent[]): Promise<FinancialEventRecord[]> {
    try {
      logger.info('Ingesting batch of financial events', {
        count: events.length,
        seller_id: events[0]?.seller_id
      });

      const { data, error } = await supabase
        .from('financial_events')
        .insert(
          events.map(event => ({
            seller_id: event.seller_id,
            event_type: event.event_type,
            amount: event.amount,
            currency: event.currency,
            raw_payload: event.raw_payload,
            amazon_event_id: event.amazon_event_id,
            amazon_order_id: event.amazon_order_id,
            amazon_sku: event.amazon_sku,
            event_date: event.event_date?.toISOString()
          }))
        )
        .select();

      if (error) {
        logger.error('Error ingesting batch of financial events', { error });
        throw new Error(`Failed to ingest financial events: ${error.message}`);
      }

      logger.info('Batch of financial events ingested successfully', {
        count: data?.length || 0,
        seller_id: events[0]?.seller_id
      });

      return data as FinancialEventRecord[];
    } catch (error) {
      logger.error('Error in ingestEvents', { error });
      throw error;
    }
  }

  /**
   * Get financial events for a seller
   */
  async getEventsBySeller(
    sellerId: string,
    eventType?: string,
    limit: number = 100,
    offset: number = 0
  ): Promise<FinancialEventRecord[]> {
    try {
      let query = supabase
        .from('financial_events')
        .select('*')
        .eq('seller_id', sellerId)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (eventType) {
        query = query.eq('event_type', eventType);
      }

      const { data, error } = await query;

      if (error) {
        logger.error('Error fetching financial events', { error, sellerId });
        throw new Error(`Failed to fetch financial events: ${error.message}`);
      }

      return data as FinancialEventRecord[];
    } catch (error) {
      logger.error('Error in getEventsBySeller', { error, sellerId });
      throw error;
    }
  }

  /**
   * Get financial events by date range
   */
  async getEventsByDateRange(
    sellerId: string,
    startDate: Date,
    endDate: Date,
    eventType?: string
  ): Promise<FinancialEventRecord[]> {
    try {
      let query = supabase
        .from('financial_events')
        .select('*')
        .eq('seller_id', sellerId)
        .gte('event_date', startDate.toISOString())
        .lte('event_date', endDate.toISOString())
        .order('event_date', { ascending: false });

      if (eventType) {
        query = query.eq('event_type', eventType);
      }

      const { data, error } = await query;

      if (error) {
        logger.error('Error fetching financial events by date range', { error, sellerId });
        throw new Error(`Failed to fetch financial events: ${error.message}`);
      }

      return data as FinancialEventRecord[];
    } catch (error) {
      logger.error('Error in getEventsByDateRange', { error, sellerId });
      throw error;
    }
  }

  /**
   * Get event statistics for a seller
   */
  async getEventStatistics(sellerId: string): Promise<{
    total_events: number;
    total_amount: number;
    by_type: Record<string, { count: number; amount: number }>;
  }> {
    try {
      const { data, error } = await supabase
        .from('financial_events')
        .select('event_type, amount')
        .eq('seller_id', sellerId);

      if (error) {
        logger.error('Error fetching event statistics', { error, sellerId });
        throw new Error(`Failed to fetch event statistics: ${error.message}`);
      }

      const events = data as { event_type: string; amount: number }[];
      const by_type: Record<string, { count: number; amount: number }> = {};
      let total_amount = 0;

      events.forEach(event => {
        if (!by_type[event.event_type]) {
          by_type[event.event_type] = { count: 0, amount: 0 };
        }
        by_type[event.event_type]!.count++;
        by_type[event.event_type]!.amount += event.amount;
        total_amount += event.amount;
      });

      return {
        total_events: events.length,
        total_amount,
        by_type
      };
    } catch (error) {
      logger.error('Error in getEventStatistics', { error, sellerId });
      throw error;
    }
  }

  /**
   * Archive raw event payload to S3 (placeholder for future implementation)
   */
  async archiveToS3(event: FinancialEvent): Promise<void> {
    try {
      // TODO: Implement S3 archival
      logger.info('Archiving event to S3 (placeholder)', {
        seller_id: event.seller_id,
        event_type: event.event_type,
        amazon_event_id: event.amazon_event_id
      });

      // For now, just log the archival
      // In production, this would upload to S3 bucket
    } catch (error) {
      logger.error('Error archiving event to S3', { error, event });
      // Don't throw error as archival is not critical for core functionality
    }
  }
}

export const financialEventsService = new FinancialEventsService();
export default financialEventsService;
