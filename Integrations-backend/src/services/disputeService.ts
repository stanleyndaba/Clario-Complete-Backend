import { supabase } from '../database/supabaseClient';
import logger from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';
import { pdfGenerationService } from './pdfGenerationService';
import { briefGeneratorService } from './briefGeneratorService';
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
  amazon_case_id?: string;
  filing_status?: string;
  submission_date?: string;
  evidence_document_ids?: string[];
  evidence_attachments?: any;
  metadata?: any;
  estimated_recovery_amount?: number;
  approved_amount?: number;
  recovered_amount?: number;
  last_error?: string;
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

function getStoredOriginalFilename(doc: any): string | null {
  const explicitOriginalFilename = typeof doc?.original_filename === 'string'
    ? doc.original_filename.trim()
    : '';
  if (explicitOriginalFilename) {
    return explicitOriginalFilename;
  }

  const metadataOriginalFilename = typeof doc?.metadata?.original_filename === 'string'
    ? doc.metadata.original_filename.trim()
    : '';
  if (metadataOriginalFilename) {
    return metadataOriginalFilename;
  }

  const canonicalFilename = typeof doc?.filename === 'string'
    ? doc.filename.trim()
    : '';
  return canonicalFilename || null;
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
          evidence_attachments: evidence || {},
          tenant_id: evidence?.tenant_id || undefined
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
      tenantId?: string;
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

      // Tenant isolation
      if (filters?.tenantId) {
        query = query.eq('tenant_id', filters.tenantId);
      }

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
  async getDisputeStatistics(sellerId: string, tenantId?: string): Promise<{
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
      let query = supabase
        .from('dispute_cases')
        .select('*')
        .eq('seller_id', sellerId);

      // Tenant isolation
      if (tenantId) {
        query = query.eq('tenant_id', tenantId);
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
   * Generate a truthful case inspection summary.
   * This document must only display stored or clearly derived backend truth.
   */
  async generateDisputeBrief(caseId: string): Promise<Buffer> {
    try {
      const disputeCase = await this.getDisputeCase(caseId);

      let storeName = 'Seller Account';
      if (disputeCase.seller_id) {
        const { data: userData } = await supabase
          .from('users')
          .select('company_name, email')
          .eq('id', disputeCase.seller_id)
          .single();
        if (userData) {
          storeName = userData.company_name || userData.email?.split('@')[0] || 'Seller Account';
        }
      }

      let evidenceDocs: any[] = [];
      if (disputeCase.evidence_document_ids && disputeCase.evidence_document_ids.length > 0) {
        const { data } = await supabase
          .from('evidence_documents')
          .select('filename, doc_type, source_provider, parsed_metadata, extracted, metadata')
          .in('id', disputeCase.evidence_document_ids);
        evidenceDocs = data || [];
      }

      let detectionResult: any = null;
      if (disputeCase.detection_result_id) {
        const { data: drData } = await supabase
          .from('detection_results')
          .select('*')
          .eq('id', disputeCase.detection_result_id)
          .single();
        detectionResult = drData || null;
      }
      const { data: latestSubmission } = await supabase
        .from('dispute_submissions')
        .select('submission_id, amazon_case_id, status, created_at, updated_at')
        .eq('dispute_id', caseId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const { data: auditEvents } = await supabase
        .from('dispute_audit_log')
        .select('action, notes, created_at')
        .eq('dispute_case_id', caseId)
        .order('created_at', { ascending: false })
        .limit(12);

      const parseJsonObject = (value: any) => {
        if (!value) return {};
        if (typeof value === 'string') {
          try {
            return JSON.parse(value);
          } catch {
            return {};
          }
        }
        return value;
      };

      const escapeHtml = (value: any) =>
        String(value ?? '')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');

      const display = (value: any) => {
        if (value === null || value === undefined) return 'Unavailable';
        const stringValue = String(value).trim();
        return stringValue ? stringValue : 'Unavailable';
      };

      const normalize = (value: unknown) => String(value || '').trim().toLowerCase();
      const titleCase = (value: unknown) =>
        String(value || '')
          .replace(/[_-]+/g, ' ')
          .trim()
          .replace(/\b\w/g, (char) => char.toUpperCase()) || 'Unavailable';

      const formatMoney = (amount: number | null | undefined, currency = 'USD') => {
        if (typeof amount !== 'number' || Number.isNaN(amount)) return 'Unavailable';
        return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
      };

      const formatDateTime = (value: string | null | undefined) => {
        if (!value) return 'Unavailable';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return 'Unavailable';
        return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
      };

      const disputeMeta = parseJsonObject(disputeCase.metadata || disputeCase.evidence_attachments);
      const detectionMeta = parseJsonObject(detectionResult?.metadata || detectionResult?.details);
      const detectionEvidence = parseJsonObject(detectionResult?.evidence);

      const claimType = disputeCase.case_type || null;
      const shipmentId = detectionEvidence.shipment_id || detectionEvidence.fba_shipment_id || disputeMeta.shipment_id || disputeMeta.fba_shipment_id || null;
      const orderId = disputeCase.order_id || detectionEvidence.order_id || detectionMeta.order_id || disputeMeta.order_id || null;
      const sku = disputeCase.sku || detectionEvidence.sku || detectionMeta.sku || disputeMeta.sku || null;
      const asin = disputeCase.asin || detectionEvidence.asin || detectionEvidence.fnsku || detectionMeta.asin || detectionMeta.fnsku || disputeMeta.asin || disputeMeta.fnsku || null;
      const submissionQuantity = Number(detectionEvidence.quantity || detectionEvidence.units || disputeMeta.quantity || 1) || 1;
      const submissionAmount = Number(disputeCase.estimated_recovery_amount ?? disputeCase.claim_amount ?? 0) || 0;
      const submissionCurrency = disputeCase.currency || 'USD';
      const evidenceFilenames = evidenceDocs
        .map((doc) => String(getStoredOriginalFilename(doc) || '').trim())
        .filter(Boolean);

      const generatedBrief = briefGeneratorService.generateBrief({
        caseType: claimType || 'generic',
        amount: submissionAmount,
        currency: submissionCurrency,
        orderId: orderId || undefined,
        shipmentId: shipmentId || undefined,
        asin: asin || undefined,
        sku: sku || undefined,
        quantity: submissionQuantity,
        evidenceFilenames
      });

      const deriveSubmissionState = () => {
        const submissionStatus = normalize(latestSubmission?.status);
        const filingStatus = normalize(disputeCase.filing_status);

        if (filingStatus === 'filed' || disputeCase.amazon_case_id || latestSubmission?.amazon_case_id) {
          return 'submission_confirmed';
        }
        if (submissionStatus === 'submission_confirmed') return 'submission_confirmed';
        if (submissionStatus === 'submission_attempted' || submissionStatus === 'submitted') return 'submission_attempted';
        if (submissionStatus === 'packaged_for_submission' || filingStatus === 'submitting' || filingStatus === 'filing') {
          return 'packaged_for_submission';
        }
        if (submissionStatus === 'failed' || filingStatus === 'failed') return 'failed';
        return 'not_implemented';
      };

      const submissionState = deriveSubmissionState();
      const submissionStateNote =
        submissionState === 'submission_confirmed'
          ? null
          : submissionState === 'submission_attempted'
            ? 'A downstream submission attempt was recorded, but confirmation is not available in this summary.'
            : submissionState === 'failed'
              ? display(disputeCase.last_error || 'Submission failed before confirmation.')
              : 'This case has not been submitted.';
      const submissionContractNote = 'Subject and body below are generated from the same backend submission contract used for filing.';
      const submissionNote = [submissionStateNote, submissionContractNote].filter(Boolean).join(' ');

      const claimRows: Array<[string, string]> = [
        ['Claim Ref', display(disputeCase.case_number)],
        ['Claim Type', display(claimType)],
        ['Case Status', display(titleCase(disputeCase.status))],
        ['Filing Status', display(titleCase(disputeCase.filing_status))],
        ['Amount', formatMoney(typeof disputeCase.claim_amount === 'number' ? disputeCase.claim_amount : Number(disputeCase.claim_amount), disputeCase.currency || 'USD')],
        ['Shipment ID', display(shipmentId)],
        ['Order ID', display(orderId)],
        ['SKU', display(sku)],
        ['ASIN', display(asin)],
      ];

      const submissionRows: Array<[string, string]> = [
        ['Submission State', submissionState],
        ['Submission ID', display(latestSubmission?.submission_id)],
        ['External Case ID', display(latestSubmission?.amazon_case_id || disputeCase.amazon_case_id)],
        ['Last Submission Update', formatDateTime(latestSubmission?.updated_at || disputeCase.submission_date)],
        ['Subject', generatedBrief.subject],
        ['Body', generatedBrief.body],
        ['Quantity', String(submissionQuantity)],
        ['Amount Claimed', formatMoney(submissionAmount, submissionCurrency)],
      ];

      const extractConfidence = (doc: any) => {
        const parsed = parseJsonObject(doc.parsed_metadata);
        const extracted = parseJsonObject(doc.extracted);
        const metadata = parseJsonObject(doc.metadata);
        const candidates = [
          parsed.match_confidence,
          extracted.match_confidence,
          metadata.match_confidence,
          parsed.confidence,
          extracted.confidence,
          metadata.confidence
        ];
        const hit = candidates.find((value) => Number.isFinite(Number(value)));
        if (hit === undefined) return 'Unavailable';
        return `${Math.round(Number(hit) * 100)}%`;
      };

      const evidenceRows = evidenceDocs.map((doc) => ({
        filename: getStoredOriginalFilename(doc) || 'Unavailable',
        type: doc.doc_type || 'Unavailable',
        source: doc.source_provider || 'Unavailable',
        confidence: extractConfidence(doc)
      }));

      const systemEvents = Array.isArray(auditEvents) ? auditEvents : [];

      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <style>
            @page { margin: 18mm; size: A4; }
            * { box-sizing: border-box; }
            body {
              margin: 0;
              font-family: Arial, Helvetica, sans-serif;
              color: #171717;
              background: #ffffff;
              font-size: 11px;
              line-height: 1.45;
            }
            .header {
              border-bottom: 1px solid #d4d4d4;
              padding-bottom: 14px;
              margin-bottom: 18px;
            }
            .title {
              font-size: 20px;
              font-weight: 700;
              letter-spacing: -0.02em;
              color: #111827;
            }
            .subhead {
              margin-top: 6px;
              font-size: 10px;
              color: #525252;
            }
            .section {
              margin-top: 20px;
            }
            .section h2 {
              font-size: 11px;
              font-weight: 700;
              text-transform: uppercase;
              letter-spacing: 0.08em;
              color: #525252;
              margin-bottom: 10px;
            }
            .card {
              border: 1px solid #e5e7eb;
              border-radius: 10px;
              padding: 12px;
            }
            .row {
              display: flex;
              gap: 10px;
              padding: 5px 0;
              border-bottom: 1px solid #f0f0f0;
            }
            .row:last-child {
              border-bottom: none;
            }
            .label {
              width: 132px;
              flex-shrink: 0;
              font-size: 10px;
              font-weight: 700;
              color: #6b7280;
              text-transform: uppercase;
              letter-spacing: 0.04em;
            }
            .value {
              flex: 1;
              font-size: 11px;
              color: #111827;
              white-space: pre-wrap;
              word-break: break-word;
            }
            .note {
              margin-top: 10px;
              padding: 10px 12px;
              border-radius: 8px;
              background: #f5f5f5;
              color: #404040;
              font-size: 10px;
            }
            table {
              width: 100%;
              border-collapse: collapse;
            }
            th {
              text-align: left;
              font-size: 10px;
              text-transform: uppercase;
              letter-spacing: 0.04em;
              color: #6b7280;
              border-bottom: 1px solid #d4d4d4;
              padding: 8px 6px;
            }
            td {
              font-size: 11px;
              color: #111827;
              border-bottom: 1px solid #f0f0f0;
              padding: 8px 6px;
              vertical-align: top;
            }
            .empty {
              border: 1px dashed #d4d4d4;
              border-radius: 10px;
              padding: 12px;
              color: #6b7280;
              font-size: 11px;
            }
            .footer {
              margin-top: 24px;
              padding-top: 12px;
              border-top: 1px solid #e5e7eb;
              font-size: 10px;
              color: #737373;
            }
          </style>
        </head>
        <body>
          <div class="header">
            <div class="title">Brief Overview</div>
            <div class="subhead">Brief Overview for ${escapeHtml(storeName)} · Generated ${escapeHtml(formatDateTime(new Date().toISOString()))}</div>
          </div>

          <div class="section">
            <h2>Claim Summary</h2>
            <div class="card">
              ${claimRows.map(([labelText, value]) => `
                <div class="row">
                  <div class="label">${escapeHtml(labelText)}</div>
                  <div class="value">${escapeHtml(value)}</div>
                </div>
              `).join('')}
            </div>
          </div>

          <div class="section">
            <h2>Submission Status</h2>
            <div class="card">
              ${submissionRows.map(([labelText, value]) => `
                <div class="row">
                  <div class="label">${escapeHtml(labelText)}</div>
                  <div class="value">${escapeHtml(value)}</div>
                </div>
              `).join('')}
              ${submissionNote ? `<div class="note">${escapeHtml(submissionNote)}</div>` : ''}
            </div>
          </div>

          <div class="section">
            <h2>Evidence Documents</h2>
            ${evidenceRows.length > 0 ? `
              <table>
                <thead>
                  <tr>
                    <th style="width:38%">Filename</th>
                    <th style="width:18%">Type</th>
                    <th style="width:22%">Source</th>
                    <th style="width:22%">Confidence</th>
                  </tr>
                </thead>
                <tbody>
                  ${evidenceRows.map((row) => `
                    <tr>
                      <td>${escapeHtml(row.filename)}</td>
                      <td>${escapeHtml(titleCase(row.type))}</td>
                      <td>${escapeHtml(titleCase(row.source))}</td>
                      <td>${escapeHtml(row.confidence)}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            ` : `<div class="empty">No evidence documents linked.</div>`}
          </div>

          <div class="section">
            <h2>System Events</h2>
            ${systemEvents.length > 0 ? `
              <table>
                <thead>
                  <tr>
                    <th style="width:24%">Timestamp</th>
                    <th style="width:26%">Action</th>
                    <th style="width:50%">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  ${systemEvents.map((event: any) => `
                    <tr>
                      <td>${escapeHtml(formatDateTime(event.created_at))}</td>
                      <td>${escapeHtml(titleCase(event.action))}</td>
                      <td>${escapeHtml(display(event.notes))}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            ` : `<div class="empty">No system events recorded.</div>`}
          </div>

          <div class="footer">
            Summary ID: ${escapeHtml(disputeCase.id)} · Generated from stored case, submission, evidence, and audit records only.
          </div>

        </body>
        </html>
      `;

      return await pdfGenerationService.generatePDFFromHTML(html, {
        format: 'A4',
        margin: { top: '18mm', right: '18mm', bottom: '18mm', left: '18mm' }
      });
    } catch (error) {
      logger.error('Failed to generate dispute brief', { error, caseId });
      throw error;
    }
  }
}

export const disputeService = new DisputeService();
export default disputeService;

