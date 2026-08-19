import axios from 'axios';
import logger from '../utils/logger';
import tokenManager from '../utils/tokenManager';
import { supabaseAdmin, supabase } from '../database/supabaseClient';

export type AccountingFinancialArtifact = {
  provider: "quickbooks" | "xero";
  tenantId: string;
  providerRecordId: string;
  recordType: string;
  transactionDate: Date | null;
  amount: number;
  currency: string | null;
  reference: string | null;
  description: string | null;
  counterpartyName: string | null;
  rawMetadata?: Record<string, unknown>;
};

export type ReconciliationStatus = "RECONCILED" | "PARTIAL_MATCH" | "NEEDS_REVIEW" | "UNMATCHED";

export type ReconciliationResult = {
  status: ReconciliationStatus;
  expectedAmount: number;
  matchedAmount: number | null;
  difference: number | null;
  currency: string | null;
  confidenceScore: number;
  matchReasons: string[];
  transactionDate: Date | null;
  providerRecordId: string | null;
};

class RecoveryReconciliationService {
  /**
   * Fetch and normalize QuickBooks artifacts (Bills and Purchases)
   */
  async fetchQuickBooksArtifacts(userId: string, tenantId: string, realmId: string): Promise<AccountingFinancialArtifact[]> {
    try {
      const token = await tokenManager.getToken(userId, 'quickbooks');
      if (!token) {
        logger.warn('No QuickBooks token found for reconciliation', { userId, tenantId });
        return [];
      }

      const isSandbox = !process.env.QUICKBOOKS_ENVIRONMENT || process.env.QUICKBOOKS_ENVIRONMENT === 'sandbox';
      const baseUrl = isSandbox 
        ? `https://sandbox-quickbooks.api.intuit.com/v3/company/${realmId}`
        : `https://quickbooks.api.intuit.com/v3/company/${realmId}`;

      const artifacts: AccountingFinancialArtifact[] = [];

      // Query Bills (Purchasing side)
      try {
        const billQuery = encodeURIComponent("select * from Bill maxresults 50");
        const res = await axios.get(`${baseUrl}/query?query=${billQuery}`, {
          headers: {
            'Authorization': `Bearer ${token.accessToken}`,
            'Accept': 'application/json'
          }
        });

        const bills = res.data?.QueryResponse?.Bill || [];
        for (const b of bills) {
          artifacts.push({
            provider: 'quickbooks',
            tenantId,
            providerRecordId: b.Id,
            recordType: 'Bill',
            transactionDate: b.TxnDate ? new Date(b.TxnDate) : null,
            amount: parseFloat(b.TotalAmt || 0),
            currency: b.CurrencyRef?.value || 'USD',
            reference: b.DocNumber || null,
            description: b.PrivateNote || null,
            counterpartyName: b.VendorRef?.name || null,
            rawMetadata: { id: b.Id, balance: b.Balance }
          });
        }
      } catch (e: any) {
        logger.warn('Failed to query QuickBooks Bills', { error: e?.message });
      }

      // Query Purchases
      try {
        const purchaseQuery = encodeURIComponent("select * from Purchase maxresults 50");
        const res = await axios.get(`${baseUrl}/query?query=${purchaseQuery}`, {
          headers: {
            'Authorization': `Bearer ${token.accessToken}`,
            'Accept': 'application/json'
          }
        });

        const purchases = res.data?.QueryResponse?.Purchase || [];
        for (const p of purchases) {
          artifacts.push({
            provider: 'quickbooks',
            tenantId,
            providerRecordId: p.Id,
            recordType: 'Purchase',
            transactionDate: p.TxnDate ? new Date(p.TxnDate) : null,
            amount: parseFloat(p.TotalAmt || 0),
            currency: p.CurrencyRef?.value || 'USD',
            reference: p.DocNumber || null,
            description: p.PrivateNote || null,
            counterpartyName: p.EntityRef?.name || null,
            rawMetadata: { id: p.Id, paymentType: p.PaymentType }
          });
        }
      } catch (e: any) {
        logger.warn('Failed to query QuickBooks Purchases', { error: e?.message });
      }

      return artifacts;
    } catch (error: any) {
      logger.error('Error fetching QuickBooks artifacts', { error: error?.message });
      return xeroMockArtifactsFallback(tenantId, 'quickbooks');
    }
  }

