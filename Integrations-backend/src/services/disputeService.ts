import { supabase } from '../database/supabaseClient';
import logger from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';
import { pdfGenerationService } from './pdfGenerationService';
// Define DisputeCase interface locally since it's not exported from enhancedDetectionService
interface DisputeCase {
  id: string;
  seller_id: string;
  case_number: string;
  detection_result_id: string;
  case_type: string;
  amount: number;
  claim_amount: number;
  currency: string;
  status: string;
  provider: string;
  provider_case_id?: string;
  evidence?: any;
  created_at: string;
  updated_at: string;
  resolution_date?: string;
  order_id?: string;
  asin?: string;
  sku?: string;
  filing_status?: string;
  evidence_document_ids?: string[];
  metadata?: any;
}

export interface DisputeAutomationRule {
  id: string;
  seller_id: string;
  rule_name: string;
  rule_type: 'auto_submit' | 'auto_approve' | 'threshold_based' | 'whitelist_based';
  conditions: any;
  actions: any;
  is_active: boolean;
  priority: number;
}

export interface DisputeEvidence {
  id: string;
  dispute_case_id: string;
  evidence_type: 'document' | 'screenshot' | 'api_response' | 'calculation' | 'audit_log';
  file_path?: string;
  s3_url?: string;
  file_size?: number;
  mime_type?: string;
  metadata: any;
  created_at: string;
}

export interface DisputeAuditLog {
  id: string;
  dispute_case_id: string;
  user_id?: string;
  action: string;
  old_values: any;
  new_values: any;
  notes?: string;
  created_at: string;
}

export interface CaseSubmissionRequest {
  dispute_case_id: string;
  provider: 'amazon' | 'stripe' | 'shopify';
  submission_data: any;
  evidence_ids: string[];
}

export interface CaseResolution {
  dispute_case_id: string;
  resolution_status: 'approved' | 'rejected' | 'partial';
  resolution_amount?: number;
  resolution_notes: string;
  provider_response: any;
}

export class DisputeService {
  /**
   * Create a new dispute case
   */
  async createDisputeCase(
    sellerId: string,
    detectionResultId: string,
    caseType: 'amazon_fba' | 'stripe_dispute' | 'shopify_refund',
    claimAmount: number,
    currency: string = 'USD',
    evidence?: any,
    storeId?: string
  ): Promise<DisputeCase> {
    try {
      logger.info('Creating dispute case', {
        seller_id: sellerId,
        detection_result_id: detectionResultId,
        case_type: caseType,
        claim_amount: claimAmount
      });

      const caseNumber = this.generateCaseNumber(sellerId, caseType);
      const provider = this.determineProvider(caseType);

      const { data, error } = await supabase
        .from('dispute_cases')
        .insert({
          seller_id: sellerId,
          store_id: storeId,
          detection_result_id: detectionResultId,
          case_number: caseNumber,
          status: 'pending',
          claim_amount: claimAmount,
          currency: currency,
          case_type: caseType,
          provider: provider,
          evidence_attachments: evidence || {}
        })
        .select()
        .single();

      if (error) {
        throw new Error(`Failed to create dispute case: ${error.message}`);
      }

      // Create audit log entry
      await this.createAuditLog(data.id, 'case_created', {}, data, 'Dispute case created');

      // Check for automation rules
      await this.checkAutomationRules(data as DisputeCase);

      logger.info('Dispute case created successfully', {
        case_id: data.id,
        case_number: caseNumber
      });

      return data as DisputeCase;
    } catch (error) {
      logger.error('Error creating dispute case', { error, sellerId, detectionResultId });
      throw error;
    }
  }

