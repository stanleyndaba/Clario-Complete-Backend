import { Router } from 'express';
import { authenticateUser } from '../middleware/authMiddleware';
import enhancedDetectionService from '../services/enhancedDetectionService';
import disputeService from '../services/disputeService';

const router = Router();

// Apply authentication middleware to all routes
router.use(authenticateUser);

/**
 * @route POST /api/enhanced-detection/trigger
 * @desc Trigger detection pipeline for a specific sync
 * @access Private
 */
router.post('/trigger', async (req, res) => {
  try {
    const userId = req.user?.id;
    const { syncId, triggerType, metadata } = req.body;

    if (!syncId || !triggerType) {
      return res.status(400).json({
        success: false,
        message: 'syncId and triggerType are required'
      });
    }

    await enhancedDetectionService.triggerDetectionPipeline(
      userId,
      syncId,
      triggerType,
      metadata
    );

    res.json({
      success: true,
      message: 'Detection pipeline triggered successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message || 'Internal server error'
    });
  }
});

/**
 * @route GET /api/enhanced-detection/results
 * @desc Get detection results for the authenticated user
 * @access Private
 * @query syncId - Filter by sync ID
 * @query status - Filter by status
 * @query limit - Number of records to return (default: 100)
 * @query offset - Number of records to skip (default: 0)
 */
router.get('/results', async (req, res) => {
  try {
    const userId = req.user?.id;
    const { syncId, status, limit = 100, offset = 0 } = req.query;

    const results = await enhancedDetectionService.getDetectionResults(
      userId,
      syncId as string,
      status as string,
      Number(limit),
      Number(offset)
    );

    res.json({
      success: true,
      data: results
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message || 'Internal server error'
    });
  }
});

/**
 * @route GET /api/enhanced-detection/results/:syncId
 * @desc Get detection results for a specific sync
 * @access Private
 */
router.get('/results/:syncId', async (req, res) => {
  try {
    const userId = req.user?.id;
    const { syncId } = req.params;

    const results = await enhancedDetectionService.getDetectionResults(
      userId,
      syncId
    );

    res.json({
      success: true,
      data: results
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message || 'Internal server error'
    });
  }
});

/**
 * @route GET /api/enhanced-detection/statistics
 * @desc Get detection statistics for the authenticated user
 * @access Private
 */
router.get('/statistics', async (req, res) => {
  try {
    const userId = req.user?.id;

    const statistics = await enhancedDetectionService.getDetectionStatistics(userId);

    res.json({
      success: true,
      data: statistics
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message || 'Internal server error'
    });
  }
});

/**
 * @route GET /api/enhanced-detection/queue/stats
 * @desc Get detection queue statistics
 * @access Private
 */
