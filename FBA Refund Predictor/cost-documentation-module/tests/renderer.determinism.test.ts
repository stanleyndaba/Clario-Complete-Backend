import { PDFGenerationService } from '../src/services/pdfGenerationService';
import { AnomalyEvidence, PDFTemplate } from '../src/types/costDocumentation';
import crypto from 'crypto';

// Mock system clock to ensure deterministic output
const mockDate = new Date('2025-01-15T10:30:00.000Z');
const RealDate = Date;
global.Date = class extends RealDate {
  constructor() {
    super();
    return mockDate;
  }
  static now() {
    return mockDate.getTime();
  }
} as any;

describe('PDF Renderer Determinism', () => {
  let pdfService: PDFGenerationService;
  
  const mockEvidence: AnomalyEvidence = {
    anomaly_id: 'test-anomaly-123',
    type: 'lost_units',
    sku: 'TEST-SKU-001',
    expected_units: 100,
    received_units: 95,
    loss: 5,
    cost_per_unit: 12.50,
    total_loss: 62.50,
    detected_at: '2025-01-15T10:30:00Z',
    evidence_links: [
      's3://artifacts/receiving_scan.pdf',
      's3://artifacts/invoice.pdf'
    ],
    seller_info: {
      seller_id: 'seller-123',
      business_name: 'Test Company Inc.',
      email: 'test@example.com'
    }
  };

  const mockTemplate: PDFTemplate = {
    id: 'template-123',
    name: 'Lost Units Template',
    anomaly_type: 'lost_units',
    template_html: `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Cost Documentation - {{anomaly.type}}</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 20px; }
          .header { text-align: center; border-bottom: 2px solid #333; padding-bottom: 20px; }
          .section { margin-bottom: 20px; }
          .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
          .info-item { padding: 10px; background: #f5f5f5; border-radius: 5px; }
          .cost-table { width: 100%; border-collapse: collapse; margin: 20px 0; }
          .cost-table th, .cost-table td { border: 1px solid #ddd; padding: 12px; text-align: left; }
          .total-row { font-weight: bold; background: #e8f5e8; }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>Cost Documentation Report</h1>
          <h2>{{anomaly.type}} Anomaly</h2>
          <p>Generated on {{generatedAt}}</p>
        </div>
        
        <div class="section">
          <div class="section-title">Anomaly Details</div>
          <div class="info-grid">
            <div class="info-item">
              <div class="info-label">Anomaly ID:</div>
              <div>{{anomaly.anomaly_id}}</div>
            </div>
            <div class="info-item">
              <div class="info-label">SKU:</div>
              <div>{{anomaly.sku}}</div>
            </div>
            <div class="info-item">
              <div class="info-label">Detection Date:</div>
              <div>{{anomaly.detected_at}}</div>
            </div>
            <div class="info-item">
              <div class="info-label">Anomaly Type:</div>
              <div>{{anomaly.type}}</div>
            </div>
          </div>
        </div>
        
        <div class="section">
          <div class="section-title">Cost Breakdown</div>
          <table class="cost-table">
            <thead>
              <tr>
                <th>Item Description</th>
                <th>Quantity</th>
                <th>Unit Cost</th>
                <th>Total Cost</th>
              </tr>
            </thead>
            <tbody>
              {{#each costBreakdown}}
              <tr>
                <td>{{item_description}}</td>
                <td>{{quantity}}</td>
                <td>${{unit_cost}}</td>
                <td>${{total_cost}}</td>
              </tr>
              {{/each}}
              <tr class="total-row">
                <td colspan="3">Total Loss:</td>
                <td>${{anomaly.total_loss}}</td>
              </tr>
            </tbody>
          </table>
        </div>
        
        <div class="section">
          <div class="section-title">Evidence</div>
          <p><strong>{{evidenceSection.title}}</strong></p>
          <p>{{evidenceSection.description}}</p>
          <div>{{{evidenceSection.embedded_content}}}</div>
        </div>
        
        <div class="footer">
          <p>{{watermark}}</p>
        </div>
      </body>
      </html>
    `,
    is_active: true,
    created_at: '2025-01-15T10:30:00Z',
    updated_at: '2025-01-15T10:30:00Z'
  };

  beforeAll(async () => {
    pdfService = new PDFGenerationService();
    try {
      await pdfService.initialize();
    } catch (error) {
      console.warn('Puppeteer not available in test environment:', error);
    }
  });

  afterAll(async () => {
    try {
      await pdfService.cleanup();
    } catch (error) {
      console.warn('Could not cleanup PDF service:', error);
    }
    // Restore original Date
    global.Date = RealDate;
  });

  describe('Deterministic PDF Generation', () => {
    it('should generate identical PDFs for identical inputs', async () => {
      try {
        // Generate PDF twice with identical inputs
        const pdf1 = await pdfService.generatePDF(mockEvidence, mockTemplate, {
          include_watermark: true,
          include_timestamp: true
        });
        
        const pdf2 = await pdfService.generatePDF(mockEvidence, mockTemplate, {
          include_watermark: true,
          include_timestamp: true
        });

        // Calculate SHA256 hashes
        const hash1 = crypto.createHash('sha256').update(pdf1).digest('hex');
        const hash2 = crypto.createHash('sha256').update(pdf2).digest('hex');

        // PDFs should be identical
        expect(hash1).toBe(hash2);
        expect(pdf1.length).toBe(pdf2.length);
        
        console.log(`✅ Generated identical PDFs: ${hash1}`);
        console.log(`📄 PDF size: ${pdf1.length} bytes`);
      } catch (error) {
        if (error.message.includes('Puppeteer')) {
          console.warn('Skipping Puppeteer test in CI environment');
          return;
        }
        throw error;
      }
    });

    it('should generate identical PDFs with deterministic mode enabled', async () => {
      try {
        // Generate PDFs with deterministic mode
        const pdf1 = await pdfService.generatePDF(mockEvidence, mockTemplate, {
          include_watermark: true,
          include_timestamp: true,
          deterministic: true
        });
        
        const pdf2 = await pdfService.generatePDF(mockEvidence, mockTemplate, {
          include_watermark: true,
          include_timestamp: true,
          deterministic: true
        });

        const hash1 = crypto.createHash('sha256').update(pdf1).digest('hex');
        const hash2 = crypto.createHash('sha256').update(pdf2).digest('hex');

        expect(hash1).toBe(hash2);
        console.log(`✅ Deterministic mode PDFs identical: ${hash1}`);
      } catch (error) {
        if (error.message.includes('Puppeteer')) {
          console.warn('Skipping Puppeteer test in CI environment');
          return;
        }
        throw error;
      }
    });

    it('should handle template compilation deterministically', () => {
      // Test that template compilation is deterministic
      const template1 = pdfService.getDefaultTemplate('lost_units');
      const template2 = pdfService.getDefaultTemplate('lost_units');
      
      expect(template1).toBe(template2);
      
      // Template should contain expected placeholders
      expect(template1).toContain('{{anomaly.type}}');
      expect(template1).toContain('{{anomaly.anomaly_id}}');
      expect(template1).toContain('{{anomaly.sku}}');
    });

    it('should prepare template data deterministically', () => {
      const service = pdfService as any;
      const data1 = service.prepareTemplateData(mockEvidence, { include_watermark: true });
      const data2 = service.prepareTemplateData(mockEvidence, { include_watermark: true });
      
      // Template data should be identical
      expect(data1.generatedAt).toBe(data2.generatedAt);
      expect(data1.watermark).toBe(data2.watermark);
      expect(data1.anomaly.anomaly_id).toBe(data2.anomaly.anomaly_id);
      
      // Cost breakdown should be identical
      expect(data1.costBreakdown).toEqual(data2.costBreakdown);
      expect(data1.evidenceSection).toEqual(data2.evidenceSection);
    });
  });

  describe('Template Stability', () => {
    it('should maintain consistent template structure across renders', () => {
      const template = pdfService.getDefaultTemplate('lost_units');
      
      // Template should have consistent structure
      expect(template).toContain('<!DOCTYPE html>');
      expect(template).toContain('<html>');
      expect(template).toContain('<head>');
      expect(template).toContain('<body>');
      expect(template).toContain('Cost Documentation Report');
      
      // Should not contain dynamic content that could change
      expect(template).not.toContain('Date.now()');
      expect(template).not.toContain('Math.random()');
      expect(template).not.toContain('new Date()');
    });

    it('should handle different anomaly types consistently', () => {
      const types = ['lost_units', 'overcharges', 'damaged_stock'];
      
      types.forEach(type => {
        const template = pdfService.getDefaultTemplate(type);
        expect(template).toContain('Cost Documentation Report');
        expect(template).toContain('{{anomaly.type}}');
        expect(template).toContain('{{anomaly.anomaly_id}}');
      });
    });
  });

  describe('Evidence Processing Determinism', () => {
    it('should process evidence links consistently', () => {
      const service = pdfService as any;
      const evidenceSection1 = service.prepareEvidenceSection(mockEvidence);
      const evidenceSection2 = service.prepareEvidenceSection(mockEvidence);
      
      expect(evidenceSection1.title).toBe(evidenceSection2.title);
      expect(evidenceSection1.description).toBe(evidenceSection2.description);
      expect(evidenceSection1.links).toEqual(evidenceSection2.links);
      expect(evidenceSection1.embedded_content).toBe(evidenceSection2.embedded_content);
    });

    it('should calculate cost breakdown consistently', () => {
      const service = pdfService as any;
      const breakdown1 = service.calculateCostBreakdown(mockEvidence);
      const breakdown2 = service.calculateCostBreakdown(mockEvidence);
      
      expect(breakdown1).toEqual(breakdown2);
      
      // Verify calculations are correct
      const lostUnits = mockEvidence.expected_units - mockEvidence.received_units;
      const expectedTotal = lostUnits * mockEvidence.cost_per_unit;
      
      expect(breakdown1[0].quantity).toBe(lostUnits);
      expect(breakdown1[0].total_cost).toBe(expectedTotal);
    });
  });
});








