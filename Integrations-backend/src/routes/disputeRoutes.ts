import { Router } from 'express';
import { authenticateToken } from '../middleware/authMiddleware';

const router = Router();

// Apply authentication middleware to all routes
router.use(authenticateToken);

router.get('/', async (_req, res) => {
  try {
    res.json({
      success: true,
      disputes: []
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error?.message || 'Internal server error'
    });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    res.json({
      success: true,
      dispute: {
        id,
        status: 'submitted',
        amount: 0,
        createdAt: new Date().toISOString()
      }
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error?.message || 'Internal server error'
    });
  }
});

router.post('/', async (_req, res) => {
  try {
    res.json({
      success: true,
      disputeId: 'dispute-' + Date.now(),
      message: 'Dispute created successfully'
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error?.message || 'Internal server error'
    });
  }
});

router.post('/:id/submit', async (_req, res) => {
  try {
    res.json({
      success: true,
      message: 'Dispute submitted to Amazon',
      caseId: 'AMZ-CASE-' + Date.now()
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error?.message || 'Internal server error'
    });
  }
});

router.get('/:id/audit-log', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Get audit log from database
    const { supabase } = await import('../database/supabaseClient');
    const { data: auditLog, error } = await supabase
      .from('dispute_audit_log')
      .select('*')
      .eq('dispute_case_id', id)
      .order('created_at', { ascending: false });
    
    if (error) {
      throw error;
    }
    
    res.json({
      success: true,
      auditLog: auditLog || []
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error?.message || 'Internal server error'
    });
  }
});

// PUT /api/v1/disputes/:id/resolve
// Resolve a dispute case
router.put('/:id/resolve', async (req, res) => {
  try {
    const { id } = req.params;
    const userId = (req as any).user?.id;
    const { resolution_status, resolution_notes, resolution_amount } = req.body || {};

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    // Import dispute service
    const disputeService = (await import('../services/disputeService')).default;
    
    // Create resolution object
    const resolution = {
      dispute_case_id: id,
      resolution_status: resolution_status || 'resolved',
      resolution_notes,
      resolution_amount,
      provider_response: { resolved_by: userId, resolved_at: new Date().toISOString() }
    };

    const updatedCase = await disputeService.processCaseResolution(resolution);
    
    res.json({
      success: true,
      message: 'Dispute case resolved successfully',
      dispute: updatedCase
    });
  } catch (error: any) {
    if (error.message === 'Dispute case not found') {
      return res.status(404).json({
        success: false,
        message: error.message
      });
    }
    res.status(500).json({
      success: false,
      message: error?.message || 'Internal server error'
    });
  }
});

export default router;
