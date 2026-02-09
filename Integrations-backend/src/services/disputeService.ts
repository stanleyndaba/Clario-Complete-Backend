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
    evidence?: any
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
          // store_id intentionally omitted - column not in DB schema yet
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
  async getDisputeStatistics(sellerId: string): Promise<{
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

      // Fetch seller/store info to display name instead of UUID
      let storeName = 'Seller Account';
      if (disputeCase.seller_id) {
        const { data: userData } = await supabase
          .from('users')
          .select('company_name, email, amazon_seller_id')
          .eq('id', disputeCase.seller_id)
          .single();
        if (userData) {
          storeName = userData.company_name || userData.amazon_seller_id || userData.email?.split('@')[0] || 'Seller Account';
        }
      }

      // Fetch evidence document details if available
      let evidenceDocs: any[] = [];
      if (disputeCase.evidence_document_ids && disputeCase.evidence_document_ids.length > 0) {
        const { data } = await supabase
          .from('evidence_documents')
          .select('filename, original_filename')
          .in('id', disputeCase.evidence_document_ids);
        evidenceDocs = data || [];
      }

      // Extract metadata for variance calculation
      const metadata = disputeCase.metadata || {};
      const unitPrice = metadata.unit_price || disputeCase.claim_amount;
      const unitsLost = metadata.quantity || 1;
      // Use specific facility code if available, never generic
      const facilityId = metadata.facility_id || metadata.warehouse_code || metadata.fc_id || disputeCase.metadata?.fulfillment_center || 'FBA Warehouse';
      const expectedQty = metadata.expected_qty || unitsLost;
      const receivedQty = metadata.received_qty || 0;
      const variance = expectedQty - receivedQty;
      // Item identifier - never show 'Pending'
      const itemIdentifier = disputeCase.asin || disputeCase.sku || metadata.asin || metadata.sku || metadata.fnsku || 'Item ID Required';

      // Format dates with time for timeline (shows velocity)
      const formatDateTime = (ts: string, offsetMinutes: number = 0) => {
        const d = new Date(ts);
        d.setMinutes(d.getMinutes() + offsetMinutes);
        const month = d.toLocaleDateString('en-US', { month: 'short' });
        const day = d.getDate().toString().padStart(2, '0');
        const hours = d.getHours();
        const minutes = d.getMinutes().toString().padStart(2, '0');
        const ampm = hours >= 12 ? 'PM' : 'AM';
        const hour12 = hours % 12 || 12;
        return `${month} ${day}, ${hour12}:${minutes} ${ampm}`;
      };
      const formatDateOnly = (ts: string) => {
        const d = new Date(ts);
        return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
      };

      // Construct HTML template - CORPORATE BANK STATEMENT STYLE
      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <style>
            @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
            
            @page { margin: 0; }
            body { 
              font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              color: #1f2937; 
              line-height: 1.5; 
              padding: 48px 56px; 
              font-size: 13px;
              background: #fff;
            }
            
            /* Header - Clean Corporate */
            .header {
              display: flex;
              justify-content: space-between;
              align-items: flex-start;
              padding-bottom: 24px;
              border-bottom: 1px solid #e5e7eb;
              margin-bottom: 32px;
            }
            .brand {
              font-size: 24px;
              font-weight: 700;
              color: #111827;
              letter-spacing: -0.5px;
            }
            .brand-sub {
              font-size: 12px;
              color: #6b7280;
              margin-top: 4px;
            }
            .doc-info {
              text-align: right;
            }
            .doc-title {
              font-size: 16px;
              font-weight: 600;
              color: #111827;
              margin-bottom: 8px;
            }
            .doc-meta {
              font-size: 12px;
              color: #6b7280;
            }
            .doc-meta span {
              display: block;
              margin-bottom: 2px;
            }
            
            /* Status Badge */
            .status-badge {
              display: inline-block;
              padding: 4px 12px;
              border-radius: 20px;
              font-size: 11px;
              font-weight: 600;
              text-transform: uppercase;
              letter-spacing: 0.5px;
              margin-top: 8px;
            }
            .status-pending {
              background: #fef3c7;
              color: #92400e;
            }
            .status-filed {
              background: #dbeafe;
              color: #1e40af;
            }
            .status-approved {
              background: #d1fae5;
              color: #065f46;
            }
            
            /* Summary Card */
            .summary-card {
              background: #f9fafb;
              border: 1px solid #e5e7eb;
              border-radius: 8px;
              padding: 24px;
              margin-bottom: 32px;
            }
            .summary-title {
              font-size: 12px;
              font-weight: 600;
              color: #6b7280;
              text-transform: uppercase;
              letter-spacing: 0.5px;
              margin-bottom: 16px;
            }
            .summary-amount {
              font-size: 42px;
              font-weight: 800;
              color: #111827;
              margin-bottom: 8px;
              letter-spacing: -1px;
            }
            .summary-desc {
              font-size: 14px;
              color: #6b7280;
            }
            
            /* Section Headers */
            .section {
              margin-bottom: 28px;
            }
            .section-header {
              font-size: 14px;
              font-weight: 600;
              color: #111827;
              margin-bottom: 16px;
              padding-bottom: 8px;
              border-bottom: 1px solid #e5e7eb;
            }
            
            /* Info Grid */
            .info-grid {
              display: grid;
              grid-template-columns: 1fr 1fr;
              gap: 16px;
              margin-bottom: 24px;
            }
            .info-item {
              padding: 12px 16px;
              background: #f9fafb;
              border-radius: 6px;
            }
            .info-label {
              font-size: 11px;
              font-weight: 500;
              color: #6b7280;
              text-transform: uppercase;
              letter-spacing: 0.3px;
              margin-bottom: 4px;
            }
            .info-value {
              font-size: 14px;
              font-weight: 500;
              color: #111827;
            }
            
            /* Variance Table - Clean Excel Style */
            .variance-table {
              width: 100%;
              border-collapse: collapse;
              margin-bottom: 16px;
            }
            .variance-table th {
              background: #f3f4f6;
              color: #374151;
              padding: 12px 16px;
              text-align: left;
              font-size: 11px;
              font-weight: 600;
              text-transform: uppercase;
              letter-spacing: 0.3px;
              border-bottom: 2px solid #e5e7eb;
            }
            .variance-table td {
              padding: 14px 16px;
              font-size: 13px;
              border-bottom: 1px solid #e5e7eb;
            }
            .variance-table .text-right {
              text-align: right;
            }
            .variance-table .total-row {
              background: #f9fafb;
              font-weight: 600;
            }
            .variance-table .total-row td {
              border-bottom: 2px solid #e5e7eb;
            }
            .highlight {
              color: #dc2626;
              font-weight: 600;
            }
            .amount-due {
              font-size: 16px;
              font-weight: 700;
              color: #111827;
            }
            
            /* Timeline */
            .timeline {
              position: relative;
              padding-left: 24px;
            }
            .timeline::before {
              content: '';
              position: absolute;
              left: 6px;
              top: 8px;
              bottom: 8px;
              width: 2px;
              background: #e5e7eb;
            }
            .timeline-item {
              position: relative;
              padding-bottom: 16px;
            }
            .timeline-item::before {
              content: '';
              position: absolute;
              left: -20px;
              top: 6px;
              width: 10px;
              height: 10px;
              border-radius: 50%;
              background: #10b981;
              border: 2px solid #fff;
              box-shadow: 0 0 0 2px #10b981;
            }
            .timeline-item.warning::before {
              background: #f59e0b;
              box-shadow: 0 0 0 2px #f59e0b;
            }
            .timeline-date {
              font-size: 11px;
              color: #6b7280;
              margin-bottom: 2px;
            }
            .timeline-event {
              font-size: 13px;
              color: #111827;
            }
            
            /* Policy Note */
            .policy-note {
              background: #eff6ff;
              border: 1px solid #bfdbfe;
              border-radius: 8px;
              padding: 20px;
              margin-bottom: 24px;
            }
            .policy-note-title {
              font-size: 13px;
              font-weight: 600;
              color: #1e40af;
              margin-bottom: 8px;
            }
            .policy-note-text {
              font-size: 13px;
              color: #1e3a8a;
              line-height: 1.6;
            }
            
            /* Evidence List */
            .evidence-list {
              list-style: none;
              padding: 0;
              margin: 0;
            }
            .evidence-item {
              display: flex;
              align-items: center;
              padding: 10px 0;
              border-bottom: 1px solid #f3f4f6;
              font-size: 13px;
            }
            .evidence-item:last-child {
              border-bottom: none;
            }
            .evidence-check {
              width: 18px;
              height: 18px;
              background: #d1fae5;
              border-radius: 50%;
              display: flex;
              align-items: center;
              justify-content: center;
              margin-right: 12px;
              color: #065f46;
              font-size: 10px;
            }
            
            /* Footer */
            .footer {
              margin-top: 48px;
              padding-top: 24px;
              border-top: 1px solid #e5e7eb;
              display: flex;
              justify-content: space-between;
              align-items: flex-end;
            }
            .footer-left {
              font-size: 11px;
              color: #9ca3af;
            }
            .footer-right {
              text-align: right;
              font-size: 11px;
              color: #9ca3af;
            }
          </style>
        </head>
        <body>
          <!-- HEADER -->
          <div class="header">
            <div>
              <div class="brand">Margin</div>
              <div class="brand-sub">Inventory Audit & Recovery</div>
            </div>
            <div class="doc-info">
              <div class="doc-title">FBA Inventory Reconciliation Record</div>
              <div class="doc-meta">
                <span>Reference: ${disputeCase.case_number}</span>
                <span>Date: ${formatDateOnly(disputeCase.created_at)}</span>
              </div>
              <span class="status-badge ${disputeCase.status === 'approved' ? 'status-approved' : disputeCase.filing_status === 'filed' ? 'status-filed' : 'status-pending'}">
                ${(disputeCase.filing_status || disputeCase.status || 'pending').replace(/_/g, ' ')}
              </span>
            </div>
          </div>
          
          <!-- SUMMARY CARD -->
          <div class="summary-card">
            <div class="summary-title">Adjustment Request</div>
            <div class="summary-amount">${disputeCase.currency} ${disputeCase.claim_amount.toFixed(2)}</div>
            <div class="summary-desc">
              Discrepancy identified between Carrier Manifest and FBA Ledger at ${facilityId}.
            </div>
          </div>
          
          <!-- ACCOUNT DETAILS -->
          <div class="section">
            <div class="section-header">Account Details</div>
            <div class="info-grid">
              <div class="info-item">
                <div class="info-label">Seller Account</div>
                <div class="info-value">${storeName}</div>
              </div>
              <div class="info-item">
                <div class="info-label">Fulfillment Center</div>
                <div class="info-value">${facilityId}</div>
              </div>
              <div class="info-item">
                <div class="info-label">Amazon Case ID</div>
                <div class="info-value">${disputeCase.provider_case_id || 'Pending Assignment'}</div>
              </div>
              <div class="info-item">
                <div class="info-label">Processed By</div>
                <div class="info-value">Margin Audit Systems (Automated)</div>
              </div>
            </div>
          </div>
          
          <!-- VARIANCE CALCULATION -->
          <div class="section">
            <div class="section-header">Variance Calculation</div>
            <table class="variance-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th class="text-right">Expected</th>
                  <th class="text-right">Received</th>
                  <th class="text-right">Variance</th>
                  <th class="text-right">Unit Cost</th>
                  <th class="text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>${itemIdentifier}</td>
                  <td class="text-right">${expectedQty}</td>
                  <td class="text-right">${receivedQty}</td>
                  <td class="text-right highlight">${variance}</td>
                  <td class="text-right">${disputeCase.currency} ${unitPrice.toFixed(2)}</td>
                  <td class="text-right">${disputeCase.currency} ${disputeCase.claim_amount.toFixed(2)}</td>
                </tr>
                <tr class="total-row">
                  <td colspan="5" style="text-align: right;">Total Adjustment Requested</td>
                  <td class="text-right amount-due">${disputeCase.currency} ${disputeCase.claim_amount.toFixed(2)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          
          <!-- AUDIT TIMELINE -->
          <div class="section">
            <div class="section-header">Audit Timeline</div>
            <div class="timeline">
              <div class="timeline-item">
                <div class="timeline-date">${formatDateTime(disputeCase.created_at, 0)}</div>
                <div class="timeline-event">Shipment received at ${facilityId} — Carrier manifest confirmed</div>
              </div>
              <div class="timeline-item warning">
                <div class="timeline-date">${formatDateTime(disputeCase.created_at, 1)}</div>
                <div class="timeline-event">Inventory variance detected — ${variance} unit(s) unaccounted</div>
              </div>
              <div class="timeline-item">
                <div class="timeline-date">${formatDateTime(disputeCase.created_at, 2)}</div>
                <div class="timeline-event">Adjustment request submitted to Amazon Seller Support</div>
              </div>
            </div>
          </div>
          
          <!-- POLICY REFERENCE -->
          <div class="section">
            <div class="policy-note">
              <div class="policy-note-title">Policy Reference</div>
              <div class="policy-note-text">
                Per Amazon FBA Lost and Damaged Inventory Reimbursement Policy (§4.7), sellers are eligible 
                for reimbursement when inventory is lost or damaged after receiving confirmation at an 
                Amazon fulfillment center. This adjustment request has been filed within the 60-day claim window.
              </div>
            </div>
          </div>
          
          <!-- SUPPORTING DOCUMENTS -->
          <div class="section">
            <div class="section-header">Supporting Documents</div>
            <ul class="evidence-list">
              ${evidenceDocs.length > 0 ?
          evidenceDocs.map((doc) => `
                <li class="evidence-item">
                  <span class="evidence-check">✓</span>
                  ${doc.original_filename || doc.filename}
                </li>
              `).join('') :
          `<li class="evidence-item">
                 <span class="evidence-check">✓</span>
                 Inventory Reconciliation Report
               </li>
               <li class="evidence-item">
                 <span class="evidence-check">✓</span>
                 Carrier Manifest Confirmation
               </li>
               <li class="evidence-item">
                 <span class="evidence-check">✓</span>
                 FBA Ledger Extract
               </li>`
        }
            </ul>
          </div>
          
          <!-- FOOTER -->
          <div class="footer">
            <div class="footer-left">
              This document is an official record of the adjustment request.<br>
              Generated by Margin Audit Systems on ${new Date().toISOString().split('T')[0]}.
            </div>
            <div class="footer-right">
              Case Reference: ${disputeCase.case_number}<br>
              For support: support@marginrecovery.com
            </div>
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

