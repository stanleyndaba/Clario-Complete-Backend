import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import auditRoutes from '../../src/routes/auditRoutes';
import auditRunService from '../../src/services/auditRunService';

jest.mock('../../src/middleware/authMiddleware', () => ({
  authenticateToken: (req: any, _res: any, next: any) => {
    req.user = { id: 'user-1', email: 'seller@example.com' };
    next();
  },
}));

jest.mock('../../src/services/auditRunService', () => ({
  __esModule: true,
  default: {
    getAuditHistory: jest.fn(),
    getSchedule: jest.fn(),
    saveSchedule: jest.fn(),
    getAudit: jest.fn(),
    getExportSummary: jest.fn(),
    getActivity: jest.fn(),
    getResults: jest.fn(),
  },
}));

const app = express();
app.use(express.json());
app.use('/api/audits', auditRoutes);

describe('audit utility routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('routes /history to audit history instead of treating history as an audit id', async () => {
    (auditRunService.getAuditHistory as any).mockResolvedValue([{ id: 'audit-1' }]);

    const response = await request(app).get('/api/audits/history?limit=18');

    expect(response.status).toBe(200);
    expect(response.body.audits).toEqual([{ id: 'audit-1' }]);
    expect(auditRunService.getAuditHistory).toHaveBeenCalledWith('user-1', 18);
    expect(auditRunService.getAudit).not.toHaveBeenCalled();
  });

  it('routes /schedule to schedule state instead of treating schedule as an audit id', async () => {
    (auditRunService.getSchedule as any).mockResolvedValue({
      schedule: null,
      entitlement: { entitled: false, state: 'none' },
    });

    const response = await request(app).get('/api/audits/schedule');

    expect(response.status).toBe(200);
    expect(response.body.entitlement.entitled).toBe(false);
    expect(auditRunService.getSchedule).toHaveBeenCalledWith('user-1');
    expect(auditRunService.getAudit).not.toHaveBeenCalled();
  });

  it('routes actual audit ids to the audit detail route', async () => {
    (auditRunService.getAudit as any).mockResolvedValue({ id: 'audit-123', status: 'completed' });

    const response = await request(app).get('/api/audits/audit-123');

    expect(response.status).toBe(200);
    expect(response.body.audit.id).toBe('audit-123');
    expect(auditRunService.getAudit).toHaveBeenCalledWith('audit-123', 'user-1');
  });

  it('returns a controlled 404 for audit ids outside the authenticated user scope', async () => {
    (auditRunService.getExportSummary as any).mockRejectedValue(new Error('Audit run not found'));
    (auditRunService.getActivity as any).mockRejectedValue(new Error('Audit run not found'));

    const exportResponse = await request(app).get('/api/audits/other-audit/export-summary');
    const activityResponse = await request(app).get('/api/audits/other-audit/activity');

    expect(exportResponse.status).toBe(404);
    expect(activityResponse.status).toBe(404);
    expect(exportResponse.body.message).toBe('Audit run not found');
    expect(activityResponse.body.message).toBe('Audit run not found');
  });

  it('requires Recovery Workspace entitlement when saving a schedule', async () => {
    (auditRunService.saveSchedule as any).mockRejectedValue(new Error('Recovery Workspace subscription required'));

    const response = await request(app)
      .put('/api/audits/schedule')
      .send({ cadence: 'weekly', preferred_time: '09:00', timezone: 'Africa/Johannesburg' });

    expect(response.status).toBe(402);
    expect(response.body.message).toBe('Recovery Workspace subscription required');
  });
});
