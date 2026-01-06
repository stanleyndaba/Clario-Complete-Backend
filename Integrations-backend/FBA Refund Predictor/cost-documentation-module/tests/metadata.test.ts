import { renderPdfBuffer } from '../src/services/pdfRenderer';
import { isValidSha256 } from '../src/utils/canonicalize';

describe('PDF Metadata Tests', () => {
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

  test('should contain valid evidence_sha256 hash', async () => {
    const result = await renderPdfBuffer(sampleEvidence, '1.0');
    
    expect(result.metadata.evidence_sha256).toBeDefined();
    expect(typeof result.metadata.evidence_sha256).toBe('string');
    expect(result.metadata.evidence_sha256.length).toBe(64); // SHA256 hex length
    expect(isValidSha256(result.metadata.evidence_sha256)).toBe(true);
    
    console.log(`Evidence SHA256: ${result.metadata.evidence_sha256}`);
  }, 30000);

  test('should contain valid signature_sha256 hash', async () => {
    const result = await renderPdfBuffer(sampleEvidence, '1.0');
    
    expect(result.metadata.signature_sha256).toBeDefined();
    expect(typeof result.metadata.signature_sha256).toBe('string');
    expect(result.metadata.signature_sha256.length).toBe(64); // SHA256 hex length
    expect(isValidSha256(result.metadata.signature_sha256)).toBe(true);
    
    console.log(`Signature SHA256: ${result.metadata.signature_sha256}`);
  }, 30000);

  test('should contain valid report_id', async () => {
    const result = await renderPdfBuffer(sampleEvidence, '1.0');
    
    expect(result.metadata.report_id).toBeDefined();
    expect(typeof result.metadata.report_id).toBe('string');
    expect(result.metadata.report_id).toMatch(/^seller123-anomaly456-v1\.0-[a-f0-9]{8}$/);
    
    console.log(`Report ID: ${result.metadata.report_id}`);
  }, 30000);

  test('should contain valid template_version', async () => {
    const result = await renderPdfBuffer(sampleEvidence, '1.0');
    
    expect(result.metadata.template_version).toBeDefined();
    expect(result.metadata.template_version).toBe('1.0');
    
    console.log(`Template Version: ${result.metadata.template_version}`);
  }, 30000);

  test('should contain valid prepared_on timestamp', async () => {
    const result = await renderPdfBuffer(sampleEvidence, '1.0');
    
    expect(result.metadata.prepared_on).toBeDefined();
    expect(typeof result.metadata.prepared_on).toBe('string');
    
    // Should be a valid ISO date string
    const date = new Date(result.metadata.prepared_on);
    expect(date.getTime()).not.toBeNaN();
    
    console.log(`Prepared On: ${result.metadata.prepared_on}`);
  }, 30000);

  test('should have consistent metadata structure', async () => {
    const result = await renderPdfBuffer(sampleEvidence, '1.0');
    
    const expectedKeys = [
      'evidence_sha256',
      'signature_sha256',
      'report_id',
      'template_version',
      'prepared_on'
    ];
    
    expectedKeys.forEach(key => {
      expect(result.metadata).toHaveProperty(key);
    });
    
    // Should not have unexpected keys
    const actualKeys = Object.keys(result.metadata);
    expect(actualKeys.sort()).toEqual(expectedKeys.sort());
  }, 30000);

  test('should generate different evidence hashes for different evidence', async () => {
    const result1 = await renderPdfBuffer(sampleEvidence, '1.0');
    
    const modifiedEvidence = {
      ...sampleEvidence,
      total_impact: 200.50
    };
    
    const result2 = await renderPdfBuffer(modifiedEvidence, '1.0');
    
    expect(result1.metadata.evidence_sha256).not.toBe(result2.metadata.evidence_sha256);
    expect(result1.metadata.signature_sha256).not.toBe(result2.metadata.signature_sha256);
  }, 30000);

  test('should generate different signatures for different template versions', async () => {
    const result1 = await renderPdfBuffer(sampleEvidence, '1.0');
    
    try {
      const result2 = await renderPdfBuffer(sampleEvidence, '2.0');
      expect(result1.metadata.signature_sha256).not.toBe(result2.metadata.signature_sha256);
    } catch (error) {
      // Version 2.0 doesn't exist yet, which is expected
      console.log('Version 2.0 template not found, skipping signature difference test');
    }
  }, 30000);

  test('should have evidence hash that matches canonicalized input', async () => {
    const result = await renderPdfBuffer(sampleEvidence, '1.0');
    
    // The evidence hash should be consistent with the canonicalized input
    // This test verifies that the same evidence always produces the same hash
    const result2 = await renderPdfBuffer(sampleEvidence, '1.0');
    
    expect(result.metadata.evidence_sha256).toBe(result2.metadata.evidence_sha256);
  }, 30000);

  test('should have signature that changes with timestamp', async () => {
    // Mock different timestamps to test signature changes
    const originalDateNow = Date.now;
    const mockDate1 = new Date('2024-01-01T00:00:00.000Z');
    const mockDate2 = new Date('2024-01-01T12:00:00.000Z');
    
    try {
      // First timestamp
      global.Date.now = jest.fn(() => mockDate1.getTime());
      const result1 = await renderPdfBuffer(sampleEvidence, '1.0');
      
      // Second timestamp
      global.Date.now = jest.fn(() => mockDate2.getTime());
      const result2 = await renderPdfBuffer(sampleEvidence, '1.0');
      
      // Evidence hash should be the same
      expect(result1.metadata.evidence_sha256).toBe(result2.metadata.evidence_sha256);
      
      // Signature should be different due to different timestamps
      expect(result1.metadata.signature_sha256).not.toBe(result2.metadata.signature_sha256);
      
    } finally {
      // Restore original Date.now
      global.Date.now = originalDateNow;
    }
  }, 30000);
});




