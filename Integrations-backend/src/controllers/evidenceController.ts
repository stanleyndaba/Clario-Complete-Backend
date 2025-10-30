import { Request, Response } from 'express';
import { evidenceIngestionService } from '../services/evidenceIngestionService';
import { evidenceValidatorService } from '../services/evidenceValidatorService';
import * as evidenceService from '../services/evidenceService'; // ADD THIS IMPORT

export const ingestEvidence = async (req: Request, res: Response) => {
  try {
    const { userId, source, documents } = req.body;
    
    // FIX: Use the new evidenceService module functions
    const result = await evidenceService.ingestDocuments({ userId, source, documents });
    
    res.json({
      success: true,
      data: result,
      message: 'Evidence ingestion started successfully'
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

export const validateEvidence = async (req: Request, res: Response) => {
  try {
    const { userId, evidenceId, claimId } = req.body;
    
    // FIX: Use the new evidenceService module functions
    const validation = await evidenceService.validateEvidence({ userId, evidenceId, claimId });
    
    res.json({
      success: true,
      data: validation,
      message: 'Evidence validation completed'
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

export const findEvidenceMatches = async (req: Request, res: Response) => {
  try {
    const { userId, claimId } = req.body;
    
    // FIX: Use the new evidenceService module functions
    const matches = await evidenceService.findMatchesForClaim({ userId, claimId });
    
    res.json({
      success: true,
      data: matches,
      message: 'Evidence matches found'
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};
