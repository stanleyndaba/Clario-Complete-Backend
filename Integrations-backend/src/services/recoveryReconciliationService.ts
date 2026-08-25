import { CanonicalAccountingArtifact } from './accountingIntelligenceService';

/**
 * A compatibility shape for deterministic matching. These artifacts are produced
 * only from persisted canonical accounting records by accountingIntelligenceService.
 * This module intentionally contains no OAuth, token, Axios, or provider fallback.
 */
export type AccountingFinancialArtifact = Pick<
  CanonicalAccountingArtifact,
  'provider' | 'tenantId' | 'providerRecordId' | 'recordType' | 'transactionDate' | 'amount' | 'currency' | 'reference' | 'description' | 'counterpartyName'
> & { id?: string; sourceId?: string | null };

export type ReconciliationStatus = 'RECONCILED' | 'PARTIAL_MATCH' | 'NEEDS_REVIEW' | 'UNMATCHED';

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
  accountingRecordId: string | null;
};

/**
 * Pure, deterministic reconciliation matching. An empty array means the caller
 * successfully searched canonical evidence and found no candidate. A provider or
 * canonical-store failure must be handled by the caller as EVIDENCE_UNAVAILABLE,
 * never converted into an empty array or an unmatched business conclusion.
 */
export class RecoveryReconciliationService {
  reconcileArtifacts(
    expectedAmount: number,
    expectedCurrency: string,
    expectedDate: Date | null,
    expectedReference: string | null,
    artifacts: AccountingFinancialArtifact[]
  ): ReconciliationResult {
    if (!artifacts || artifacts.length === 0) {
      return {
        status: 'UNMATCHED',
        expectedAmount,
        matchedAmount: null,
        difference: null,
        currency: expectedCurrency,
        confidenceScore: 0,
        matchReasons: ['NO_CANONICAL_CANDIDATE'],
        transactionDate: null,
        providerRecordId: null,
        accountingRecordId: null
      };
    }

    const scoredCandidates = artifacts.map((artifact) => {
      let score = 0;
      const reasons: string[] = [];

      if (artifact.currency && expectedCurrency && artifact.currency.toUpperCase() !== expectedCurrency.toUpperCase()) {
        return { artifact, score: -10, reasons: ['WRONG_CURRENCY'], difference: Math.abs(artifact.amount - expectedAmount) };
      }
      score += 0.2;
      reasons.push('SAME_CURRENCY');

      const difference = Math.abs(artifact.amount - expectedAmount);
      const differenceRatio = expectedAmount > 0 ? difference / expectedAmount : 0;
      if (difference === 0) {
        score += 0.5;
        reasons.push('EXACT_AMOUNT');
      } else if (difference <= 5 || differenceRatio <= 0.005) {
        score += 0.4;
        reasons.push('AMOUNT_WITHIN_TOLERANCE');
      } else if (difference <= 50 && differenceRatio <= 0.05) {
        score += 0.2;
        reasons.push('AMOUNT_DIFFERENCE_MINOR');
      } else if (difference <= 200 && differenceRatio <= 0.15) {
        score += 0.05;
        reasons.push('AMOUNT_DIFFERENCE');
      } else {
        score -= 0.5;
      }

      if (expectedDate && artifact.transactionDate) {
        const dayDifference = Math.abs(artifact.transactionDate.getTime() - expectedDate.getTime()) / 86_400_000;
        if (dayDifference === 0) {
          score += 0.2;
          reasons.push('DATE_EXACT');
        } else if (dayDifference <= 3) {
          score += 0.15;
          reasons.push('DATE_NEAR');
        } else if (dayDifference <= 7) {
          score += 0.05;
          reasons.push('DATE_WITHIN_WEEK');
        }
      }

      if (expectedReference && artifact.reference && expectedReference.toLowerCase() === artifact.reference.toLowerCase()) {
        score += 0.3;
        reasons.push('REFERENCE_MATCH');
      }

      return { artifact, score, reasons, difference };
    });

    const validCandidates = scoredCandidates.filter((candidate) => candidate.score > 0).sort((a, b) => b.score - a.score);
    if (!validCandidates.length) {
      return {
        status: 'UNMATCHED',
        expectedAmount,
        matchedAmount: null,
        difference: null,
        currency: expectedCurrency,
        confidenceScore: 0,
        matchReasons: ['NO_CANONICAL_CANDIDATE'],
        transactionDate: null,
        providerRecordId: null,
        accountingRecordId: null
      };
    }

    const best = validCandidates[0];
    const base = {
      expectedAmount,
      matchedAmount: best.artifact.amount,
      difference: best.difference,
      currency: expectedCurrency,
      confidenceScore: best.score,
      transactionDate: best.artifact.transactionDate,
      providerRecordId: best.artifact.providerRecordId,
      accountingRecordId: best.artifact.id || null
    };

    if (validCandidates.length > 1 && validCandidates[0].score - validCandidates[1].score < 0.15) {
      return { status: 'NEEDS_REVIEW', ...base, matchReasons: [...best.reasons, 'MULTIPLE_CANDIDATES'] };
    }

    const differenceRatio = expectedAmount > 0 ? best.difference / expectedAmount : 0;
    const isMinorVariance = best.difference <= 5 && differenceRatio <= 0.005;
    const canAutoReconcile = (best.difference === 0 || isMinorVariance) && best.score >= 0.65;
    if (canAutoReconcile) return { status: 'RECONCILED', ...base, matchReasons: best.reasons };

    if (best.difference <= 100 && differenceRatio <= 0.1) {
      return { status: 'PARTIAL_MATCH', ...base, matchReasons: best.reasons };
    }

    return { status: 'NEEDS_REVIEW', ...base, matchReasons: best.reasons };
  }
}

export const recoveryReconciliationService = new RecoveryReconciliationService();
