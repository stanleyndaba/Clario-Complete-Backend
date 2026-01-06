import puppeteer, { Browser, Page, LaunchOptions } from 'puppeteer';
import * as fs from 'fs';
import * as path from 'path';
import * as Handlebars from 'handlebars';
import { 
  computeEvidenceSha256, 
  computeSignatureHash, 
  createReportId,
  shortHash 
} from '../utils/canonicalize';

export interface PDFRenderOptions {
  format?: 'A4' | 'Letter' | 'Legal';
  margin?: {
    top: string;
    right: string;
    bottom: string;
    left: string;
  };
  printBackground?: boolean;
  preferCSSPageSize?: boolean;
  deterministic?: boolean;
}

export interface TemplateData {
  seller_id: string;
  anomaly_id: string;
  anomaly_type: string;
  template_version: string;
  prepared_on: string;
  evidence_sha256: string;
  signature_sha256: string;
  report_id: string;
  total_impact: string;
  [key: string]: any;
}

export interface RenderResult {
  buffer: Buffer;
  metadata: {
    evidence_sha256: string;
    signature_sha256: string;
    report_id: string;
    template_version: string;
    prepared_on: string;
  };
}

export class PDFRenderer {
  private browser: Browser | null = null;
  private templatesDir: string;
  private defaultOptions: PDFRenderOptions;

  constructor(templatesDir: string = path.join(__dirname, '../../templates')) {
    this.templatesDir = templatesDir;
    this.defaultOptions = {
      format: 'A4',
      margin: {
        top: '1in',
        right: '1in',
        bottom: '1in',
        left: '1in'
      },
      printBackground: true,
      preferCSSPageSize: true,
      deterministic: true
    };
  }

  /**
   * Initialize Puppeteer browser instance
   */
  async initialize(): Promise<void> {
    if (this.browser) {
      return;
    }

    const launchOptions: LaunchOptions = {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--font-render-hinting=medium',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--disable-extensions'
      ]
    };

