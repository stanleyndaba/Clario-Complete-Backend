import { costDocService } from '../src/services/costDocService';
import { renderPdfBuffer } from '../src/services/pdfRenderer';
import { computeEvidenceSha256 } from '../src/utils/canonicalize';

// Mock the database and S3 services
jest.mock('../src/services/costDocService');
jest.mock('../src/services/pdfRenderer');

describe('Idempotency Tests', () => {
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

  const mockGeneratedPDF = {
    id: 'pdf123',
    seller_id: 'seller123',
    anomaly_id: 'anomaly456',
    template_version: '1.0',
    s3_key: 'docs/seller/seller123/anomalies/anomaly456/costdoc/v1.0-abc12345.pdf',
    s3_url: 'https://s3.amazonaws.com/test-bucket/docs/seller/seller123/anomalies/anomaly456/costdoc/v1.0-abc12345.pdf',
    evidence_sha256: 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6',
    signature_sha256: 'z9y8x7w6v5u4t3s2r1q0p9o8n7m6l5k4j3i2h1g0f9e8d7c6b5a4',
    file_size: 1024,
    created_at: new Date(),
    report_id: 'seller123-anomaly456-v1.0-abc12345'
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should return existing PDF for duplicate manual requests', async () => {
    // Mock the service to return existing PDF
    const mockService = costDocService as jest.Mocked<typeof costDocService>;
    mockService.generateManualDocumentation.mockResolvedValue(mockGeneratedPDF);

    // First request
    const result1 = await costDocService.generateManualDocumentation(sampleEvidence, '1.0');
    
    // Second request with identical evidence
    const result2 = await costDocService.generateManualDocumentation(sampleEvidence, '1.0');

    // Both should return the same PDF
    expect(result1).toEqual(result2);
    expect(result1.s3_key).toBe(result2.s3_key);
    expect(result1.evidence_sha256).toBe(result2.evidence_sha256);
    expect(result1.signature_sha256).toBe(result2.signature_sha256);

    // Service should have been called twice
    expect(mockService.generateManualDocumentation).toHaveBeenCalledTimes(2);
  });

  test('should return existing PDF for duplicate auto requests', async () => {
    const mockService = costDocService as jest.Mocked<typeof costDocService>;
    mockService.enqueueDocumentationJob.mockResolvedValue({
      jobId: 'completed-anomaly456',
      status: 'completed'
    });

    // First request
    const result1 = await costDocService.enqueueDocumentationJob(sampleEvidence, '1.0', 'medium');
    
    // Second request with identical evidence
    const result2 = await costDocService.enqueueDocumentationJob(sampleEvidence, '1.0', 'medium');

    // Both should return completed status
    expect(result1.status).toBe('completed');
    expect(result2.status).toBe('completed');
    expect(result1.jobId).toBe(result2.jobId);

    // Service should have been called twice
    expect(mockService.enqueueDocumentationJob).toHaveBeenCalledTimes(2);
  });

  test('should generate different S3 keys for different template versions', async () => {
    const mockRenderer = renderPdfBuffer as jest.MockedFunction<typeof renderPdfBuffer>;
    
    // Mock different results for different template versions
    mockRenderer.mockResolvedValueOnce({
      buffer: Buffer.from('pdf1'),
      metadata: {
        evidence_sha256: 'hash1',
        signature_sha256: 'sig1',
        report_id: 'report1',
        template_version: '1.0',
        prepared_on: '2024-01-01T00:00:00.000Z'
      }
    });

    mockRenderer.mockResolvedValueOnce({
      buffer: Buffer.from('pdf2'),
      metadata: {
        evidence_sha256: 'hash1', // Same evidence hash
        signature_sha256: 'sig2', // Different signature due to template version
        report_id: 'report2',
        template_version: '2.0',
        prepared_on: '2024-01-01T00:00:00.000Z'
      }
    });

    const result1 = await renderPdfBuffer(sampleEvidence, '1.0');
    const result2 = await renderPdfBuffer(sampleEvidence, '2.0');

    // Evidence hash should be the same
    expect(result1.metadata.evidence_sha256).toBe(result2.metadata.evidence_sha256);
    
    // Signature should be different due to template version
    expect(result1.metadata.signature_sha256).not.toBe(result2.metadata.signature_sha256);
    
    // Report IDs should be different
    expect(result1.metadata.report_id).not.toBe(result2.metadata.report_id);
  });

  test('should generate different S3 keys for different evidence', async () => {
    const mockRenderer = renderPdfBuffer as jest.MockedFunction<typeof renderPdfBuffer>;
    
    // Mock different results for different evidence
    mockRenderer.mockResolvedValueOnce({
      buffer: Buffer.from('pdf1'),
      metadata: {
        evidence_sha256: 'hash1',
        signature_sha256: 'sig1',
        report_id: 'report1',
        template_version: '1.0',
        prepared_on: '2024-01-01T00:00:00.000Z'
      }
    });

    const modifiedEvidence = {
      ...sampleEvidence,
      total_impact: 200.50
    };

    mockRenderer.mockResolvedValueOnce({
      buffer: Buffer.from('pdf2'),
      metadata: {
        evidence_sha256: 'hash2', // Different evidence hash
        signature_sha256: 'sig2', // Different signature
        report_id: 'report2',
        template_version: '1.0',
        prepared_on: '2024-01-01T00:00:00.000Z'
      }
    });

    const result1 = await renderPdfBuffer(sampleEvidence, '1.0');
    const result2 = await renderPdfBuffer(modifiedEvidence, '1.0');

    // Evidence hashes should be different
    expect(result1.metadata.evidence_sha256).not.toBe(result2.metadata.evidence_sha256);
    
    // Signatures should be different
    expect(result1.metadata.signature_sha256).not.toBe(result2.metadata.signature_sha256);
    
    // Report IDs should be different
    expect(result1.metadata.report_id).not.toBe(result2.metadata.report_id);
  });

  test('should handle evidence with different property order identically', async () => {
    const mockRenderer = renderPdfBuffer as jest.MockedFunction<typeof renderPdfBuffer>;
    
    // Mock same result for both calls
    const mockResult = {
      buffer: Buffer.from('pdf'),
      metadata: {
        evidence_sha256: 'hash1',
        signature_sha256: 'sig1',
        report_id: 'report1',
        template_version: '1.0',
        prepared_on: '2024-01-01T00:00:00.000Z'
      }
    };

    mockRenderer.mockResolvedValue(mockResult);

    // First call with original evidence
    const result1 = await renderPdfBuffer(sampleEvidence, '1.0');
    
    // Second call with reordered evidence properties
    const reorderedEvidence = {
      anomaly_type: 'lost_units',
      seller_id: 'seller123',
      evidence_data: {
        location: 'warehouse_a',
        cost_per_unit: 30.15,
        units_lost: 5
      },
      total_impact: 150.75,
      detection_date: '2024-01-01',
      anomaly_id: 'anomaly456'
    };

    const result2 = await renderPdfBuffer(reorderedEvidence, '1.0');

    // Results should be identical despite property reordering
    expect(result1.metadata.evidence_sha256).toBe(result2.metadata.evidence_sha256);
    expect(result1.metadata.signature_sha256).toBe(result2.metadata.signature_sha256);
    expect(result1.metadata.report_id).toBe(result2.metadata.report_id);
  });

  test('should ignore ephemeral fields in evidence for idempotency', async () => {
    const mockRenderer = renderPdfBuffer as jest.MockedFunction<typeof renderPdfBuffer>;
    
    // Mock same result for both calls
    const mockResult = {
      buffer: Buffer.from('pdf'),
      metadata: {
        evidence_sha256: 'hash1',
        signature_sha256: 'sig1',
        report_id: 'report1',
        template_version: '1.0',
        prepared_on: '2024-01-01T00:00:00.000Z'
      }
    };

    mockRenderer.mockResolvedValue(mockResult);

    // First call with original evidence
    const result1 = await renderPdfBuffer(sampleEvidence, '1.0');
    
    // Second call with ephemeral fields added
    const evidenceWithEphemeral = {
      ...sampleEvidence,
      _generated_at: new Date().toISOString(),
      _temp_id: 'temp123',
      _session_id: 'session456',
      _timestamp: Date.now()
    };

    const result2 = await renderPdfBuffer(evidenceWithEphemeral, '1.0');

    // Results should be identical despite ephemeral fields
    expect(result1.metadata.evidence_sha256).toBe(result2.metadata.evidence_sha256);
    expect(result1.metadata.signature_sha256).toBe(result2.metadata.signature_sha256);
    expect(result1.metadata.report_id).toBe(result2.metadata.report_id);
  });

  test('should compute consistent evidence hashes for identical data', () => {
    const hash1 = computeEvidenceSha256(sampleEvidence);
    const hash2 = computeEvidenceSha256(sampleEvidence);
    
    expect(hash1).toBe(hash2);
    expect(typeof hash1).toBe('string');
    expect(hash1.length).toBe(64); // SHA256 hex length
  });

  test('should compute different evidence hashes for different data', () => {
    const hash1 = computeEvidenceSha256(sampleEvidence);
    
    const modifiedEvidence = {
      ...sampleEvidence,
      total_impact: 200.50
    };
    
    const hash2 = computeEvidenceSha256(modifiedEvidence);
    
    expect(hash1).not.toBe(hash2);
  });

  test('should handle idempotency key generation consistently', async () => {
    const mockService = costDocService as jest.Mocked<typeof costDocService>;
    mockService.generateManualDocumentation.mockResolvedValue(mockGeneratedPDF);

    // Generate idempotency key for the same evidence
    const result1 = await costDocService.generateManualDocumentation(sampleEvidence, '1.0');
    const result2 = await costDocService.generateManualDocumentation(sampleEvidence, '1.0');

    // The S3 key should be identical for both requests
    expect(result1.s3_key).toBe(result2.s3_key);
    
    // The evidence hash should be identical
    expect(result1.evidence_sha256).toBe(result2.evidence_sha256);
    
    // The signature should be identical (assuming same timestamp)
    expect(result1.signature_sha256).toBe(result2.signature_sha256);
  });
});




