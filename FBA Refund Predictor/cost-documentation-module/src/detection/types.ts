import { RuleType, AnomalySeverity, ThresholdOperator, WhitelistScope } from '@prisma/client';

export interface Anomaly {
  ruleType: RuleType;
  severity: AnomalySeverity;
  score: number; // 0.0 to 1.0 confidence score
  summary: string;
  evidence: Record<string, any>;
  dedupeHash: string;
}

export interface RuleInput {
  sellerId: string;
  syncId: string;
  data: Record<string, any>;
}

export interface Threshold {
  id: string;
  sellerId: string | null;
  ruleType: RuleType;
  operator: ThresholdOperator;
  value: number;
  active: boolean;
}

export interface WhitelistItem {
  id: string;
  sellerId: string;
  scope: WhitelistScope;
  value: string;
  reason?: string;
  active: boolean;
}

export interface RuleContext {
  sellerId: string;
  syncId: string;
  thresholds: Threshold[];
  whitelist: WhitelistItem[];
}

export interface EvidenceMetadata {
  ruleType: RuleType;
  sellerId: string;
  syncId: string;
  timestamp: string;
  inputSnapshotHash: string;
  thresholdApplied?: {
    thresholdId: string;
    operator: ThresholdOperator;
    value: number;
  };
  whitelistApplied?: {
    whitelistId: string;
    scope: WhitelistScope;
    value: string;
  };
  computations: Record<string, any>;
}

export interface DetectionJob {
  id: string;
  sellerId: string;
  syncId: string;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL';
  attempts: number;
  lastError?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface DetectionResult {
  id: string;
  sellerId: string;
  syncId: string;
  ruleType: RuleType;
  severity: AnomalySeverity;
  score: number;
  summary: string;
  evidenceJson: Record<string, any>;
  evidenceS3Url: string;
  dedupeHash: string;
  detectionJobId: string;
  createdAt: Date;
}