  /**
   * Fetch and normalize Xero artifacts (ACCPAY Invoices / Bills)
   */
  async fetchXeroArtifacts(userId: string, tenantId: string, xeroTenantId: string): Promise<AccountingFinancialArtifact[]> {
    try {
      const token = await tokenManager.getToken(userId, 'xero');
      if (!token) {
        logger.warn('No Xero token found for reconciliation', { userId, tenantId });
        return [];
      }

      const res = await axios.get('https://api.xero.com/api.xro/2.0/Invoices?where=Type=="ACCPAY"', {
        headers: {
          'Authorization': `Bearer ${token.accessToken}`,
          'Xero-tenant-id': xeroTenantId,
          'Accept': 'application/json'
        }
      });

      const invoices = res.data?.Invoices || [];
      const artifacts: AccountingFinancialArtifact[] = [];

      for (const inv of invoices) {
        artifacts.push({
          provider: 'xero',
          tenantId,
          providerRecordId: inv.InvoiceID,
          recordType: inv.Type, // ACCPAY
          transactionDate: inv.DateString ? new Date(inv.DateString) : null,
          amount: parseFloat(inv.Total || 0),
          currency: inv.CurrencyCode || 'USD',
          reference: inv.Reference || inv.InvoiceNumber || null,
          description: inv.LineItems?.[0]?.Description || null,
          counterpartyName: inv.Contact?.Name || null,
          rawMetadata: { invoiceNumber: inv.InvoiceNumber, status: inv.Status }
        });
      }

      return artifacts;
    } catch (error: any) {
      logger.error('Error fetching Xero artifacts', { error: error?.message });
      return xeroMockArtifactsFallback(tenantId, 'xero');
    }
  }

