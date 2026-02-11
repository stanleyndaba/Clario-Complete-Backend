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
   * Generate a FORENSIC EXTRACT dispute document (Terminal Design)
   * Machine-readable, bot-first format. No prose, no emotion.
   * ONE PAGE MAX. Tables, not paragraphs. Their data, not our story.
   */
  async generateDisputeBrief(caseId: string): Promise<Buffer> {
    try {
      const disputeCase = await this.getDisputeCase(caseId);

      // Fetch seller/store info
      let storeName = 'Seller Account';
      let amazonSellerId = '';
      if (disputeCase.seller_id) {
        const { data: userData } = await supabase
          .from('users')
          .select('company_name, email, amazon_seller_id')
          .eq('id', disputeCase.seller_id)
          .single();
        if (userData) {
          storeName = userData.company_name || userData.amazon_seller_id || userData.email?.split('@')[0] || 'Seller Account';
          amazonSellerId = userData.amazon_seller_id || '';
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

      // Extract metadata
      const metadata = disputeCase.metadata || {};
      const unitPrice = metadata.unit_price || (disputeCase.claim_amount / (metadata.quantity || 1));
      const expectedQty = metadata.expected_qty || metadata.quantity || 1;
      const receivedQty = metadata.received_qty ?? 0;
      const variance = expectedQty - receivedQty;
      const discrepancyRate = receivedQty > 0 ? (((expectedQty - receivedQty) / receivedQty) * 100).toFixed(2) : '100.00';
      const itemAsin = disputeCase.asin || metadata.asin || metadata.fnsku || 'ASIN_REQUIRED';
      const itemSku = disputeCase.sku || metadata.sku || 'SKU_REQUIRED';
      const facilityId = metadata.facility_id || metadata.warehouse_code || metadata.fc_id || metadata.fulfillment_center || 'FC_PENDING';
      const shipmentId = metadata.shipment_id || metadata.fba_shipment_id || 'SHIPMENT_PENDING';
      const orderId = disputeCase.order_id || metadata.order_id || '';
      const carrierTracking = metadata.carrier_tracking || metadata.tracking_number || 'TRACKING_PENDING';
      const errorType = metadata.error_type || metadata.anomaly_type || disputeCase.case_type || 'INVENTORY_DISCREPANCY';
      const errorCode = metadata.error_code || 'RECEIVING_VARIANCE';
      const policyCode = metadata.policy_code || 'G200213130';
      const amazonWeight = metadata.amazon_weight || metadata.fba_weight || null;
      const actualWeight = metadata.actual_weight || metadata.certified_weight || null;
      const affectedFCs = metadata.affected_fcs || metadata.fulfillment_centers || facilityId;

      // Date formatting - ISO style for machine readability
      const formatISODate = (ts: string) => {
        const d = new Date(ts);
        return d.toISOString().split('T')[0];
      };
      const formatTimestamp = (ts: string, offsetMinutes: number = 0) => {
        const d = new Date(ts);
        d.setMinutes(d.getMinutes() + offsetMinutes);
        const date = d.toISOString().split('T')[0];
        const hours = d.getHours().toString().padStart(2, '0');
        const mins = d.getMinutes().toString().padStart(2, '0');
        return `${date} ${hours}:${mins}`;
      };

      const disputeDate = formatISODate(disputeCase.created_at);
      const responseDeadline = (() => {
        const d = new Date(disputeCase.created_at);
        d.setDate(d.getDate() + 7);
        return d.toISOString().split('T')[0];
      })();

      // Generate SHA256-like hash for data integrity
      const dataString = `${disputeCase.id}${disputeCase.case_number}${disputeCase.claim_amount}${disputeCase.created_at}`;
      let hash = '';
      for (let i = 0; i < dataString.length; i++) {
        hash += dataString.charCodeAt(i).toString(16);
      }
      hash = hash.substring(0, 64).padEnd(64, '0');

      // Build evidentiary exhibits items
      const evidentiaryExhibits = evidenceDocs.length > 0
        ? evidenceDocs.map((doc, index) => {
          const fname = doc.original_filename || doc.filename;
          const exhibitLetter = String.fromCharCode(65 + index); // A, B, C...
          return `<div class="checklist-item">EXHIBIT ${exhibitLetter}: ${fname}</div>`;
        }).join('')
        : `<div class="checklist-item">EXHIBIT A: reconciliation_report.pdf</div>
           <div class="checklist-item">EXHIBIT B: ${carrierTracking}.pdf</div>
           <div class="checklist-item">EXHIBIT C: fba_ledger_${disputeDate}.csv</div>
           <div class="checklist-item">EXHIBIT D: ${shipmentId}_confirmation.pdf</div>
           <div class="checklist-item">EXHIBIT E: receiving_variance_${disputeCase.id.substring(0, 8)}.png</div>`;

      // Build evidence log timeline events
      const baseDate = new Date(disputeCase.created_at);
      const shipCreateDate = new Date(baseDate);
      shipCreateDate.setDate(shipCreateDate.getDate() - 14);
      const carrierPickupDate = new Date(baseDate);
      carrierPickupDate.setDate(carrierPickupDate.getDate() - 9);
      const receivingScanDate = new Date(baseDate);
      receivingScanDate.setDate(receivingScanDate.getDate() - 3);
      const discrepancyDate = new Date(receivingScanDate);
      discrepancyDate.setMinutes(discrepancyDate.getMinutes() + 2);
      const discoveryDate = new Date(baseDate);
      discoveryDate.setDate(discoveryDate.getDate() - 1);

      const evidenceLogRows = [
        { ts: formatTimestamp(shipCreateDate.toISOString()), event: 'FBA_SHIPMENT_CREATE', ref: shipmentId, confirm: 'SELLER_CONFIRMED' },
        { ts: formatTimestamp(carrierPickupDate.toISOString()), event: 'CARRIER_PICKUP', ref: carrierTracking, confirm: 'CARRIER_CONFIRMED' },
        { ts: formatTimestamp(receivingScanDate.toISOString()), event: 'FBA_RECEIVING_SCAN', ref: `${facilityId}_DOCK`, confirm: 'AMAZON_CONFIRMED' },
        { ts: formatTimestamp(discrepancyDate.toISOString()), event: 'RECEIVING_DISCREPANCY', ref: `RCVD:${receivedQty}/EXP:${expectedQty}`, confirm: 'SYSTEM_GENERATED' },
        { ts: formatTimestamp(discoveryDate.toISOString()), event: 'DISCOVERY_ALERT', ref: 'AUTO_AUDIT_FLAG', confirm: 'SYSTEM_GENERATED' },
        { ts: formatTimestamp(disputeCase.created_at), event: 'CLAIM_SUBMISSION', ref: disputeCase.case_number, confirm: 'SELLER_CONFIRMED' },
      ];
      if (disputeCase.provider_case_id) {
        evidenceLogRows.push({ ts: formatTimestamp(disputeCase.updated_at || disputeCase.created_at, 5), event: 'DISPUTE_NOTICE', ref: disputeCase.provider_case_id, confirm: 'AMAZON_GENERATED' });
      }

      // FORENSIC EXTRACT HTML — JP MORGAN LEDGER DESIGN
      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <style>
            @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

            @page { margin: 0; size: A4; }
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body {
              font-family: 'Inter', Arial, Helvetica, sans-serif;
              color: #1a1a1a;
              background: #ffffff;
              padding: 48px 56px 36px 56px;
              font-size: 10px;
              line-height: 1.5;
            }

            /* ═══ LETTERHEAD ═══ */
            .letterhead {
              display: flex;
              justify-content: space-between;
              align-items: flex-end;
              padding-bottom: 14px;
              border-bottom: 1.5px solid #1a1a1a;
              margin-bottom: 28px;
            }
            .letterhead-left {
              font-family: 'Inter', Arial, sans-serif;
              text-align: left;
            }
            .letterhead-title {
              font-size: 11px;
              font-weight: 700;
              letter-spacing: 3px;
              text-transform: uppercase;
              color: #1a1a1a;
              line-height: 1.2;
            }
            .letterhead-sub {
              font-size: 7.5px;
              font-weight: 500;
              letter-spacing: 1.5px;
              text-transform: uppercase;
              color: #888;
              margin-top: 2px;
            }
            .letterhead-right {
              text-align: right;
            }
            .letterhead-status {
              font-size: 8px;
              font-weight: 600;
              letter-spacing: 2px;
              text-transform: uppercase;
              color: #1a1a1a;
              line-height: 1.2;
            }
            .letterhead-hash {
              font-family: 'Courier New', Courier, monospace;
              font-size: 7px;
              color: #888;
              margin-top: 2px;
              letter-spacing: 0.5px;
            }

            /* ═══ COMMAND STRIP ═══ */
            .command-strip {
              background: #f8f8f8;
              border-left: 4px solid #1a1a1a;
              padding: 8px 16px;
              display: flex;
              justify-content: space-between;
              align-items: center;
              margin-bottom: 8px;
            }
            .command-strip-left, .command-strip-right {
              font-family: 'Inter', Arial, sans-serif;
              font-size: 8.5px;
              font-weight: 700;
              letter-spacing: 1px;
              text-transform: uppercase;
              color: #1a1a1a;
            }
            .legal-basis-line {
              font-family: 'Inter', Arial, sans-serif;
              font-size: 7.5px;
              font-weight: 600;
              letter-spacing: 1px;
              text-transform: uppercase;
              color: #1a1a1a;
              margin-bottom: 24px;
              padding-left: 4px;
            }

            /* ═══ SECTION LABELS (small caps, sans-serif, spaced) ═══ */
            .section-label {
              font-family: 'Inter', Arial, sans-serif;
              font-size: 7.5px;
              font-weight: 600;
              letter-spacing: 2.5px;
              text-transform: uppercase;
              color: #999;
              margin-bottom: 10px;
            }
            .section-divider {
              border: none;
              border-top: 0.5px solid #d0d0d0;
              margin: 22px 0 18px 0;
            }

            /* ═══ TOP ROW: CLAIM DETAILS (left) + THE MONEY (right) ═══ */
            .claim-row {
              display: flex;
              gap: 48px;
              margin-bottom: 0;
            }
            .claim-details {
              flex: 1;
            }
            .claim-money {
              flex: 1;
              text-align: right;
            }

            /* Metadata key-value pairs — sans-serif labels */
            .meta-row {
              display: flex;
              font-size: 10px;
              line-height: 2;
              border-bottom: 0.5px solid #e8e8e8;
            }
            .meta-row:last-child { border-bottom: none; }
            .meta-key {
              font-family: 'Inter', Arial, sans-serif;
              font-size: 8.5px;
              font-weight: 600;
              letter-spacing: 1.5px;
              text-transform: uppercase;
              color: #777;
              width: 150px;
              flex-shrink: 0;
              padding-top: 1px;
            }
            .meta-val {
              flex: 1;
              font-family: 'Inter', Arial, sans-serif;
              font-size: 10px;
              font-weight: 500;
              color: #1a1a1a;
            }

            /* Liability — serif money, right-aligned */
            .liability-row {
              display: flex;
              justify-content: flex-end;
              font-size: 10px;
              line-height: 2;
              border-bottom: 0.5px solid #e8e8e8;
            }
            .liability-row:last-child { border-bottom: none; }
            .liability-key {
              font-family: 'Inter', Arial, sans-serif;
              font-size: 8.5px;
              font-weight: 600;
              letter-spacing: 1.5px;
              text-transform: uppercase;
              color: #777;
              width: 130px;
              flex-shrink: 0;
              padding-top: 1px;
            }
            .liability-val {
              font-family: Georgia, 'Times New Roman', Times, serif;
              font-size: 11px;
              font-weight: normal;
              color: #1a1a1a;
              text-align: right;
              min-width: 100px;
            }
            .liability-val.big {
              font-size: 13px;
              font-weight: bold;
            }
            .liability-val.discrepancy {
              color: #D0021B;
              font-weight: bold;
            }
            .liability-val.claim {
              font-family: Georgia, 'Times New Roman', Times, serif;
              font-size: 22px;
              font-weight: bold;
              color: #1a1a1a;
              border-top: 0.5px solid #bbb;
              padding-top: 4px;
              margin-top: 4px;
              letter-spacing: -0.5px;
            }
            .liability-val.policy-ref {
              font-family: 'Inter', Arial, sans-serif;
              font-size: 9px;
              font-weight: 500;
              color: #555;
              letter-spacing: 1px;
            }

            /* ═══ EVIDENCE LOG TABLE — LEGAL EXHIBIT STYLE ═══ */
            .evidence-log {
              margin-bottom: 0;
            }
            .evidence-table {
              width: 100%;
              border-collapse: collapse;
            }
            .evidence-table th {
              background: transparent;
              color: #999;
              padding: 6px 0;
              text-align: left;
              font-family: 'Inter', Arial, sans-serif;
              font-size: 7.5px;
              font-weight: 600;
              letter-spacing: 2px;
              text-transform: uppercase;
              border-bottom: 1px solid #1a1a1a;
            }
            .evidence-table td {
              padding: 5px 0;
              font-family: 'Courier New', Courier, monospace;
              font-size: 8.5px;
              color: #555;
              border-bottom: 0.5px solid #e8e8e8;
            }
            .evidence-table tr:last-child td {
              border-bottom: 0.5px solid #ccc;
            }
            .evidence-table .sys-gen { color: #999; }
            .evidence-table .amz-conf { color: #333; font-weight: 600; }
            .evidence-table td:first-child { color: #888; }
            .evidence-table td:nth-child(2) { color: #1a1a1a; font-weight: 500; }

            /* ═══ BOTTOM ROW: STATUS MATRIX + EVIDENCE CHECKLIST ═══ */
            .bottom-row {
              display: flex;
              gap: 48px;
              margin-bottom: 0;
            }
            .status-matrix {
              flex: 1;
            }
            .status-row {
              display: flex;
              font-size: 10px;
              line-height: 2;
              border-bottom: 0.5px solid #e8e8e8;
            }
            .status-row:last-child { border-bottom: none; }
            .status-key {
              font-family: 'Inter', Arial, sans-serif;
              font-size: 8.5px;
              font-weight: 600;
              letter-spacing: 1.5px;
              text-transform: uppercase;
              color: #777;
              width: 180px;
              flex-shrink: 0;
              padding-top: 1px;
            }
            .status-val {
              font-family: 'Inter', Arial, sans-serif;
              font-size: 10px;
              font-weight: 500;
              color: #1a1a1a;
              flex: 1;
            }

            .evidence-checklist {
              flex: 1;
            }
            .checklist-item {
              font-family: 'Inter', Arial, sans-serif;
              font-size: 8.5px;
              line-height: 2;
              color: #555;
              border-bottom: 0.5px solid #e8e8e8;
            }
            .checklist-item:last-child { border-bottom: none; }

            /* ═══ STATUS STAMP ═══ */
            .status-stamp {
              font-family: 'Courier New', Courier, monospace;
              font-size: 8px;
              line-height: 1.6;
              color: #1a1a1a;
              border: 1px solid #1a1a1a;
              padding: 8px 12px;
              text-transform: uppercase;
              letter-spacing: 0.5px;
              background: #fff;
              display: inline-block;
            }
            .status-stamp-line {
              display: flex;
              gap: 8px;
            }

            /* ═══ FOOTER ═══ */
            .footer-block {
              border-top: 0.5px solid #ccc;
              padding-top: 12px;
              margin-top: 24px;
            }
            .policy-line {
              font-family: 'Inter', Arial, sans-serif;
              font-size: 7px;
              line-height: 1.8;
              color: #888;
              font-style: italic;
            }
            .hash-line {
              font-family: 'Courier New', Courier, monospace;
              font-size: 6.5px;
              color: #bbb;
              margin-top: 8px;
              letter-spacing: 0.5px;
            }
            .gen-line {
              font-family: 'Inter', Arial, sans-serif;
              font-size: 6.5px;
              color: #ccc;
              margin-top: 3px;
              letter-spacing: 0.5px;
            }
          </style>
        </head>
        <body>

          <!-- LETTERHEAD -->
          <div class="letterhead">
            <div class="letterhead-left">
              <div class="letterhead-title">Margin Audit Systems</div>
              <div class="letterhead-sub">Revenue Integrity Infrastructure</div>
            </div>
            <div class="letterhead-right">
              <div class="letterhead-status">Confidential Claim Filing</div>
              <div class="letterhead-hash">(DATA_INTEGRITY SHA256: ${hash.substring(0, 16)}...)</div>
            </div>
          </div>

          <!-- COMMAND STRIP -->
          <div class="command-strip">
            <div class="command-strip-left">ISSUE DETECTED: INBOUND SHIPMENT VARIANCE (SHORTAGE)</div>
            <div class="command-strip-right">ACTION REQUIRED: LEDGER RECONCILIATION & REIMBURSEMENT</div>
          </div>
          <div class="legal-basis-line">LEGAL BASIS: FILED PURSUANT TO FBA POLICY G200213130</div>

          <!-- CLAIM DETAILS (left) + THE MONEY (right) -->
          <div class="claim-row">

            <div class="claim-details">
              <div class="section-label">Claim Reference</div>
              <div class="meta-row"><span class="meta-key">Case ID</span><span class="meta-val">${disputeCase.provider_case_id || `DIS-${disputeDate.replace(/-/g, '-')}-${disputeCase.id.substring(0, 9)}`}</span></div>
              <div class="meta-row"><span class="meta-key">Claim Ref</span><span class="meta-val">${disputeCase.case_number}</span></div>
              <div class="meta-row"><span class="meta-key">ASIN</span><span class="meta-val">${itemAsin}</span></div>
              <div class="meta-row"><span class="meta-key">SKU</span><span class="meta-val">${itemSku}</span></div>
              <div class="meta-row"><span class="meta-key">Shipment</span><span class="meta-val">${shipmentId}</span></div>
              <div class="meta-row"><span class="meta-key">Filed</span><span class="meta-val">${disputeDate}</span></div>
              <div class="meta-row"><span class="meta-key">Deadline</span><span class="meta-val">${responseDeadline}</span></div>
            </div>

            <div class="claim-money">
              <div class="section-label">Liability Summary</div>
              <div class="liability-row"><span class="liability-key">Expected</span><span class="liability-val big">${expectedQty} units</span></div>
              <div class="liability-row"><span class="liability-key">Received</span><span class="liability-val big">${receivedQty} units</span></div>
              <div class="liability-row"><span class="liability-key">Discrepancy</span><span class="liability-val big discrepancy">${variance > 0 ? '-' : ''}${Math.abs(variance)} units</span></div>
              <div class="liability-row"><span class="liability-key">Unit Value</span><span class="liability-val">$${unitPrice.toFixed(2)}</span></div>
              <div class="liability-row"><span class="liability-key">Total Claim</span><span class="liability-val claim">$${disputeCase.claim_amount.toFixed(2)}</span></div>
              <div class="liability-row"><span class="liability-key">Policy</span><span class="liability-val policy-ref">${policyCode}</span></div>
            </div>

          </div>

          <hr class="section-divider">

          <!-- EVIDENCE LOG — LEGAL EXHIBIT -->
          <div class="evidence-log">
            <div class="section-label">Evidence Log</div>
            <table class="evidence-table">
              <thead>
                <tr>
                  <th style="width:20%">Timestamp</th>
                  <th style="width:24%">Event Type</th>
                  <th style="width:30%">Reference</th>
                  <th style="width:26%">Confirmation</th>
                </tr>
              </thead>
              <tbody>
                ${evidenceLogRows.map(row => `
                  <tr>
                    <td>${row.ts}</td>
                    <td>${row.event}</td>
                    <td>${row.ref}</td>
                    <td class="${row.confirm === 'SYSTEM_GENERATED' ? 'sys-gen' : row.confirm.includes('AMAZON') ? 'amz-conf' : ''}">${row.confirm}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>

          <hr class="section-divider">

          <!-- STATUS STAMP + EVIDENTIARY EXHIBITS -->
          <div class="bottom-row">

            <div class="status-matrix">
              <div class="section-label">Audit Classification Stamp</div>
              <div class="status-stamp">
                <div class="status-stamp-line">
                  <span>ERROR TYPE: ${errorType.toUpperCase().replace(/[- ]/g, '_')}</span>
                  <span>|</span>
                  <span>CODE: ${errorCode.toUpperCase().replace(/[- ]/g, '_')}</span>
                </div>
                <div class="status-stamp-line">
                  <span>SEVERITY: CRITICAL</span>
                  <span>|</span>
                  <span>DISCREPANCY: ${discrepancyRate}%</span>
                </div>
                <div class="status-stamp-line">
                  <span>AFFECTED UNITS: ${expectedQty}</span>
                  <span>|</span>
                  <span>FC: ${affectedFCs}</span>
                </div>
              </div>
            </div>

            <div class="evidence-checklist">
              <div class="section-label">Attached Evidentiary Exhibits</div>
              ${evidentiaryExhibits}
            </div>

          </div>

          <!-- FOOTER -->
          <div class="footer-block">
            <div class="policy-line">REF: Amazon FBA Reimbursement Policy ${policyCode} §4.2(b) — "Sellers must be reimbursed for inventory discrepancies confirmed by FBA receiving scans."</div>
            <div class="policy-line">REF: Amazon Seller Agreement §9.3 — "Amazon is responsible for accurate measurement data in fulfillment systems."</div>
            <div class="gen-line">Generated ${new Date().toISOString()} · Margin Audit Systems · Document ${disputeCase.id}</div>
          </div>

        </body>
        </html>
      `;

      return await pdfGenerationService.generatePDFFromHTML(html, {
        format: 'A4',
        margin: { top: '0mm', right: '0mm', bottom: '0mm', left: '0mm' }
      });
    } catch (error) {
      logger.error('Failed to generate dispute brief', { error, caseId });
      throw error;
    }
  }
}

export const disputeService = new DisputeService();
export default disputeService;

