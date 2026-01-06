import { Request, Response } from 'express';
import { LedgerService, LedgerQueryParams } from '../services/ledgerService';

export class LedgerController {
  /**
   * Get ledger entries with filtering and pagination
   * GET /api/v1/ledger
   */
  static async getLedgerEntries(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      const queryParams: LedgerQueryParams = {
        status: req.query.status as 'pending' | 'completed' | 'failed',
        entry_type: req.query.entry_type as 'claim' | 'refund' | 'fee' | 'adjustment',
        date_from: req.query.date_from as string,
        date_to: req.query.date_to as string,
        case_id: req.query.case_id as string,
        limit: req.query.limit ? parseInt(req.query.limit as string) : 10,
        offset: req.query.offset ? parseInt(req.query.offset as string) : 0,
        sort_by: req.query.sort_by as string || 'created_at',
        sort_order: (req.query.sort_order as 'ASC' | 'DESC') || 'DESC'
      };

      const result = await LedgerService.getLedgerEntries(req.user.id, queryParams);
      
      res.status(200).json({
        success: true,
        data: result.entries,
        pagination: {
          total: result.total,
          limit: queryParams.limit,
          offset: queryParams.offset,
          has_more: result.total > (queryParams.offset || 0) + (queryParams.limit || 10)
        }
      });
    } catch (error) {
      console.error('Error getting ledger entries:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to retrieve ledger entries'
      });
    }
  }

  /**
   * Get ledger entry by ID
   * GET /api/v1/ledger/:id
   */
  static async getLedgerEntryById(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      const { id } = req.params;
      const entry = await LedgerService.getLedgerEntryById(req.user.id, id);

      if (!entry) {
        res.status(404).json({
          error: 'Ledger entry not found',
          message: 'The specified ledger entry does not exist or you do not have access to it'
        });
        return;
      }

      res.status(200).json({
        success: true,
        data: entry
      });
    } catch (error) {
      console.error('Error getting ledger entry by ID:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to retrieve ledger entry'
      });
    }
  }

  /**
   * Get ledger entries for a specific case
   * GET /api/v1/ledger/case/:caseId
   */
  static async getLedgerEntriesByCase(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      const { caseId } = req.params;
      const entries = await LedgerService.getLedgerEntriesByCase(req.user.id, caseId);
      
      res.status(200).json({
        success: true,
        data: entries,
        case_id: caseId,
        count: entries.length
      });
    } catch (error) {
      console.error('Error getting ledger entries by case:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to retrieve ledger entries for case'
      });
    }
  }

  /**
   * Create a new ledger entry
   * POST /api/v1/ledger
   */
  static async createLedgerEntry(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      const { case_id, entry_type, amount, description, status } = req.body;
      
      // Validate required fields
      if (!case_id || !entry_type || !amount || !description) {
        res.status(400).json({ 
          error: 'Missing required fields',
          message: 'case_id, entry_type, amount, and description are required'
        });
        return;
      }

      // Validate entry_type
      const validEntryTypes = ['claim', 'refund', 'fee', 'adjustment'];
      if (!validEntryTypes.includes(entry_type)) {
        res.status(400).json({
          error: 'Invalid entry type',
          message: 'entry_type must be one of: claim, refund, fee, adjustment'
        });
        return;
      }

      const entry = await LedgerService.createLedgerEntry(req.user.id, {
        case_id,
        entry_type,
        amount,
        description,
        status
      });
      
      res.status(201).json({
        success: true,
        data: entry,
        message: 'Ledger entry created successfully'
      });
    } catch (error) {
      console.error('Error creating ledger entry:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to create ledger entry'
      });
    }
  }

  /**
   * Update ledger entry status
   * PUT /api/v1/ledger/:id/status
   */
  static async updateLedgerEntryStatus(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      const { id } = req.params;
      const { status } = req.body;

      if (!status || !['pending', 'completed', 'failed'].includes(status)) {
        res.status(400).json({
          error: 'Invalid status',
          message: 'status must be one of: pending, completed, failed'
        });
        return;
      }

      const updatedEntry = await LedgerService.updateLedgerEntryStatus(req.user.id, id, status);

      if (!updatedEntry) {
        res.status(404).json({
          error: 'Ledger entry not found',
          message: 'The specified ledger entry does not exist or you do not have access to it'
        });
        return;
      }

      res.status(200).json({
        success: true,
        data: updatedEntry,
        message: 'Ledger entry status updated successfully'
      });
    } catch (error) {
      console.error('Error updating ledger entry status:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to update ledger entry status'
      });
    }
  }

  /**
   * Get ledger statistics
   * GET /api/v1/ledger/stats
   */
  static async getLedgerStats(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      const { date_from, date_to } = req.query;
      const stats = await LedgerService.getLedgerStats(
        req.user.id, 
        date_from as string, 
        date_to as string
      );
      
      res.status(200).json({
        success: true,
        data: stats,
        filters: {
          date_from: date_from || null,
          date_to: date_to || null
        }
      });
    } catch (error) {
      console.error('Error getting ledger stats:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to retrieve ledger statistics'
      });
    }
  }

  /**
   * Get ledger entries with case information
   * GET /api/v1/ledger/with-cases
   */
  static async getLedgerEntriesWithCaseInfo(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      const queryParams: LedgerQueryParams = {
        status: req.query.status as 'pending' | 'completed' | 'failed',
        entry_type: req.query.entry_type as 'claim' | 'refund' | 'fee' | 'adjustment',
        date_from: req.query.date_from as string,
        date_to: req.query.date_to as string,
        case_id: req.query.case_id as string,
        limit: req.query.limit ? parseInt(req.query.limit as string) : 10,
        offset: req.query.offset ? parseInt(req.query.offset as string) : 0,
        sort_by: req.query.sort_by as string || 'l.created_at',
        sort_order: (req.query.sort_order as 'ASC' | 'DESC') || 'DESC'
      };

      const entries = await LedgerService.getLedgerEntriesWithCaseInfo(req.user.id, queryParams);
      
      res.status(200).json({
        success: true,
        data: entries,
        count: entries.length
      });
    } catch (error) {
      console.error('Error getting ledger entries with case info:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to retrieve ledger entries with case information'
      });
    }
  }

  /**
   * Search ledger entries
   * GET /api/v1/ledger/search
   */
  static async searchLedgerEntries(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      const { q, limit } = req.query;
      
      if (!q || typeof q !== 'string') {
        res.status(400).json({
          error: 'Search query required',
          message: 'Please provide a search term in the "q" parameter'
        });
        return;
      }

      const searchLimit = limit ? parseInt(limit as string) : 10;
      const entries = await LedgerService.searchLedgerEntries(req.user.id, q, searchLimit);
      
      res.status(200).json({
        success: true,
        data: entries,
        search: {
          query: q,
          results_count: entries.length
        }
      });
    } catch (error) {
      console.error('Error searching ledger entries:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to search ledger entries'
      });
    }
  }
} 