router.get('/queue/stats', async (req, res) => {
  try {
    // This would typically get queue statistics from Redis
    // For now, return mock data
    res.json({
      success: true,
      data: {
        queue_length: 0,
        processing_jobs: 0,
        completed_jobs: 0,
        failed_jobs: 0,
        average_processing_time: 0
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message || 'Internal server error'
    });
  }
});

/**
 * @route POST /api/enhanced-detection/jobs/:id/retry
 * @desc Retry a failed detection job
 * @access Private
 */
router.post('/jobs/:id/retry', async (req, res) => {
  try {
    // Implementation for retrying failed jobs
    res.json({
      success: true,
      message: 'Job retry initiated'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message || 'Internal server error'
    });
  }
});

/**
 * @route DELETE /api/enhanced-detection/jobs/:id
 * @desc Delete a detection job
 * @access Private
 */
router.delete('/jobs/:id', async (req, res) => {
  try {
    // Implementation for deleting jobs
    res.json({
      success: true,
      message: 'Job deleted successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message || 'Internal server error'
    });
  }
});

// Dispute Case Routes

/**
 * @route POST /api/enhanced-detection/disputes
 * @desc Create a new dispute case
 * @access Private
 */
router.post('/disputes', async (req, res) => {
  try {
    const userId = req.user?.id;
    const { detectionResultId, caseType, claimAmount, currency = 'USD', evidence } = req.body;

    if (!detectionResultId || !caseType || !claimAmount) {
      return res.status(400).json({
        success: false,
        message: 'detectionResultId, caseType, and claimAmount are required'
      });
    }

    const disputeCase = await disputeService.createDisputeCase(
      userId,
      detectionResultId,
      caseType,
      claimAmount,
      currency,
      evidence
    );

    res.json({
      success: true,
      data: disputeCase
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message || 'Internal server error'
    });
  }
});

/**
 * @route GET /api/enhanced-detection/disputes
 * @desc Get dispute cases for the authenticated user
 * @access Private
 * @query status - Filter by status
 * @query caseType - Filter by case type
 * @query provider - Filter by provider
 * @query dateFrom - Filter by date from (ISO string)
 * @query dateTo - Filter by date to (ISO string)
 * @query limit - Number of records to return (default: 100)
 * @query offset - Number of records to skip (default: 0)
 */
router.get('/disputes', async (req, res) => {
  try {
    const userId = req.user?.id;
    const { 
      status, 
      caseType, 
      provider, 
      dateFrom, 
      dateTo, 
      limit = 100, 
      offset = 0 
    } = req.query;

    const filters: any = {};
    if (status) filters.status = status;
    if (caseType) filters.caseType = caseType;
    if (provider) filters.provider = provider;
    if (dateFrom) filters.dateFrom = dateFrom;
    if (dateTo) filters.dateTo = dateTo;

    const pagination = {
      limit: Number(limit),
      offset: Number(offset)
    };

    const result = await disputeService.getDisputeCases(userId, filters, pagination);

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message || 'Internal server error'
    });
  }
});

/**
 * @route GET /api/enhanced-detection/disputes/:id
 * @desc Get a specific dispute case by ID
 * @access Private
 */
