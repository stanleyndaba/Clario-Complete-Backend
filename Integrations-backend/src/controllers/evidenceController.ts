import { Request, Response } from 'express';
import { asyncHandler } from '../utils/errorHandler';
import { AuthenticatedRequest } from '../middleware/authMiddleware';
import evidenceIngestionService from '../services/evidenceIngestionService';
import evidenceValidatorService from '../services/evidenceValidatorService';
import logger from '../utils/logger';

export const ingestEvidence = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  const { source, documents } = req.body;

  try {
    const result = await evidenceIngestionService.ingestDocuments(userId, source, documents);
    
    res.json({
      success: true,
      message: 'Evidence ingested successfully',
      evidenceIds: result.evidenceIds
    });
  } catch (error) {
    logger.error('Error ingesting evidence', { error, userId });
    res.status(500).json({
      success: false,
      message: 'Failed to ingest evidence'
    });
  }
});

export const validateEvidence = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  const { evidenceId, claimId } = req.body;

  try {
    const validation = await evidenceValidatorService.validateEvidence(userId, evidenceId, claimId);
    
    res.json({
      success: true,
      validation
    });
  } catch (error) {
    logger.error('Error validating evidence', { error, userId });
    res.status(500).json({
      success: false,
      message: 'Failed to validate evidence'
    });
  }
});

export const getEvidenceMatches = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  const { claimId } = req.params;

  try {
    const matches = await evidenceValidatorService.findMatchesForClaim(userId, claimId);
    
    res.json({
      success: true,
      matches
    });
  } catch (error) {
    logger.error('Error finding evidence matches', { error, userId });
    res.status(500).json({
      success: false,
      message: 'Failed to find evidence matches'
    });
  }
});
