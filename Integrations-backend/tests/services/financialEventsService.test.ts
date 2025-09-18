/// <reference types="jest" />

import { FinancialEventsService, FinancialEvent } from '../../src/services/financialEventsService';

// Mock Supabase client
const mockSupabase = {
  from: () => mockSupabase,
  insert: () => mockSupabase,
  select: () => mockSupabase,
  single: () => mockSupabase,
  eq: () => mockSupabase,
  order: () => mockSupabase,
  range: () => mockSupabase,
  gte: () => mockSupabase,
  lte: () => mockSupabase
};

jest.mock('../../src/database/supabaseClient', () => ({
  supabase: mockSupabase
}));

// Mock logger
jest.mock('../../src/utils/logger', () => ({
  info: () => {},
  warn: () => {},
  error: () => {}
}));

describe('FinancialEventsService', () => {
  let service: FinancialEventsService;
  let mockEvent: FinancialEvent;

  beforeEach(() => {
    // Reset mock return values
    Object.keys(mockSupabase).forEach(key => {
      if (typeof mockSupabase[key] === 'function') {
        mockSupabase[key] = jest.fn().mockReturnThis();
      }
    });
    
    service = new FinancialEventsService();
    
    mockEvent = {
      seller_id: 'test-seller-123',
      event_type: 'fee',
      amount: 25.50,
      currency: 'USD',
      raw_payload: {
        eventId: 'fee-123',
        orderId: 'order-456',
        sku: 'SKU-789',
        eventDate: '2024-01-15T10:30:00Z'
      },
      amazon_event_id: 'fee-123',
      amazon_order_id: 'order-456',
      amazon_sku: 'SKU-789',
      event_date: new Date('2024-01-15T10:30:00Z')
    };
  });

  describe('ingestEvent', () => {
    it('should successfully ingest a single financial event', async () => {
      const mockResponse = {
        id: 'event-123',
        ...mockEvent,
        created_at: '2024-01-15T10:30:00Z',
        updated_at: '2024-01-15T10:30:00Z'
      };

      mockSupabase.single.mockResolvedValue({
        data: mockResponse,
        error: null
      });

      const result = await service.ingestEvent(mockEvent);

      expect(result).toEqual(mockResponse);
      expect(mockSupabase.from).toHaveBeenCalledWith('financial_events');
      expect(mockSupabase.insert).toHaveBeenCalledWith({
        seller_id: mockEvent.seller_id,
        event_type: mockEvent.event_type,
        amount: mockEvent.amount,
        currency: mockEvent.currency,
        raw_payload: mockEvent.raw_payload,
        amazon_event_id: mockEvent.amazon_event_id,
        amazon_order_id: mockEvent.amazon_order_id,
        amazon_sku: mockEvent.amazon_sku,
        event_date: mockEvent.event_date?.toISOString()
      });
    });

    it('should handle database errors gracefully', async () => {
      const dbError = new Error('Database connection failed');
      mockSupabase.single.mockResolvedValue({
        data: null,
        error: dbError
      });

      await expect(service.ingestEvent(mockEvent)).rejects.toThrow(
        'Failed to ingest financial event: Database connection failed'
      );
    });

    it('should handle missing optional fields', async () => {
      const eventWithoutOptionals = {
        seller_id: 'test-seller-123',
        event_type: 'reimbursement' as const,
        amount: 15.75,
        currency: 'USD',
        raw_payload: { test: 'data' }
      };

      const mockResponse = {
        id: 'event-456',
        ...eventWithoutOptionals,
        created_at: '2024-01-15T10:30:00Z',
        updated_at: '2024-01-15T10:30:00Z'
      };

      mockSupabase.single.mockResolvedValue({
        data: mockResponse,
        error: null
      });

      const result = await service.ingestEvent(eventWithoutOptionals);

      expect(result).toEqual(mockResponse);
      expect(mockSupabase.insert).toHaveBeenCalledWith({
        seller_id: eventWithoutOptionals.seller_id,
        event_type: eventWithoutOptionals.event_type,
        amount: eventWithoutOptionals.amount,
        currency: eventWithoutOptionals.currency,
        raw_payload: eventWithoutOptionals.raw_payload,
        amazon_event_id: undefined,
        amazon_order_id: undefined,
        amazon_sku: undefined,
        event_date: undefined
      });
    });
  });

  describe('ingestEvents', () => {
    it('should successfully ingest multiple financial events', async () => {
      const events = [mockEvent, { ...mockEvent, id: 'event-456' }];
      const mockResponse = events.map((event, index) => ({
        id: `event-${index + 1}`,
        ...event,
        created_at: '2024-01-15T10:30:00Z',
        updated_at: '2024-01-15T10:30:00Z'
      }));

      mockSupabase.select.mockResolvedValue({
        data: mockResponse,
        error: null
      });

      const result = await service.ingestEvents(events);

      expect(result).toEqual(mockResponse);
      expect(mockSupabase.insert).toHaveBeenCalledWith(
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
      );
    });

    it('should handle empty events array', async () => {
      mockSupabase.select.mockResolvedValue({
        data: [],
        error: null
      });

      const result = await service.ingestEvents([]);

      expect(result).toEqual([]);
      expect(mockSupabase.insert).toHaveBeenCalledWith([]);
    });

    it('should handle database errors in batch ingestion', async () => {
      const events = [mockEvent];
      const dbError = new Error('Batch insert failed');
      
      mockSupabase.select.mockResolvedValue({
        data: null,
        error: dbError
      });

      await expect(service.ingestEvents(events)).rejects.toThrow(
        'Failed to ingest financial events: Batch insert failed'
      );
    });
  });

  describe('getEventsBySeller', () => {
    it('should fetch events for a seller with default parameters', async () => {
      const mockEvents = [
        { id: 'event-1', seller_id: 'test-seller-123', event_type: 'fee', amount: 25.50 },
        { id: 'event-2', seller_id: 'test-seller-123', event_type: 'reimbursement', amount: 15.75 }
      ];

      mockSupabase.range.mockResolvedValue({
        data: mockEvents,
        error: null
      });

      const result = await service.getEventsBySeller('test-seller-123');

      expect(result).toEqual(mockEvents);
      expect(mockSupabase.eq).toHaveBeenCalledWith('seller_id', 'test-seller-123');
      expect(mockSupabase.order).toHaveBeenCalledWith('created_at', { ascending: false });
      expect(mockSupabase.range).toHaveBeenCalledWith(0, 99);
    });

    it('should apply event type filter when provided', async () => {
      const mockEvents = [
        { id: 'event-1', seller_id: 'test-seller-123', event_type: 'fee', amount: 25.50 }
      ];

      mockSupabase.range.mockResolvedValue({
        data: mockEvents,
        error: null
      });

      const result = await service.getEventsBySeller('test-seller-123', 'fee', 50, 10);

      expect(result).toEqual(mockEvents);
      expect(mockSupabase.eq).toHaveBeenCalledWith('event_type', 'fee');
      expect(mockSupabase.range).toHaveBeenCalledWith(10, 59);
    });

    it('should handle database errors in event fetching', async () => {
      const dbError = new Error('Query failed');
      mockSupabase.range.mockResolvedValue({
        data: null,
        error: dbError
      });

      await expect(service.getEventsBySeller('test-seller-123')).rejects.toThrow(
        'Failed to fetch financial events: Query failed'
      );
    });
  });

  describe('getEventsByDateRange', () => {
    it('should fetch events within date range', async () => {
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-01-31');
      const mockEvents = [
        { id: 'event-1', seller_id: 'test-seller-123', event_type: 'fee', amount: 25.50 }
      ];

      mockSupabase.lte.mockResolvedValue({
        data: mockEvents,
        error: null
      });

      const result = await service.getEventsByDateRange('test-seller-123', startDate, endDate);

      expect(result).toEqual(mockEvents);
      expect(mockSupabase.gte).toHaveBeenCalledWith('event_date', startDate.toISOString());
      expect(mockSupabase.lte).toHaveBeenCalledWith('event_date', endDate.toISOString());
    });

    it('should apply event type filter in date range query', async () => {
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-01-31');
      const mockEvents = [
        { id: 'event-1', seller_id: 'test-seller-123', event_type: 'fee', amount: 25.50 }
      ];

      mockSupabase.lte.mockResolvedValue({
        data: mockEvents,
        error: null
      });

      const result = await service.getEventsByDateRange('test-seller-123', startDate, endDate, 'fee');

      expect(result).toEqual(mockEvents);
      expect(mockSupabase.eq).toHaveBeenCalledWith('event_type', 'fee');
    });
  });

  describe('getEventStatistics', () => {
    it('should calculate correct statistics for events', async () => {
      const mockData = [
        { event_type: 'fee', amount: 25.50 },
        { event_type: 'fee', amount: 15.25 },
        { event_type: 'reimbursement', amount: 10.00 },
        { event_type: 'return', amount: 5.75 }
      ];

      mockSupabase.eq.mockResolvedValue({
        data: mockData,
        error: null
      });

      const result = await service.getEventStatistics('test-seller-123');

      expect(result).toEqual({
        total_events: 4,
        total_amount: 56.50,
        by_type: {
          fee: { count: 2, amount: 40.75 },
          reimbursement: { count: 1, amount: 10.00 },
          return: { count: 1, amount: 5.75 }
        }
      });
    });

    it('should handle empty event data', async () => {
      mockSupabase.eq.mockResolvedValue({
        data: [],
        error: null
      });

      const result = await service.getEventStatistics('test-seller-123');

      expect(result).toEqual({
        total_events: 0,
        total_amount: 0,
        by_type: {}
      });
    });
  });

  describe('archiveToS3', () => {
    it('should log archival attempt (placeholder implementation)', async () => {
      await expect(service.archiveToS3(mockEvent)).resolves.toBeUndefined();
      
      // This is a placeholder implementation, so we just verify it doesn't throw
      // In a real implementation, this would upload to S3
    });
  });
});
