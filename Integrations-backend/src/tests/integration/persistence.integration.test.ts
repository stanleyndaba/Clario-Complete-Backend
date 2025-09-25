import { supabase } from '../../database/supabaseClient';
import amazonService from '../../services/amazonService';
import financialEventsService from '../../services/financialEventsService';

describe('Persistence integration (financial_events)', () => {
  const userId = process.env.USER_ID || 'test-user';

  it('ingests fee preview into financial_events', async () => {
    const fees = await amazonService.getRealFeeDiscrepancies(userId);
    // Write first 3 as events (simulate sync job path)
    const toWrite = fees.slice(0, 3).map((fee: any) => ({
      seller_id: userId,
      event_type: 'fee' as const,
      amount: Number(fee.amount || fee.estimated_fee_total || 0),
      currency: fee.currency || 'USD',
      raw_payload: fee,
      amazon_event_id: fee.eventId,
      amazon_order_id: fee.orderId,
      amazon_sku: fee.sku,
      event_date: new Date()
    }));
    await financialEventsService.ingestEvents(toWrite as any);
    const { data, error } = await supabase
      .from('financial_events')
      .select('*')
      .eq('seller_id', userId)
      .eq('event_type', 'fee')
      .order('created_at', { ascending: false })
      .limit(3);
    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
  });
});

