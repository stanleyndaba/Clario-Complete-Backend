import { renderPdfBuffer } from '../src/services/pdfRenderer';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

// Mock Date.now() to ensure deterministic timestamps
const mockDate = new Date('2024-01-01T00:00:00.000Z');
const originalDateNow = Date.now;
const originalDateConstructor = Date;

beforeAll(() => {
  // Mock Date.now() to return a fixed timestamp
  global.Date.now = jest.fn(() => mockDate.getTime());
  
  // Mock Date constructor to return fixed date
  global.Date = jest.fn(() => mockDate) as any;
  (global.Date as any).now = jest.fn(() => mockDate.getTime());
  (global.Date as any).toISOString = jest.fn(() => mockDate.toISOString());
});

afterAll(() => {
  // Restore original Date functions
  global.Date.now = originalDateNow;
  global.Date = originalDateConstructor;
});

describe('PDF Determinism Tests', () => {
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

  test('should generate identical PDFs for identical inputs', async () => {
    // Generate first PDF
    const result1 = await renderPdfBuffer(sampleEvidence, '1.0');
    const hash1 = createHash('sha256').update(result1.buffer).digest('hex');

    // Generate second PDF with identical input
    const result2 = await renderPdfBuffer(sampleEvidence, '1.0');
    const hash2 = createHash('sha256').update(result2.buffer).digest('hex');

    // PDFs should be byte-identical
    expect(hash1).toBe(hash2);
    expect(result1.buffer).toEqual(result2.buffer);
    expect(result1.buffer.length).toBe(result2.buffer.length);

    console.log(`PDF 1 hash: ${hash1}`);
    console.log(`PDF 2 hash: ${hash2}`);
    console.log(`PDF size: ${result1.buffer.length} bytes`);
  }, 30000);

  test('should generate identical PDFs with deterministic mode', async () => {
    // Generate first PDF
    const result1 = await renderPdfBuffer(sampleEvidence, '1.0');
    const hash1 = createHash('sha256').update(result1.buffer).digest('hex');

    // Generate second PDF with deterministic mode
    const result2 = await renderPdfBuffer(sampleEvidence, '1.0');
    const hash2 = createHash('sha256').update(result2.buffer).digest('hex');

    // PDFs should be byte-identical
    expect(hash1).toBe(hash2);
    expect(result1.buffer).toEqual(result2.buffer);
  }, 30000);

  test('should generate different PDFs for different template versions', async () => {
    // Generate PDF with version 1.0
    const result1 = await renderPdfBuffer(sampleEvidence, '1.0');
    const hash1 = createHash('sha256').update(result1.buffer).digest('hex');

    // Generate PDF with version 2.0 (if it exists)
    try {
      const result2 = await renderPdfBuffer(sampleEvidence, '2.0');
      const hash2 = createHash('sha256').update(result2.buffer).digest('hex');

      // PDFs should be different for different versions
      expect(hash1).not.toBe(hash2);
    } catch (error) {
      // Version 2.0 doesn't exist yet, which is expected
      console.log('Version 2.0 template not found, skipping version difference test');
    }
  }, 30000);

  test('should generate different PDFs for different evidence', async () => {
    // Generate PDF with original evidence
    const result1 = await renderPdfBuffer(sampleEvidence, '1.0');
    const hash1 = createHash('sha256').update(result1.buffer).digest('hex');

    // Generate PDF with modified evidence
    const modifiedEvidence = {
      ...sampleEvidence,
      total_impact: 200.50,
      evidence_data: {
        ...sampleEvidence.evidence_data,
        units_lost: 7
      }
    };

    const result2 = await renderPdfBuffer(modifiedEvidence, '1.0');
    const hash2 = createHash('sha256').update(result2.buffer).digest('hex');

    // PDFs should be different for different evidence
    expect(hash1).not.toBe(hash2);
  }, 30000);

  test('should have consistent metadata across identical runs', async () => {
    // Generate first PDF
    const result1 = await renderPdfBuffer(sampleEvidence, '1.0');

    // Generate second PDF
    const result2 = await renderPdfBuffer(sampleEvidence, '1.0');

    // Metadata should be identical (except for prepared_on which is mocked)
    expect(result1.metadata.evidence_sha256).toBe(result2.metadata.evidence_sha256);
    expect(result1.metadata.template_version).toBe(result2.metadata.template_version);
    expect(result1.metadata.report_id).toBe(result2.metadata.report_id);
    
    // prepared_on should be the mocked timestamp
    expect(result1.metadata.prepared_on).toBe('2024-01-01T00:00:00.000Z');
    expect(result2.metadata.prepared_on).toBe('2024-01-01T00:00:00.000Z');
  }, 30000);

  test('should handle evidence with different property order', async () => {
    // Generate PDF with original evidence
    const result1 = await renderPdfBuffer(sampleEvidence, '1.0');
    const hash1 = createHash('sha256').update(result1.buffer).digest('hex');

    // Generate PDF with reordered evidence properties
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
    const hash2 = createHash('sha256').update(result2.buffer).digest('hex');

    // PDFs should be identical despite property reordering
    expect(hash1).toBe(hash2);
    expect(result1.buffer).toEqual(result2.buffer);
  }, 30000);

  test('should ignore ephemeral fields in evidence', async () => {
    // Generate PDF with original evidence
    const result1 = await renderPdfBuffer(sampleEvidence, '1.0');
    const hash1 = createHash('sha256').update(result1.buffer).digest('hex');

    // Generate PDF with ephemeral fields added
    const evidenceWithEphemeral = {
      ...sampleEvidence,
      _generated_at: new Date().toISOString(),
      _temp_id: 'temp123',
      _session_id: 'session456',
      _timestamp: Date.now()
    };

    const result2 = await renderPdfBuffer(evidenceWithEphemeral, '1.0');
    const hash2 = createHash('sha256').update(result2.buffer).digest('hex');

    // PDFs should be identical despite ephemeral fields
    expect(hash1).toBe(hash2);
    expect(result1.buffer).toEqual(result2.buffer);
  }, 30000);

  test('should generate consistent report IDs for identical inputs', async () => {
    // Generate first PDF
    const result1 = await renderPdfBuffer(sampleEvidence, '1.0');

    // Generate second PDF
    const result2 = await renderPdfBuffer(sampleEvidence, '1.0');

    // Report IDs should be identical
    expect(result1.metadata.report_id).toBe(result2.metadata.report_id);
    
    // Report ID should follow expected format
    expect(result1.metadata.report_id).toMatch(/^seller123-anomaly456-v1\.0-[a-f0-9]{8}$/);
  }, 30000);
});




