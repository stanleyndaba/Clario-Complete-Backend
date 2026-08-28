import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const insertSingleMock: any = jest.fn();
const fromMock: any = jest.fn();
const notifySalesLeadMock: any = jest.fn();

jest.mock('../../src/database/supabaseClient', () => ({
  supabaseAdmin: { from: fromMock },
}));
jest.mock('../../src/services/salesLeadNotificationService', () => ({
  notifySalesLead: notifySalesLeadMock,
}));

import salesLeadRoutes from '../../src/routes/salesLeadRoutes';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/sales-leads', salesLeadRoutes);
  return app;
}

const validLead = {
  name: 'Alex Seller',
  email: 'alex@example.com',
  company: 'Example Brands',
  role: 'CFO',
  gmv: '$1M-$5M',
  accounts: '3 Seller Central accounts',
  complexity: 'Multiple marketplaces and brands',
  process: 'Spreadsheets',
  objective: 'Understand recurring recovery burden',
  notes: 'Please review our operating model.',
};

describe('salesLeadRoutes', () => {
  beforeEach(() => {
    fromMock.mockReset();
    insertSingleMock.mockReset();
    notifySalesLeadMock.mockReset();
    notifySalesLeadMock.mockResolvedValue(undefined);
  });

  it('persists a valid public assessment lead and returns a lead id', async () => {
    insertSingleMock.mockResolvedValue({
      data: { id: 'lead-1', status: 'new', created_at: '2026-08-28T00:00:00.000Z' },
      error: null,
    });
    fromMock.mockReturnValue({
      insert: jest.fn(() => ({
        select: jest.fn(() => ({ single: insertSingleMock })),
      })),
    });

    const response = await request(createApp()).post('/api/sales-leads').send(validLead);

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ success: true, lead_id: 'lead-1', status: 'new' });
    expect(fromMock).toHaveBeenCalledWith('sales_leads');
    expect(notifySalesLeadMock).toHaveBeenCalledWith(expect.objectContaining({
      id: 'lead-1',
      email: 'alex@example.com',
      company: 'Example Brands'
    }));
  });

  it('returns the persisted lead even when internal Resend notification fails', async () => {
    insertSingleMock.mockResolvedValue({
      data: { id: 'lead-2', status: 'new', created_at: '2026-08-28T00:00:00.000Z' },
      error: null,
    });
    notifySalesLeadMock.mockRejectedValue(new Error('Resend unavailable'));
    fromMock.mockReturnValue({
      insert: jest.fn(() => ({
        select: jest.fn(() => ({ single: insertSingleMock })),
      })),
    });

    const response = await request(createApp()).post('/api/sales-leads').send(validLead);

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ success: true, lead_id: 'lead-2', status: 'new' });
  });

  it('rejects missing required lead information before database insertion', async () => {
    const response = await request(createApp()).post('/api/sales-leads').send({ ...validLead, email: '' });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('blocks unauthenticated lead-list access', async () => {
    const response = await request(createApp()).get('/api/sales-leads');

    expect(response.status).toBe(401);
    expect(response.body.error).toBe('ADMIN_AUTH_REQUIRED');
    expect(fromMock).not.toHaveBeenCalled();
  });
});