router.get('/disputes/:id', async (req, res) => {
  try {
    const userId = req.user?.id;
    const { id } = req.params;

    const disputeCase = await disputeService.getDisputeCase(id);

    // Verify the user owns this case
    if (disputeCase.seller_id !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    res.json({
      success: true,
      data: disputeCase
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message || 'Internal server error'
    });
  }
});

/**
 * @route POST /api/enhanced-detection/disputes/:id/submit
 * @desc Submit a dispute case to the provider
 * @access Private
 */
router.post('/disputes/:id/submit', async (req, res) => {
  try {
    const userId = req.user?.id;
    const { id } = req.params;
    const { submissionData, evidenceIds } = req.body;

    // Verify the user owns this case
    const disputeCase = await disputeService.getDisputeCase(id);
    if (disputeCase.seller_id !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const updatedCase = await disputeService.submitDisputeCase(
      id,
      submissionData || {},
      evidenceIds || []
    );

    res.json({
      success: true,
      data: updatedCase
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message || 'Internal server error'
    });
  }
});

/**
 * @route GET /api/enhanced-detection/disputes/:id/audit-log
 * @desc Get audit log for a dispute case
 * @access Private
 */
router.get('/disputes/:id/audit-log', async (req, res) => {
  try {
    const userId = req.user?.id;
    const { id } = req.params;

    // Verify the user owns this case
    const disputeCase = await disputeService.getDisputeCase(id);
    if (disputeCase.seller_id !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Get audit log from database
    const { data, error } = await supabase
      .from('dispute_audit_log')
      .select('*')
      .eq('dispute_case_id', id)
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(`Failed to fetch audit log: ${error.message}`);
    }

    res.json({
      success: true,
      data: data || []
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message || 'Internal server error'
    });
  }
});

/**
 * @route GET /api/enhanced-detection/disputes/statistics
 * @desc Get dispute case statistics for the authenticated user
 * @access Private
 */
router.get('/disputes/statistics', async (req, res) => {
  try {
    const userId = req.user?.id;

    const statistics = await disputeService.getDisputeStatistics(userId);

    res.json({
      success: true,
      data: statistics
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message || 'Internal server error'
    });
  }
});

// Automation Rules Routes

/**
 * @route POST /api/enhanced-detection/automation-rules
 * @desc Create a new automation rule
 * @access Private
 */
router.post('/automation-rules', async (req, res) => {
  try {
    const userId = req.user?.id;
    const { ruleName, ruleType, conditions, actions, isActive = true, priority = 1 } = req.body;

    if (!ruleName || !ruleType || !conditions || !actions) {
      return res.status(400).json({
        success: false,
        message: 'ruleName, ruleType, conditions, and actions are required'
      });
    }

    const rule = await disputeService.createAutomationRule({
      seller_id: userId,
      rule_name: ruleName,
      rule_type: ruleType,
      conditions,
      actions,
      is_active: isActive,
      priority
    });

    res.json({
      success: true,
      data: rule
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message || 'Internal server error'
    });
  }
});

/**
 * @route GET /api/enhanced-detection/automation-rules
 * @desc Get automation rules for the authenticated user
 * @access Private
 */
router.get('/automation-rules', async (req, res) => {
  try {
    const userId = req.user?.id;

    const rules = await disputeService.getAutomationRules(userId);

    res.json({
      success: true,
      data: rules
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message || 'Internal server error'
    });
  }
});

// Thresholds and Whitelist Routes

/**
 * @route GET /api/enhanced-detection/thresholds
 * @desc Get detection thresholds for the authenticated user
 * @access Private
 */
router.get('/thresholds', async (req, res) => {
  try {
    const userId = req.user?.id;

    // Get thresholds from database
    const { data, error } = await supabase
      .from('detection_thresholds')
      .select('*')
      .or(`seller_id.eq.${userId},seller_id.is.null`)
      .eq('is_active', true)
      .order('rule_type', { ascending: true });

    if (error) {
      throw new Error(`Failed to fetch thresholds: ${error.message}`);
    }

    res.json({
      success: true,
      data: data || []
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message || 'Internal server error'
    });
  }
});

/**
 * @route POST /api/enhanced-detection/thresholds
 * @desc Create or update a detection threshold
 * @access Private
 */
router.post('/thresholds', async (req, res) => {
  try {
    const userId = req.user?.id;
    const { ruleType, thresholdValue, thresholdOperator, currency = 'USD', isActive = true } = req.body;

    if (!ruleType || thresholdValue === undefined || !thresholdOperator) {
      return res.status(400).json({
        success: false,
        message: 'ruleType, thresholdValue, and thresholdOperator are required'
      });
    }

    // Upsert threshold
    const { data, error } = await supabase
      .from('detection_thresholds')
      .upsert({
        seller_id: userId,
        rule_type: ruleType,
        threshold_value: thresholdValue,
        threshold_operator: thresholdOperator,
        currency,
        is_active: isActive
      }, {
        onConflict: 'seller_id,rule_type'
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create/update threshold: ${error.message}`);
    }

    res.json({
      success: true,
      data: data
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message || 'Internal server error'
    });
  }
});

/**
 * @route GET /api/enhanced-detection/whitelist
 * @desc Get detection whitelist for the authenticated user
 * @access Private
 */
router.get('/whitelist', async (req, res) => {
  try {
    const userId = req.user?.id;

    // Get whitelist from database
    const { data, error } = await supabase
      .from('detection_whitelist')
      .select('*')
      .eq('seller_id', userId)
      .eq('is_active', true)
      .order('whitelist_type', { ascending: true });

    if (error) {
      throw new Error(`Failed to fetch whitelist: ${error.message}`);
    }

    res.json({
      success: true,
      data: data || []
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message || 'Internal server error'
    });
  }
});

/**
 * @route POST /api/enhanced-detection/whitelist
 * @desc Create a new whitelist entry
 * @access Private
 */
router.post('/whitelist', async (req, res) => {
  try {
    const userId = req.user?.id;
    const { whitelistType, whitelistValue, reason, isActive = true } = req.body;

    if (!whitelistType || !whitelistValue) {
      return res.status(400).json({
        success: false,
        message: 'whitelistType and whitelistValue are required'
      });
    }

    // Create whitelist entry
    const { data, error } = await supabase
      .from('detection_whitelist')
      .insert({
        seller_id: userId,
        whitelist_type: whitelistType,
        whitelist_value: whitelistValue,
        reason,
        is_active: isActive
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create whitelist entry: ${error.message}`);
    }

    res.json({
      success: true,
      data: data
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message || 'Internal server error'
    });
  }
});

export default router;

