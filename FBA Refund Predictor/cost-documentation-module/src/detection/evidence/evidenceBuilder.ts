import { RuleType, AnomalySeverity } from '@prisma/client';
import { Anomaly, EvidenceMetadata } from '../types';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { createHash } from 'crypto';

export interface EvidenceArtifact {
  evidenceJson: Record<string, any>;
  evidenceS3Url: string;
  dedupeHash: string;
}

export class EvidenceBuilder {
  private s3Client: S3Client;
  private bucketName: string;
  private region: string;

  constructor(s3Client: S3Client, bucketName: string, region: string) {
    this.s3Client = s3Client;
    this.bucketName = bucketName;
    this.region = region;
  }

  async buildEvidence(
    anomaly: Anomaly,
    sellerId: string,
    syncId: string,
    inputData: Record<string, any>,
    thresholds: any[],
    whitelist: any[]
  ): Promise<EvidenceArtifact> {
    // Create deterministic evidence JSON
    const evidenceJson = this.createEvidenceJson(anomaly, sellerId, syncId, inputData, thresholds, whitelist);
    
    // Generate S3 URL with consistent pathing
    const evidenceS3Url = await this.uploadEvidenceToS3(evidenceJson, sellerId, syncId, anomaly.ruleType, anomaly.dedupeHash);
    
    return {
      evidenceJson,
      evidenceS3Url,
      dedupeHash: anomaly.dedupeHash
    };
  }

  private createEvidenceJson(
    anomaly: Anomaly,
    sellerId: string,
    syncId: string,
    inputData: Record<string, any>,
    thresholds: any[],
    whitelist: any[]
  ): Record<string, any> {
    const inputSnapshotHash = this.generateInputSnapshotHash(inputData);
    
    const metadata: EvidenceMetadata = {
      ruleType: anomaly.ruleType,
      sellerId,
      syncId,
      timestamp: new Date().toISOString(),
      inputSnapshotHash,
      computations: {
        severity: anomaly.severity,
        score: anomaly.score,
        rulePriority: this.getRulePriority(anomaly.ruleType)
      }
    };

    // Find applied thresholds
    const appliedThresholds = thresholds.filter(t => 
      t.ruleType === anomaly.ruleType && 
      (t.sellerId === null || t.sellerId === sellerId)
    );

    if (appliedThresholds.length > 0) {
      metadata.thresholdApplied = {
        thresholdId: appliedThresholds[0].id,
        operator: appliedThresholds[0].operator,
        value: Number(appliedThresholds[0].value)
      };
    }

    // Find applied whitelist rules
    const appliedWhitelist = whitelist.filter(w => 
      w.active && w.sellerId === sellerId
    );

    if (appliedWhitelist.length > 0) {
      metadata.whitelistApplied = {
        whitelistId: appliedWhitelist[0].id,
        scope: appliedWhitelist[0].scope,
        value: appliedWhitelist[0].value
      };
    }

    return {
      metadata,
      anomaly: {
        ruleType: anomaly.ruleType,
        severity: anomaly.severity,
        score: anomaly.score,
        summary: anomaly.summary,
        evidence: anomaly.evidence
      },
      inputData: this.sanitizeInputData(inputData)
    };
  }

  private async uploadEvidenceToS3(
    evidenceJson: Record<string, any>,
    sellerId: string,
    syncId: string,
    ruleType: RuleType,
    dedupeHash: string
  ): Promise<string> {
    const key = `evidence/${sellerId}/${syncId}/${ruleType}/${dedupeHash}.json`;
    const content = JSON.stringify(evidenceJson, null, 2);

    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: key,
      Body: content,
      ContentType: 'application/json',
      Metadata: {
        'seller-id': sellerId,
        'sync-id': syncId,
        'rule-type': ruleType,
        'dedupe-hash': dedupeHash
      }
    });

    try {
      await this.s3Client.send(command);
      return `s3://${this.bucketName}/${key}`;
    } catch (error) {
      throw new Error(`Failed to upload evidence to S3: ${error}`);
    }
  }

  private generateInputSnapshotHash(inputData: Record<string, any>): string {
    const normalizedData = this.normalizeDataForHashing(inputData);
    return createHash('sha256').update(JSON.stringify(normalizedData)).digest('hex').substring(0, 16);
  }

  private normalizeDataForHashing(data: Record<string, any>): Record<string, any> {
    const normalized: Record<string, any> = {};
    
    for (const [key, value] of Object.entries(data)) {
      if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') {
        normalized[key] = value;
      } else if (Array.isArray(value)) {
        normalized[key] = value.map(item => 
          typeof item === 'object' ? this.normalizeDataForHashing(item) : item
        ).sort();
      } else if (typeof value === 'object' && value !== null) {
        normalized[key] = this.normalizeDataForHashing(value);
      }
    }
    
    return normalized;
  }

  private sanitizeInputData(inputData: Record<string, any>): Record<string, any> {
    // Remove sensitive information and normalize data for storage
    const sanitized: Record<string, any> = {};
    
    for (const [key, value] of Object.entries(inputData)) {
      if (key.toLowerCase().includes('password') || key.toLowerCase().includes('secret')) {
        sanitized[key] = '[REDACTED]';
      } else if (typeof value === 'object' && value !== null) {
        sanitized[key] = this.sanitizeInputData(value);
      } else {
        sanitized[key] = value;
      }
    }
    
    return sanitized;
  }

  private getRulePriority(ruleType: RuleType): string {
    switch (ruleType) {
      case RuleType.LOST_UNITS:
        return 'HIGH';
      case RuleType.OVERCHARGED_FEES:
        return 'HIGH';
      case RuleType.DAMAGED_STOCK:
        return 'MEDIUM';
      default:
        return 'NORMAL';
    }
  }
}