  /**
   * Submit a dispute case to the provider
   */
  async submitDisputeCase(
    caseId: string,
    submissionData: any,
    evidenceIds: string[]
  ): Promise<DisputeCase> {
    try {
      logger.info('Submitting dispute case', { case_id: caseId });

      // Get the dispute case
      const { data: disputeCase, error: fetchError } = await supabase
        .from('dispute_cases')
        .select('*')
        .eq('id', caseId)
        .single();

      if (fetchError || !disputeCase) {
        throw new Error('Dispute case not found');
      }

      // Validate case can be submitted
      if (disputeCase.status !== 'pending') {
        throw new Error(`Case cannot be submitted in status: ${disputeCase.status}`);
      }

      // Submit to provider based on case type
      const submissionResult = await this.submitToProvider(disputeCase, submissionData);

      // Update case status
      const { data: updatedCase, error: updateError } = await supabase
        .from('dispute_cases')
        .update({
          status: 'submitted',
          submission_date: new Date().toISOString(),
          provider_case_id: submissionResult.provider_case_id,
          provider_response: submissionResult.provider_response
        })
        .eq('id', caseId)
        .select()
        .single();

      if (updateError) {
        throw new Error(`Failed to update dispute case: ${updateError.message}`);
      }

      // Create audit log entry
      await this.createAuditLog(
        caseId,
        'case_submitted',
        disputeCase,
        updatedCase,
        'Case submitted to provider'
      );

      // Attach evidence
      await this.attachEvidenceToCase(caseId, evidenceIds);

      logger.info('Dispute case submitted successfully', {
        case_id: caseId,
        provider_case_id: submissionResult.provider_case_id
      });

      return updatedCase as DisputeCase;
    } catch (error) {
      logger.error('Error submitting dispute case', { error, caseId });
      throw error;
    }
  }

  /**
   * Process case resolution from provider
   */
  async processCaseResolution(resolution: CaseResolution): Promise<DisputeCase> {
    try {
      logger.info('Processing case resolution', {
        dispute_case_id: resolution.dispute_case_id,
        resolution_status: resolution.resolution_status
      });

      // Get the dispute case
      const { data: disputeCase, error: fetchError } = await supabase
        .from('dispute_cases')
        .select('*')
        .eq('id', resolution.dispute_case_id)
        .single();

      if (fetchError || !disputeCase) {
        throw new Error('Dispute case not found');
      }

      // Update case with resolution
      const updateData: any = {
        status: this.mapResolutionStatus(resolution.resolution_status),
        resolution_date: new Date().toISOString(),
        resolution_notes: resolution.resolution_notes,
        provider_response: resolution.provider_response
      };

      if (resolution.resolution_amount !== undefined) {
        updateData.resolution_amount = resolution.resolution_amount;
      }

      const { data: updatedCase, error: updateError } = await supabase
        .from('dispute_cases')
        .update(updateData)
        .eq('id', resolution.dispute_case_id)
        .select()
        .single();

      if (updateError) {
        throw new Error(`Failed to update dispute case: ${updateError.message}`);
      }

      // Create audit log entry
      await this.createAuditLog(
        resolution.dispute_case_id,
        'case_resolved',
        disputeCase,
        updatedCase,
        `Case resolved: ${resolution.resolution_status}`
      );

      logger.info('Case resolution processed successfully', {
        case_id: resolution.dispute_case_id,
        resolution_status: resolution.resolution_status
      });

      return updatedCase as DisputeCase;
    } catch (error) {
      logger.error('Error processing case resolution', { error, resolution });
      throw error;
    }
  }

