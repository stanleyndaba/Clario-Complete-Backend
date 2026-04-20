import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const insertSingleMock = jest.fn() as jest.Mock;
const sendWaitlistConfirmationEmailMock = jest.fn() as jest.Mock;

jest.mock('../../src/database/supabaseClient', () => ({
  supabaseAdmin: {
    from: jest.fn(() => ({
      insert: jest.fn(() => ({
        select: jest.fn(() => ({
          single: insertSingleMock,
        })),
      })),
    })),
  },
}));

jest.mock('../../src/services/waitlistEmailService', () => ({
  waitlistEmailService: {
    sendWaitlistConfirmationEmail: sendWaitlistConfirmationEmailMock,
  },
}));

import waitlistRoutes from '../../src/routes/waitlistRoutes';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/waitlist', waitlistRoutes);
  return app;
}

describe('waitlistRoutes', () => {
  beforeEach(() => {
    insertSingleMock.mockReset();
    sendWaitlistConfirmationEmailMock.mockReset();
  });

  it('sends a confirmation email after a successful waitlist signup', async () => {
    insertSingleMock.mockImplementation(async () => ({
      data: { id: 'waitlist-1', email: 'seller@example.com' },
      error: null,
    }));
    sendWaitlistConfirmationEmailMock.mockImplementation(async () => ({
      provider: 'resend',
      providerMessageId: 're_123',
    }));

    const app = createApp();
    const response = await request(app)
      .post('/api/waitlist')
      .send({ email: 'seller@example.com', user_type: 'brand', annual_revenue: 'growing', primary_goal: 'recover' });

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.message).toContain('Check your email for confirmation');
    expect(sendWaitlistConfirmationEmailMock).toHaveBeenCalledWith('seller@example.com');
  });

  it('does not fail the signup if the confirmation email send fails', async () => {
    insertSingleMock.mockImplementation(async () => ({
      data: { id: 'waitlist-2', email: 'seller@example.com' },
      error: null,
    }));
    sendWaitlistConfirmationEmailMock.mockImplementation(async () => {
      throw new Error('resend_failed');
    });

    const app = createApp();
    const response = await request(app)
      .post('/api/waitlist')
      .send({ email: 'seller@example.com', user_type: 'brand', annual_revenue: 'growing', primary_goal: 'recover' });

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.message).toBe('Welcome to the waitlist! We will be in touch soon.');
  });

  it('does not resend the confirmation email for an already-registered address', async () => {
    insertSingleMock.mockImplementation(async () => ({
      data: null,
      error: { code: '23505', message: 'duplicate key value violates unique constraint' },
    }));

    const app = createApp();
    const response = await request(app)
      .post('/api/waitlist')
      .send({ email: 'seller@example.com', user_type: 'brand', annual_revenue: 'growing', primary_goal: 'recover' });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.already_registered).toBe(true);
    expect(sendWaitlistConfirmationEmailMock).not.toHaveBeenCalled();
  });
});