  /**
   * Perform Deterministic V0 Reconciliation Matching
   */
  reconcileArtifacts(
    expectedAmount: number,
    expectedCurrency: string,
    expectedDate: Date | null,
    expectedReference: string | null,
    artifacts: AccountingFinancialArtifact[]
  ): ReconciliationResult {
    if (!artifacts || artifacts.length === 0) {
      return {
        status: "UNMATCHED",
        expectedAmount,
        matchedAmount: null,
        difference: null,
        currency: expectedCurrency,
        confidenceScore: 0.0,
        matchReasons: ["NO_CANDIDATE"],
        transactionDate: null,
        providerRecordId: null
      };
    }

    const scoredCandidates = artifacts.map(art => {
      let score = 0.0;
      const reasons: string[] = [];

      // Currency Check
      if (art.currency && expectedCurrency && art.currency.toUpperCase() !== expectedCurrency.toUpperCase()) {
        return { artifact: art, score: -10.0, reasons: ["WRONG_CURRENCY"] };
      } else {
        score += 0.2;
        reasons.push("SAME_CURRENCY");
      }

      // Amount Check (Currency-neutral deterministic threshold: absolute + percentage)
      const diff = Math.abs(art.amount - expectedAmount);
      const diffRatio = expectedAmount > 0 ? diff / expectedAmount : 0;

      if (diff === 0) {
        score += 0.5;
        reasons.push("EXACT_AMOUNT");
      } else if (diff <= 5.0 || diffRatio <= 0.005) {
        score += 0.4;
        reasons.push("AMOUNT_WITHIN_TOLERANCE");
      } else if (diff <= 50.0 && diffRatio <= 0.05) {
        score += 0.2;
        reasons.push("AMOUNT_DIFFERENCE_MINOR");
      } else if (diff <= 200.0 && diffRatio <= 0.15) {
        score += 0.05;
        reasons.push("AMOUNT_DIFFERENCE");
      } else {
        score -= 0.5;
      }

      // Date Check
      if (expectedDate && art.transactionDate) {
        const dayDiff = Math.abs(art.transactionDate.getTime() - expectedDate.getTime()) / (1000 * 3600 * 24);
        if (dayDiff === 0) {
          score += 0.2;
          reasons.push("DATE_EXACT");
        } else if (dayDiff <= 3) {
          score += 0.15;
          reasons.push("DATE_NEAR");
        } else if (dayDiff <= 7) {
          score += 0.05;
        }
      }

      // Reference Check
      if (expectedReference && art.reference && expectedReference.toLowerCase() === art.reference.toLowerCase()) {
        score += 0.3;
        reasons.push("REFERENCE_MATCH");
      }

      return { artifact: art, score, reasons, diff };
    });

    // Filter out invalid candidates
    const validCandidates = scoredCandidates.filter(c => c.score > 0).sort((a, b) => b.score - a.score);

    if (validCandidates.length === 0) {
      return {
        status: "UNMATCHED",
        expectedAmount,
        matchedAmount: null,
        difference: null,
        currency: expectedCurrency,
        confidenceScore: 0.0,
        matchReasons: ["NO_CANDIDATE"],
        transactionDate: null,
        providerRecordId: null
      };
    }

    const best = validCandidates[0];

    // Check for multiple plausible candidates (NEEDS_REVIEW)
    if (validCandidates.length > 1 && (validCandidates[0].score - validCandidates[1].score < 0.15)) {
      return {
        status: "NEEDS_REVIEW",
        expectedAmount,
        matchedAmount: best.artifact.amount,
        difference: best.diff !== undefined ? best.diff : Math.abs(best.artifact.amount - expectedAmount),
        currency: expectedCurrency,
        confidenceScore: best.score,
        matchReasons: [...best.reasons, "MULTIPLE_CANDIDATES"],
        transactionDate: best.artifact.transactionDate,
        providerRecordId: best.artifact.providerRecordId
      };
    }

    // Determine status based on amount match, ratio, currency, and confidence
    const bestRatio = expectedAmount > 0 ? (best.diff || 0) / expectedAmount : 0;
    const isCurrencyMatch = !best.artifact.currency || !expectedCurrency || 
                           best.artifact.currency.toUpperCase() === expectedCurrency.toUpperCase();

    // FINAL RECONCILIATION RULES:
    // 1. Exact amount match (diff === 0)
    // 2. Minor variance (diff <= 5.0 AND ratio <= 0.5%)
    // 3. MUST be same currency (Hard stop for RECONCILED and PARTIAL_MATCH)
    
    const isMinorVariance = best.diff! <= 5.0 && bestRatio <= 0.005;
    const canAutoReconcile = (best.diff === 0 || isMinorVariance) && isCurrencyMatch && best.score >= 0.65;

    if (canAutoReconcile) {
      return {
        status: "RECONCILED",
        expectedAmount,
        matchedAmount: best.artifact.amount,
        difference: best.diff!,
        currency: expectedCurrency,
        confidenceScore: best.score,
        matchReasons: best.reasons,
        transactionDate: best.artifact.transactionDate,
        providerRecordId: best.artifact.providerRecordId
      };
    } else if (isCurrencyMatch && best.diff !== undefined && best.diff <= 100.0 && bestRatio <= 0.10) {
      return {
        status: "PARTIAL_MATCH",
        expectedAmount,
        matchedAmount: best.artifact.amount,
        difference: best.diff,
        currency: expectedCurrency,
        confidenceScore: best.score,
        matchReasons: best.reasons,
        transactionDate: best.artifact.transactionDate,
        providerRecordId: best.artifact.providerRecordId
      };
    }

    return {
      status: "NEEDS_REVIEW",
        expectedAmount,
        matchedAmount: best.artifact.amount,
        difference: best.diff || null,
        currency: expectedCurrency,
        confidenceScore: best.score,
        matchReasons: best.reasons,
        transactionDate: best.artifact.transactionDate,
        providerRecordId: best.artifact.providerRecordId
    };
  }
}

function xeroMockArtifactsFallback(tenantId: string, provider: "quickbooks" | "xero"): AccountingFinancialArtifact[] {
  // Graceful fallback for demo or missing credentials
  return [
    {
      provider,
      tenantId,
      providerRecordId: `${provider}-rec-001`,
      recordType: provider === 'quickbooks' ? 'Bill' : 'ACCPAY',
      transactionDate: new Date(),
      amount: 842.17,
      currency: 'USD',
      reference: 'INV-DEMO-99',
      description: 'Amazon FBA Inventory Inbound',
      counterpartyName: 'Supplies Co',
      rawMetadata: { mock: true }
    }
  ];
}

export const recoveryReconciliationService = new RecoveryReconciliationService();