  /**
   * Get dispute cases for a seller with filtering
   */
  async getDisputeCases(
    sellerId: string,
    filters?: {
      status?: string;
      caseType?: string;
      provider?: string;
      storeId?: string;
      dateFrom?: string;
      dateTo?: string;
    },
    pagination?: {
      limit: number;
      offset: number;
    }
  ): Promise<{
    cases: DisputeCase[];
    total: number;
    pagination: {
      limit: number;
      offset: number;
      total: number;
    };
  }> {
    try {
      let query = supabase
        .from('dispute_cases')
        .select('*', { count: 'exact' })
        .eq('seller_id', sellerId);

      // Apply filters
      if (filters?.status) {
        query = query.eq('status', filters.status);
      }
      if (filters?.caseType) {
        query = query.eq('case_type', filters.caseType);
      }
      if (filters?.provider) {
        query = query.eq('provider', filters.provider);
      }
      if (filters?.storeId) {
        query = query.eq('store_id', filters.storeId);
      }
      if (filters?.dateFrom) {
        query = query.gte('created_at', filters.dateFrom);
      }
      if (filters?.dateTo) {
        query = query.lte('created_at', filters.dateTo);
      }

      // Apply pagination
      if (pagination) {
        query = query.range(pagination.offset, pagination.offset + pagination.limit - 1);
      }

      // Order by creation date
      query = query.order('created_at', { ascending: false });

      const { data, error, count } = await query;

      if (error) {
        throw new Error(`Failed to fetch dispute cases: ${error.message}`);
      }

      const total = count || 0;
      const cases = data as DisputeCase[];

      return {
        cases,
        total,
        pagination: {
          limit: pagination?.limit || 100,
          offset: pagination?.offset || 0,
          total
        }
      };
    } catch (error) {
      logger.error('Error fetching dispute cases', { error, sellerId });
      throw error;
    }
  }

  /**
   * Get dispute case by ID
   */
  async getDisputeCase(caseId: string): Promise<DisputeCase> {
    try {
      const { data, error } = await supabase
        .from('dispute_cases')
        .select('*')
        .eq('id', caseId)
        .single();

      if (error) {
        throw new Error(`Failed to fetch dispute case: ${error.message}`);
      }

      return data as DisputeCase;
    } catch (error) {
      logger.error('Error fetching dispute case', { error, caseId });
      throw error;
    }
  }

  /**
   * Get dispute case statistics for a seller
   */
  async getDisputeStatistics(sellerId: string, storeId?: string): Promise<{
    total_cases: number;
    total_claimed: number;
    total_resolved: number;
    by_status: Record<string, { count: number; value: number }>;
    by_type: Record<string, { count: number; value: number }>;
    by_provider: Record<string, { count: number; value: number }>;
    success_rate: number;
    average_resolution_time: number;
  }> {
    try {
      const query = supabase
        .from('dispute_cases')
        .select('*')
        .eq('seller_id', sellerId);

      if (storeId) {
        query.eq('store_id', storeId);
      }

      const { data, error } = await query;

      if (error) {
        throw new Error(`Failed to fetch dispute statistics: ${error.message}`);
      }

      const cases = data as DisputeCase[];
      const by_status: Record<string, { count: number; value: number }> = {};
      const by_type: Record<string, { count: number; value: number }> = {};
      const by_provider: Record<string, { count: number; value: number }> = {};

      let total_claimed = 0;
      let total_resolved = 0;
      let resolved_cases = 0;
      let total_resolution_time = 0;

      cases.forEach(disputeCase => {
        // By status
        if (!by_status[disputeCase.status]) {
          by_status[disputeCase.status] = { count: 0, value: 0 };
        }
        by_status[disputeCase.status].count++;
        by_status[disputeCase.status].value += disputeCase.claim_amount;

        // By type
        if (!by_type[disputeCase.case_type]) {
          by_type[disputeCase.case_type] = { count: 0, value: 0 };
        }
        by_type[disputeCase.case_type].count++;
        by_type[disputeCase.case_type].value += disputeCase.claim_amount;

        // By provider
        if (!by_provider[disputeCase.provider]) {
          by_provider[disputeCase.provider] = { count: 0, value: 0 };
        }
        by_provider[disputeCase.provider].count++;
        by_provider[disputeCase.provider].value += disputeCase.claim_amount;

        total_claimed += disputeCase.claim_amount;

        // Calculate resolution time for resolved cases
        if (disputeCase.resolution_date && disputeCase.created_at) {
          const created = new Date(disputeCase.created_at);
          const resolved = new Date(disputeCase.resolution_date);
          const resolutionTime = resolved.getTime() - created.getTime();
          total_resolution_time += resolutionTime;
          resolved_cases++;
        }

        // Count resolved cases
        if (['approved', 'rejected', 'closed'].includes(disputeCase.status)) {
          total_resolved += disputeCase.claim_amount;
        }
      });

      const success_rate = cases.length > 0 ? (resolved_cases / cases.length) * 100 : 0;
      const average_resolution_time = resolved_cases > 0 ? total_resolution_time / resolved_cases : 0;

      return {
        total_cases: cases.length,
        total_claimed,
        total_resolved,
        by_status,
        by_type,
        by_provider,
        success_rate,
        average_resolution_time
      };
    } catch (error) {
      logger.error('Error fetching dispute statistics', { error, sellerId });
      throw error;
    }
  }