    try {
      this.browser = await puppeteer.launch(launchOptions);
      console.log('PDF Renderer initialized successfully');
    } catch (error) {
      console.error('Failed to initialize PDF Renderer:', error);
      throw new Error(`PDF Renderer initialization failed: ${error}`);
    }
  }

  /**
   * Render PDF buffer from canonicalized JSON and template version
   */
  async renderPdfBuffer(
    canonicalJson: any,
    templateVersion: string = '1.0'
  ): Promise<RenderResult> {
    if (!this.browser) {
      await this.initialize();
    }

    if (!this.browser) {
      throw new Error('Browser not initialized');
    }

    // Canonicalize the input data
    const canonicalizedData = this.canonicalizeInputData(canonicalJson);
    
    // Compute hashes
    const evidenceSha256 = computeEvidenceSha256(canonicalizedData);
    const preparedOn = new Date().toISOString();
    const signatureSha256 = computeSignatureHash(evidenceSha256, templateVersion, preparedOn);
    
    // Create report ID
    const reportId = createReportId(
      canonicalizedData.seller_id,
      canonicalizedData.anomaly_id,
      templateVersion
    );

    // Prepare template data
    const templateData: TemplateData = {
      ...canonicalizedData,
      template_version: templateVersion,
      prepared_on: preparedOn,
      evidence_sha256: evidenceSha256,
      signature_sha256: signatureSha256,
      report_id: reportId
    };

    // Render HTML from templates
    const html = await this.renderTemplates(templateData, templateVersion);
    
    // Generate PDF
    const buffer = await this.generatePDF(html);
    
    return {
      buffer,
      metadata: {
        evidence_sha256: evidenceSha256,
        signature_sha256: signatureSha256,
        report_id: reportId,
        template_version: templateVersion,
        prepared_on: preparedOn
      }
    };
  }

  /**
   * Render PDF and upload to S3
   */
  async renderPdfToS3(
    buffer: Buffer,
    s3Key: string
  ): Promise<{ s3Key: string; url: string }> {
    // This would integrate with your S3 service
    // For now, we'll simulate the upload
    console.log(`Simulating S3 upload to key: ${s3Key}`);
    
    // In production, this would use your S3 client
    // await this.s3Client.upload({
    //   Bucket: process.env.S3_BUCKET_NAME,
    //   Key: s3Key,
    //   Body: buffer,
    //   ContentType: 'application/pdf'
    // }).promise();
    
    const url = `https://s3.amazonaws.com/${process.env.S3_BUCKET_NAME || 'test-bucket'}/${s3Key}`;
    
    return { s3Key, url };
  }

  /**
   * Canonicalize input data for consistent rendering
   */
  private canonicalizeInputData(data: any): any {
    // Remove any ephemeral fields that could affect determinism
    const { _generated_at, _temp_id, _session_id, ...canonicalData } = data;
    
    // Ensure required fields exist
    if (!canonicalData.seller_id || !canonicalData.anomaly_id) {
      throw new Error('Missing required fields: seller_id and anomaly_id');
    }
    
    return canonicalData;
  }

  /**
   * Render all templates into a single HTML document
   */
  private async renderTemplates(data: TemplateData, version: string): Promise<string> {
    const templateFiles = [
      'title.hbs',
      'evidence.hbs',
      'costs.hbs',
      'attachments.hbs',
      'legal.hbs'
    ];

    const renderedPages: string[] = [];

    for (const templateFile of templateFiles) {
      const templatePath = path.join(this.templatesDir, version, templateFile);
      
      if (!fs.existsSync(templatePath)) {
        throw new Error(`Template file not found: ${templatePath}`);
      }

      const templateContent = fs.readFileSync(templatePath, 'utf-8');
      const template = Handlebars.compile(templateContent);
      const renderedPage = template(data);
      
      // Remove the HTML wrapper to combine pages
      const pageContent = renderedPage
        .replace(/<!DOCTYPE html>.*?<body[^>]*>/s, '')
        .replace(/<\/body>.*?<\/html>/s, '')
        .trim();
      
      renderedPages.push(pageContent);
    }

    // Combine all pages into a single HTML document
    const combinedHTML = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Cost Documentation Report - ${data.anomaly_type}</title>
    <link rel="stylesheet" href="${path.join(this.templatesDir, '_styles.css')}">
</head>
<body>
    ${renderedPages.join('\n')}
</body>
</html>`;

    return combinedHTML;
  }

  /**
   * Generate PDF from HTML using Puppeteer
   */
  private async generatePDF(html: string): Promise<Buffer> {
    if (!this.browser) {
      throw new Error('Browser not initialized');
    }

    let page: Page | null = null;
    
    try {
      page = await this.browser.newPage();
      
      // Set deterministic viewport and user agent
      await page.setViewport({
        width: 1200,
        height: 800
      });
      
      await page.setUserAgent('SackAI-CostDocs-Renderer/1.0');
      
      // Set content
      await page.setContent(html, {
        waitUntil: 'networkidle0',
        timeout: 30000
      });
      
      // Wait for any dynamic content to settle
      await page.waitForTimeout(1000);
      
      // Generate PDF with deterministic options
      const pdfBuffer = await page.pdf({
        format: this.defaultOptions.format,
        margin: this.defaultOptions.margin,
        printBackground: this.defaultOptions.printBackground,
        preferCSSPageSize: this.defaultOptions.preferCSSPageSize,
        displayHeaderFooter: false,
        omitBackground: false
      });
      
      return pdfBuffer;
      
    } catch (error) {
      console.error('PDF generation failed:', error);
      throw new Error(`PDF generation failed: ${error}`);
    } finally {
      if (page) {
        await page.close();
      }
    }
  }

  /**
   * Generate S3 key for the PDF
   */
  generateS3Key(
    sellerId: string,
    anomalyId: string,
    templateVersion: string,
    evidenceSha256: string
  ): string {
    const shortHashValue = shortHash(evidenceSha256);
    return `docs/seller/${sellerId}/anomalies/${anomalyId}/costdoc/v${templateVersion}-${shortHashValue}.pdf`;
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      console.log('PDF Renderer cleaned up');
    }
  }

  /**
   * Get browser instance (for testing)
   */
  getBrowser(): Browser | null {
    return this.browser;
  }
}

// Export singleton instance
export const pdfRenderer = new PDFRenderer();

// Export convenience functions
export async function renderPdfBuffer(
  canonicalJson: any,
  templateVersion: string = '1.0'
): Promise<RenderResult> {
  return await pdfRenderer.renderPdfBuffer(canonicalJson, templateVersion);
}

export async function renderPdfToS3(
  buffer: Buffer,
  s3Key: string
): Promise<{ s3Key: string; url: string }> {
  return await pdfRenderer.renderPdfToS3(buffer, s3Key);
}





