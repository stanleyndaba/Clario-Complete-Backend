import { supabase } from '../database/supabaseClient';
import logger from '../utils/logger';
import { createError } from '../utils/errorHandler';
import { AmazonClaim, AmazonInventory, AmazonFee } from '../services/amazonService';
import { StripeTransaction } from '../services/stripeService';

export interface NormalizedLedgerEntry {
  claimId: string;
  type: string;
  amount: number;
  currency: string;
  date: string;
  details: Record<string, any>;
}

export interface LinkedCase {
  claimId: string;
  mcdeDocId: string | null;
  normalized: NormalizedLedgerEntry[];
  auditLog: any[];
}

export interface IngestionResult {
  totalCases: number;
  processed: number;
  duplicates: number;
  audit: any[];
}

export class DataOrchestrator {
  async mapAmazonClaimToRefundEngine(_userId: string, _claim: any): Promise<void> { return; }
  async updateCaseFileStatus(_userId: string, _caseId: string, _status: string): Promise<void> { return; }
  normalizeInventoryLedger(raw: any[]): NormalizedLedgerEntry[] {
    return raw.map((item) => ({
      claimId: item.claim_id || item.id,
      type: 'inventory',
      amount: item.quantity || 0,
      currency: item.currency || 'USD',
      date: item.date || new Date().toISOString(),
      details: { sku: item.sku, asin: item.asin, ...item }
    }));
  }

  normalizeShipments(raw: any[]): NormalizedLedgerEntry[] {
    return raw.map((item) => ({
      claimId: item.claim_id || item.id,
      type: 'shipment',
      amount: item.shipped_quantity || 0,
      currency: item.currency || 'USD',
      date: item.shipment_date || new Date().toISOString(),
      details: { shipmentId: item.shipment_id, ...item }
    }));
  }

  normalizeFees(raw: any[]): NormalizedLedgerEntry[] {
    return raw.map((item) => ({
      claimId: item.claim_id || item.id,
      type: 'fee',
      amount: item.fee_amount || 0,
      currency: item.currency || 'USD',
      date: item.fee_date || new Date().toISOString(),
      details: { feeType: item.fee_type, ...item }
    }));
  }

  normalizeReturns(raw: any[]): NormalizedLedgerEntry[] {
    return raw.map((item) => ({
      claimId: item.claim_id || item.id,
      type: 'return',
      amount: item.return_quantity || 0,
      currency: item.currency || 'USD',
      date: item.return_date || new Date().toISOString(),
      details: { orderId: item.order_id, ...item }
    }));
  }

  linkMCDEDocsToClaims(claims: any[], mcdeDocs: any[]): LinkedCase[] {
    return claims.map((claim) => {
      const doc = mcdeDocs.find((d) => d.claim_id === claim.claim_id);
      return {
        claimId: claim.claim_id,
        mcdeDocId: doc ? doc.id : null,
        normalized: claim.normalized,
        auditLog: [{ step: 'linkMCDE', docId: doc ? doc.id : null, timestamp: new Date().toISOString() }]
      };
    });
  }

  async createCaseFileLedgerEntry(userId: string, claim: any, normalized: NormalizedLedgerEntry[], mcdeDocId: string | null, auditLog: any[]): Promise<void> {
    // Idempotency: check if case already exists
    const { data: existing, error: findErr } = await supabase
      .from('refund_engine_cases')
      .select('id')
      .eq('user_id', userId)
      .eq('claim_id', claim.claim_id)
      .single();
    if (existing) {
      logger.info('Case file already exists, skipping duplicate', { userId, claimId: claim.claim_id });
      return;
    }
    // Insert new case file
    const { error } = await supabase
      .from('refund_engine_cases')
      .insert({
        user_id: userId,
        claim_id: claim.claim_id,
        mcde_doc_id: mcdeDocId,
        case_status: 'synced',
        synced_at: new Date().toISOString(),
        raw_data: claim.raw,
        normalized_data: normalized,
        audit_log: auditLog
      });
    if (error) {
      logger.error('Failed to insert case file ledger entry', { userId, claimId: claim.claim_id, error: error.message });
      throw new Error('Failed to insert case file ledger entry');
    }
    logger.info('Case file ledger entry created', { userId, claimId: claim.claim_id });
  }

  async orchestrateIngestion(userId: string, rawAmazonData: any, mcdeDocs: any[]): Promise<IngestionResult> {
    // Normalize all report types
    const inventory = this.normalizeInventoryLedger(rawAmazonData.inventory || []);
    const shipments = this.normalizeShipments(rawAmazonData.shipments || []);
    const fees = this.normalizeFees(rawAmazonData.fees || []);
    const returns = this.normalizeReturns(rawAmazonData.returns || []);
    // ...add more as needed
    // Group by claimId
    const all = [...inventory, ...shipments, ...fees, ...returns];
    const claimsMap: Record<string, { claim_id: string; raw: any; normalized: NormalizedLedgerEntry[] }> = {};
    all.forEach((entry) => {
      if (!claimsMap[entry.claimId]) {
        claimsMap[entry.claimId] = { claim_id: entry.claimId, raw: [], normalized: [] };
      }
      claimsMap[entry.claimId].normalized.push(entry);
    });
    // Link MCDE docs
    const claims = Object.values(claimsMap);
    const linked = this.linkMCDEDocsToClaims(claims, mcdeDocs);
    // Write to DB
    let processed = 0, duplicates = 0, audit: any[] = [];
    for (const c of linked) {
      try {
        await this.createCaseFileLedgerEntry(userId, { claim_id: c.claimId, raw: claimsMap[c.claimId].raw }, c.normalized, c.mcdeDocId, c.auditLog);
        processed++;
        audit.push({ claimId: c.claimId, status: 'created' });
      } catch (err: any) {
        if (err.message.includes('already exists')) {
          duplicates++;
          audit.push({ claimId: c.claimId, status: 'duplicate' });
        } else {
          audit.push({ claimId: c.claimId, status: 'error', error: err.message });
        }
      }
    }
    return { totalCases: claims.length, processed, duplicates, audit };
  }
}

export const dataOrchestrator = new DataOrchestrator();
export default dataOrchestrator; 