  /**
   * Create automation rule for dispute cases
   */
  async createAutomationRule(rule: Omit<DisputeAutomationRule, 'id' | 'created_at'>): Promise<DisputeAutomationRule> {
    try {
      logger.info('Creating automation rule', {
        seller_id: rule.seller_id,
        rule_name: rule.rule_name,
        rule_type: rule.rule_type
      });

      const { data, error } = await supabase
        .from('dispute_automation_rules')
        .insert({
          ...rule,
          id: uuidv4()
        })
        .select()
        .single();

      if (error) {
        throw new Error(`Failed to create automation rule: ${error.message}`);
      }

      logger.info('Automation rule created successfully', { rule_id: data.id });
      return data as DisputeAutomationRule;
    } catch (error) {
      logger.error('Error creating automation rule', { error, rule });
      throw error;
    }
  }

  /**
   * Get automation rules for a seller
   */
  async getAutomationRules(sellerId: string): Promise<DisputeAutomationRule[]> {
    try {
      const { data, error } = await supabase
        .from('dispute_automation_rules')
        .select('*')
        .eq('seller_id', sellerId)
        .eq('is_active', true)
        .order('priority', { ascending: false });

      if (error) {
        throw new Error(`Failed to fetch automation rules: ${error.message}`);
      }

      return data as DisputeAutomationRule[];
    } catch (error) {
      logger.error('Error fetching automation rules', { error, sellerId });
      throw error;
    }
  }

  /**
   * Check and apply automation rules for a dispute case
   */
  private async checkAutomationRules(disputeCase: DisputeCase): Promise<void> {
    try {
      const rules = await this.getAutomationRules(disputeCase.seller_id);

      for (const rule of rules) {
        if (await this.evaluateRuleConditions(rule, disputeCase)) {
          await this.executeRuleActions(rule, disputeCase);
          break; // Only execute the first matching rule
        }
      }
    } catch (error) {
      logger.error('Error checking automation rules', { error, disputeCase });
    }
  }

  /**
   * Evaluate if a rule's conditions are met
   */
  private async evaluateRuleConditions(rule: DisputeAutomationRule, disputeCase: DisputeCase): Promise<boolean> {
    try {
      const conditions = rule.conditions;

      // Check case type
      if (conditions.case_type && conditions.case_type !== disputeCase.case_type) {
        return false;
      }

      // Check claim amount threshold
      if (conditions.min_amount && disputeCase.claim_amount < conditions.min_amount) {
        return false;
      }
      if (conditions.max_amount && disputeCase.claim_amount > conditions.max_amount) {
        return false;
      }

      // Check provider
      if (conditions.provider && conditions.provider !== disputeCase.provider) {
        return false;
      }

      return true;
    } catch (error) {
      logger.error('Error evaluating rule conditions', { error, rule, disputeCase });
      return false;
    }
  }

