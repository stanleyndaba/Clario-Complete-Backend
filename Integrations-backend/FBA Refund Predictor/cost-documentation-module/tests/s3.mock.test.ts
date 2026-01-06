import { renderPdfToS3, generateS3Key } from '../src/services/pdfRenderer';
import { computeEvidenceSha256, shortHash } from '../src/utils/canonicalize';

// Mock S3 client
const mockS3Client = {
  upload: jest.fn(),
  getSignedUrl: jest.fn()
};

// Mock the S3 client import
jest.mock('aws-sdk', () => ({
  S3: jest.fn(() => mockS3Client)
}));

describe('S3 Mock Tests', () => {
  const sampleEvidence = {
    seller_id: 'seller123',
    anomaly_id: 'anomaly456',
    anomaly_type: 'lost_units',
    detection_date: '2024-01-01',
    total_impact: 150.75,
    evidence_data: {
      units_lost: 5,
      cost_per_unit: 30.15,
      location: 'warehouse_a'
    }
  };

  const samplePdfBuffer = Buffer.from('mock PDF content for testing');

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should generate consistent S3 keys for identical inputs', () => {
    const evidenceHash = computeEvidenceSha256(sampleEvidence);
    const shortHashValue = shortHash(evidenceHash);
    
    const s3Key1 = generateS3Key('seller123', 'anomaly456', '1.0', evidenceHash);
    const s3Key2 = generateS3Key('seller123', 'anomaly456', '1.0', evidenceHash);
    
    expect(s3Key1).toBe(s3Key2);
    expect(s3Key1).toContain('seller123');
    expect(s3Key1).toContain('anomaly456');
    expect(s3Key1).toContain('v1.0');
    expect(s3Key1).toContain(shortHashValue);
    expect(s3Key1).toMatch(/\.pdf$/);
  });

  test('should generate different S3 keys for different template versions', () => {
    const evidenceHash = computeEvidenceSha256(sampleEvidence);
    
    const s3Key1 = generateS3Key('seller123', 'anomaly456', '1.0', evidenceHash);
    const s3Key2 = generateS3Key('seller123', 'anomaly456', '2.0', evidenceHash);
    
    expect(s3Key1).not.toBe(s3Key2);
    expect(s3Key1).toContain('v1.0');
    expect(s3Key2).toContain('v2.0');
  });

  test('should generate different S3 keys for different evidence', () => {
    const evidenceHash1 = computeEvidenceSha256(sampleEvidence);
    
    const modifiedEvidence = {
      ...sampleEvidence,
      total_impact: 200.50
    };
    const evidenceHash2 = computeEvidenceSha256(modifiedEvidence);
    
    const s3Key1 = generateS3Key('seller123', 'anomaly456', '1.0', evidenceHash1);
    const s3Key2 = generateS3Key('seller123', 'anomaly456', '1.0', evidenceHash2);
    
    expect(s3Key1).not.toBe(s3Key2);
  });

  test('should generate different S3 keys for different sellers', () => {
    const evidenceHash = computeEvidenceSha256(sampleEvidence);
    
    const s3Key1 = generateS3Key('seller123', 'anomaly456', '1.0', evidenceHash);
    const s3Key2 = generateS3Key('seller789', 'anomaly456', '1.0', evidenceHash);
    
    expect(s3Key1).not.toBe(s3Key2);
    expect(s3Key1).toContain('seller123');
    expect(s3Key2).toContain('seller789');
  });

  test('should generate different S3 keys for different anomalies', () => {
    const evidenceHash = computeEvidenceSha256(sampleEvidence);
    
    const s3Key1 = generateS3Key('seller123', 'anomaly456', '1.0', evidenceHash);
    const s3Key2 = generateS3Key('seller123', 'anomaly789', '1.0', evidenceHash);
    
    expect(s3Key1).not.toBe(s3Key2);
    expect(s3Key1).toContain('anomaly456');
    expect(s3Key2).toContain('anomaly789');
  });

  test('should follow expected S3 key pattern', () => {
    const evidenceHash = computeEvidenceSha256(sampleEvidence);
    const shortHashValue = shortHash(evidenceHash);
    
    const s3Key = generateS3Key('seller123', 'anomaly456', '1.0', evidenceHash);
    
    // Expected pattern: docs/seller/{seller_id}/anomalies/{anomaly_id}/costdoc/v{version}-{shortHash}.pdf
    const expectedPattern = /^docs\/seller\/seller123\/anomalies\/anomaly456\/costdoc\/v1\.0-[a-f0-9]{8}\.pdf$/;
    
    expect(s3Key).toMatch(expectedPattern);
  });

  test('should handle special characters in seller and anomaly IDs', () => {
    const evidenceHash = computeEvidenceSha256(sampleEvidence);
    
    const s3Key = generateS3Key('seller-123_test', 'anomaly_456-test', '1.0', evidenceHash);
    
    expect(s3Key).toContain('seller-123_test');
    expect(s3Key).toContain('anomaly_456-test');
    expect(s3Key).toMatch(/\.pdf$/);
  });

  test('should generate short hash correctly', () => {
    const evidenceHash = computeEvidenceSha256(sampleEvidence);
    const shortHashValue = shortHash(evidenceHash);
    
    expect(shortHashValue).toHaveLength(8);
    expect(shortHashValue).toMatch(/^[a-f0-9]{8}$/);
    expect(evidenceHash).toContain(shortHashValue);
  });

  test('should handle empty evidence gracefully', () => {
    const emptyEvidence = {};
    const evidenceHash = computeEvidenceSha256(emptyEvidence);
    const shortHashValue = shortHash(evidenceHash);
    
    const s3Key = generateS3Key('seller123', 'anomaly456', '1.0', evidenceHash);
    
    expect(s3Key).toContain('seller123');
    expect(s3Key).toContain('anomaly456');
    expect(s3Key).toContain(shortHashValue);
    expect(s3Key).toMatch(/\.pdf$/);
  });

  test('should handle null and undefined values in evidence', () => {
    const evidenceWithNulls = {
      ...sampleEvidence,
      null_field: null,
      undefined_field: undefined
    };
    
    const evidenceHash = computeEvidenceSha256(evidenceWithNulls);
    const shortHashValue = shortHash(evidenceHash);
    
    const s3Key = generateS3Key('seller123', 'anomaly456', '1.0', evidenceHash);
    
    expect(s3Key).toContain('seller123');
    expect(s3Key).toContain('anomaly456');
    expect(s3Key).toContain(shortHashValue);
    expect(s3Key).toMatch(/\.pdf$/);
  });

  test('should maintain consistent key structure across different inputs', () => {
    const evidenceHash1 = computeEvidenceSha256(sampleEvidence);
    const evidenceHash2 = computeEvidenceSha256({ ...sampleEvidence, total_impact: 200.50 });
    
    const s3Key1 = generateS3Key('seller123', 'anomaly456', '1.0', evidenceHash1);
    const s3Key2 = generateS3Key('seller123', 'anomaly456', '1.0', evidenceHash2);
    
    // Both keys should have the same structure, just different hash values
    const parts1 = s3Key1.split('/');
    const parts2 = s3Key2.split('/');
    
    expect(parts1).toHaveLength(6);
    expect(parts2).toHaveLength(6);
    expect(parts1[0]).toBe('docs');
    expect(parts1[1]).toBe('seller');
    expect(parts1[2]).toBe('seller123');
    expect(parts1[3]).toBe('anomalies');
    expect(parts1[4]).toBe('anomaly456');
    expect(parts1[5]).toMatch(/^costdoc\/v1\.0-[a-f0-9]{8}\.pdf$/);
    
    expect(parts2[0]).toBe('docs');
    expect(parts2[1]).toBe('seller');
    expect(parts2[2]).toBe('seller123');
    expect(parts2[3]).toBe('anomalies');
    expect(parts2[4]).toBe('anomaly456');
    expect(parts2[5]).toMatch(/^costdoc\/v1\.0-[a-f0-9]{8}\.pdf$/);
  });

  test('should handle very long seller and anomaly IDs', () => {
    const longSellerId = 'a'.repeat(100);
    const longAnomalyId = 'b'.repeat(100);
    const evidenceHash = computeEvidenceSha256(sampleEvidence);
    
    const s3Key = generateS3Key(longSellerId, longAnomalyId, '1.0', evidenceHash);
    
    expect(s3Key).toContain(longSellerId);
    expect(s3Key).toContain(longAnomalyId);
    expect(s3Key).toMatch(/\.pdf$/);
  });

  test('should handle template versions with special characters', () => {
    const evidenceHash = computeEvidenceSha256(sampleEvidence);
    
    const s3Key1 = generateS3Key('seller123', 'anomaly456', '1.0-beta', evidenceHash);
    const s3Key2 = generateS3Key('seller123', 'anomaly456', '2.1.0', evidenceHash);
    
    expect(s3Key1).toContain('v1.0-beta');
    expect(s3Key2).toContain('v2.1.0');
    expect(s3Key1).not.toBe(s3Key2);
  });

  test('should ensure S3 key uniqueness across different combinations', () => {
    const evidenceHash1 = computeEvidenceSha256(sampleEvidence);
    const evidenceHash2 = computeEvidenceSha256({ ...sampleEvidence, total_impact: 200.50 });
    
    const keys = new Set();
    
    // Generate keys for different combinations
    keys.add(generateS3Key('seller123', 'anomaly456', '1.0', evidenceHash1));
    keys.add(generateS3Key('seller123', 'anomaly456', '1.0', evidenceHash2));
    keys.add(generateS3Key('seller123', 'anomaly456', '2.0', evidenceHash1));
    keys.add(generateS3Key('seller123', 'anomaly789', '1.0', evidenceHash1));
    keys.add(generateS3Key('seller789', 'anomaly456', '1.0', evidenceHash1));
    
    // All keys should be unique
    expect(keys.size).toBe(5);
  });
});