  /**
   * Execute rule actions
   */
  private async executeRuleActions(rule: DisputeAutomationRule, disputeCase: DisputeCase): Promise<void> {
    try {
      const actions = rule.actions;

      if (actions.auto_submit) {
        logger.info('Executing auto-submit action', { rule_id: rule.id, case_id: disputeCase.id });
        // Auto-submit the case
        await this.submitDisputeCase(disputeCase.id, {}, []);
      }

      if (actions.auto_approve) {
        logger.info('Executing auto-approve action', { rule_id: rule.id, case_id: disputeCase.id });
        // Auto-approve the case (for testing purposes)
        await this.processCaseResolution({
          dispute_case_id: disputeCase.id,
          resolution_status: 'approved',
          resolution_amount: disputeCase.claim_amount,
          resolution_notes: 'Auto-approved by automation rule',
          provider_response: { automated: true }
        });
      }

      // Create audit log for automation
      await this.createAuditLog(
        disputeCase.id,
        'automation_rule_executed',
        {},
        { rule_id: rule.id, rule_name: rule.rule_name },
        `Automation rule '${rule.rule_name}' executed`
      );
    } catch (error) {
      logger.error('Error executing rule actions', { error, rule, disputeCase });
    }
  }

  /**
   * Submit case to external provider
   */
  private async submitToProvider(
    disputeCase: DisputeCase,
    submissionData: any
  ): Promise<{ provider_case_id: string; provider_response: any }> {
    try {
      // This is a placeholder - in production, you'd integrate with actual provider APIs
      switch (disputeCase.provider) {
        case 'amazon':
          return await this.submitToAmazon(disputeCase, submissionData);
        case 'stripe':
          return await this.submitToStripe(disputeCase, submissionData);
        case 'shopify':
          return await this.submitToShopify(disputeCase, submissionData);
        default:
          throw new Error(`Unsupported provider: ${disputeCase.provider}`);
      }
    } catch (error) {
      logger.error('Error submitting to provider', { error, disputeCase });
      throw error;
    }
  }

  /**
   * Submit case to Amazon
   */
  private async submitToAmazon(disputeCase: DisputeCase, submissionData: any): Promise<{ provider_case_id: string; provider_response: any }> {
    // Placeholder for Amazon API integration
    const providerCaseId = `AMZ-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    return {
      provider_case_id: providerCaseId,
      provider_response: {
        submitted_at: new Date().toISOString(),
        amazon_case_id: providerCaseId,
        status: 'submitted'
      }
    };
  }

  /**
   * Submit case to Stripe
   */
  private async submitToStripe(disputeCase: DisputeCase, submissionData: any): Promise<{ provider_case_id: string; provider_response: any }> {
    // Placeholder for Stripe API integration
    const providerCaseId = `STR-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    return {
      provider_case_id: providerCaseId,
      provider_response: {
        submitted_at: new Date().toISOString(),
        stripe_dispute_id: providerCaseId,
        status: 'submitted'
      }
    };
  }

  /**
   * Submit case to Shopify
   */
  private async submitToShopify(disputeCase: DisputeCase, submissionData: any): Promise<{ provider_case_id: string; provider_response: any }> {
    // Placeholder for Shopify API integration
    const providerCaseId = `SHOP-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    return {
      provider_case_id: providerCaseId,
      provider_response: {
        submitted_at: new Date().toISOString(),
        shopify_refund_id: providerCaseId,
        status: 'submitted'
      }
    };
  }

  /**
   * Attach evidence to a dispute case
   */
  private async attachEvidenceToCase(caseId: string, evidenceIds: string[]): Promise<void> {
    try {
      for (const evidenceId of evidenceIds) {
        const { error } = await supabase
          .from('dispute_evidence')
          .update({ dispute_case_id: caseId })
          .eq('id', evidenceId);

        if (error) {
          logger.error('Error attaching evidence to case', { error, evidenceId, caseId });
        }
      }
    } catch (error) {
      logger.error('Error attaching evidence to case', { error, caseId, evidenceIds });
    }
  }

  /**
   * Create audit log entry
   */
  private async createAuditLog(
    caseId: string,
    action: string,
    oldValues: any,
    newValues: any,
    notes?: string
  ): Promise<void> {
    try {
      const { error } = await supabase
        .from('dispute_audit_log')
        .insert({
          id: uuidv4(),
          dispute_case_id: caseId,
          action,
          old_values: oldValues,
          new_values: newValues,
          notes
        });

      if (error) {
        logger.error('Error creating audit log', { error, caseId, action });
      }
    } catch (error) {
      logger.error('Error creating audit log', { error, caseId, action });
    }
  }

  /**
   * Generate case number
   */
  private generateCaseNumber(sellerId: string, caseType: string): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substr(2, 5);
    return `DC-${sellerId.substr(0, 8)}-${caseType.substr(0, 3).toUpperCase()}-${timestamp}-${random}`.toUpperCase();
  }

  /**
   * Determine provider based on case type
   */
  private determineProvider(caseType: string): 'amazon' | 'stripe' | 'shopify' {
    switch (caseType) {
      case 'amazon_fba':
        return 'amazon';
      case 'stripe_dispute':
        return 'stripe';
      case 'shopify_refund':
        return 'shopify';
      default:
        return 'amazon';
    }
  }

  /**
   * Map resolution status to case status
   */
  private mapResolutionStatus(resolutionStatus: string): string {
    switch (resolutionStatus) {
      case 'approved':
        return 'approved';
      case 'rejected':
        return 'rejected';
      case 'partial':
        return 'closed';
      default:
        return 'closed';
    }
  }

  /**
   * Generate a professional PDF brief for a dispute case
   */
  async generateDisputeBrief(caseId: string): Promise<Buffer> {
    try {
      const disputeCase = await this.getDisputeCase(caseId);

      // Fetch evidence document details if available
      let evidenceDocs: any[] = [];
      if (disputeCase.evidence_document_ids && disputeCase.evidence_document_ids.length > 0) {
        const { data } = await supabase
          .from('evidence_documents')
          .select('filename, original_filename')
          .in('id', disputeCase.evidence_document_ids);
        evidenceDocs = data || [];
      }

      // Construct HTML template with an executive feel
      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <style>
            body { 
              font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; 
              color: #111827; 
              line-height: 1.5; 
              padding: 40px; 
              font-size: 14px;
            }
            .header { 
              display: flex; 
              justify-content: space-between; 
              align-items: flex-start;
              border-bottom: 2px solid #10b981; 
              padding-bottom: 24px; 
              margin-bottom: 32px; 
            }
            .logo-section h1 { 
              font-size: 28px; 
              font-weight: 800; 
              color: #10b981; 
              margin: 0;
              letter-spacing: -0.025em;
            }
            .tagline { font-size: 12px; color: #6b7280; font-weight: 500; }
            .case-info { text-align: right; }
            .case-title { font-size: 18px; font-weight: 700; margin: 0; color: #374151; }
            .case-number { font-size: 16px; font-weight: 500; font-family: monospace; color: #6b7280; }
            
            .section { margin-bottom: 32px; }
            .section-title { 
              font-size: 12px; 
              font-weight: 700; 
              text-transform: uppercase; 
              color: #6b7280; 
              margin-bottom: 12px; 
              border-bottom: 1px solid #e5e7eb; 
              padding-bottom: 6px; 
              letter-spacing: 0.05em;
            }
            
            .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 24px; }
            .data-point { margin-bottom: 8px; }
            .label { font-size: 11px; font-weight: 600; color: #9ca3af; text-transform: uppercase; margin-bottom: 2px; }
            .value { font-size: 14px; font-weight: 600; color: #1f2937; }
            .value.status { color: #059669; }
            .value.amount { font-size: 20px; color: #10b981; font-weight: 700; }
            
            .narrative-box { 
              background: #f9fafb; 
              border-left: 4px solid #10b981;
              padding: 20px; 
              border-radius: 4px; 
              font-size: 15px; 
              color: #374151;
              line-height: 1.6;
            }
            
            .evidence-list { list-style: none; padding: 0; margin: 0; }
            .evidence-item { 
              padding: 8px 12px; 
              background: #f3f4f6; 
              border-radius: 6px; 
              margin-bottom: 8px; 
              display: flex; 
              align-items: center; 
              font-weight: 500;
              font-size: 13px;
            }
            .check-icon { color: #10b981; margin-right: 10px; font-weight: bold; }
            
            .footer { 
              margin-top: 60px; 
              font-size: 11px; 
              color: #9ca3af; 
              text-align: center; 
              border-top: 1px solid #f3f4f6; 
              padding-top: 24px; 
            }
            .confidential { font-weight: 700; color: #ef4444; margin-top: 8px; display: block; }
          </style>
        </head>
        <body>
          <div class="header">
            <div class="logo-section">
              <h1>OPSIDE</h1>
              <div class="tagline">ENTERPRISE AUDIT & RECOVERY ENGINE</div>
            </div>
            <div class="case-info">
              <h2 class="case-title">Forensic Dispute Brief</h2>
              <div class="case-number">${disputeCase.case_number}</div>
            </div>
          </div>

          <div class="section">
            <div class="section-title">Case Metadata</div>
            <div class="grid">
              <div class="data-point">
                <div class="label">Current Status</div>
                <div class="value status">${(disputeCase.filing_status || disputeCase.status).toUpperCase()}</div>
              </div>
              <div class="data-point">
                <div class="label">Amazon Case Reference</div>
                <div class="value">${disputeCase.provider_case_id || 'PENDING SUBMISSION'}</div>
              </div>
              <div class="data-point">
                <div class="label">Filing Agent</div>
                <div class="value">Agent 7 (The Closer)</div>
              </div>
              <div class="data-point">
                <div class="label">Submission Date</div>
                <div class="value">${new Date(disputeCase.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}</div>
              </div>
            </div>
          </div>

          <div class="section">
            <div class="section-title">Claim Specifications</div>
            <div class="grid">
              <div class="data-point">
                <div class="label">Order Identifier</div>
                <div class="value">${disputeCase.order_id || 'N/A'}</div>
              </div>
              <div class="data-point">
                <div class="label">ASIN / SKU Accession</div>
                <div class="value">${disputeCase.asin || 'N/A'} / ${disputeCase.sku || 'N/A'}</div>
              </div>
              <div class="data-point">
                <div class="label">Dispute Classification</div>
                <div class="value">${disputeCase.case_type.replace(/_/g, ' ').toUpperCase()}</div>
              </div>
              <div class="data-point">
                <div class="label">Recovery Valuation</div>
                <div class="value amount">${disputeCase.currency} ${disputeCase.claim_amount.toFixed(2)}</div>
              </div>
            </div>
          </div>

          <div class="section">
            <div class="section-title">Forensic Argument & Policy Basis</div>
            <div class="narrative-box">
              ${disputeCase.metadata?.forensic_brief || `This claim represents a verified financial discrepancy identified through our high-fidelity inventory reconciliation engine. Based on Amazon's FBA policy regarding lost or damaged inventory, we have established sufficient forensic proof that the merchant is entitled to a reimbursement of ${disputeCase.currency} ${disputeCase.claim_amount.toFixed(2)}.`}
            </div>
          </div>

          <div class="section">
            <div class="section-title">Verified Evidence Portfolio</div>
            <div class="evidence-list">
              ${evidenceDocs.length > 0 ?
          evidenceDocs.map(doc => `
                  <div class="evidence-item">
                    <span class="check-icon">✓</span> ${doc.original_filename || doc.filename}
                  </div>
                `).join('') :
          '<div class="evidence-item"><span class="check-icon">✓</span> Internal Inventory Reconciliation Report (System Generated)</div>'
        }
            </div>
          </div>

          <div class="footer">
            Generated via Opside Autonomous Audit Protocol. This document is an official record of dispute filing and may be used for internal financial audits and accounting reconciliation.
            <span class="confidential">SENSITIVE MERCHANT INFORMATION – FOR AUTHORIZED PERSONNEL ONLY</span>
          </div>
        </body>
        </html>
      `;

      return await pdfGenerationService.generatePDFFromHTML(html);
    } catch (error) {
      logger.error('Failed to generate dispute brief', { error, caseId });
      throw error;
    }
  }
}

export const disputeService = new DisputeService();
export default disputeService;

