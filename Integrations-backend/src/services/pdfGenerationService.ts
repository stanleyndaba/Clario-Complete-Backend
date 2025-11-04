import puppeteer from 'puppeteer';
import logger from '../../utils/logger';

export interface PDFGenerationOptions {
  format?: 'A4' | 'Letter';
  margin?: {
    top?: string;
    right?: string;
    bottom?: string;
    left?: string;
  };
  printBackground?: boolean;
}

export interface DocumentData {
  id: string;
  title: string;
  content: any; // Can be any document structure
  metadata?: {
    created_at?: string;
    seller_id?: string;
    anomaly_id?: string;
    claim_id?: string;
  };
}

export class PDFGenerationService {
  private browser: puppeteer.Browser | null = null;
  private initialized: boolean = false;

  /**
   * Initialize Puppeteer browser instance
   */
  async initialize(): Promise<void> {
    if (this.initialized && this.browser) {
      return;
    }

    try {
      logger.info('Initializing PDF Generation Service with Puppeteer...');
      
      // Try to use system Chrome if Puppeteer's bundled Chrome isn't available
      const launchOptions: any = {
        headless: 'new',
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu',
          '--disable-web-security'
        ]
      };

      // On Render, try using system Chrome if available
      // This allows Puppeteer to work even if bundled Chrome wasn't downloaded
      if (process.env.PUPPETEER_SKIP_CHROMIUM_DOWNLOAD === 'true' || process.env.RENDER) {
        // Try common Chrome locations on Render/Linux systems
        const possibleChromePaths = [
          '/usr/bin/google-chrome',
          '/usr/bin/google-chrome-stable',
          '/usr/bin/chromium',
          '/usr/bin/chromium-browser'
        ];
        
        for (const path of possibleChromePaths) {
          try {
            const fs = require('fs');
            if (fs.existsSync(path)) {
              launchOptions.executablePath = path;
              logger.info(`Using system Chrome at ${path}`);
              break;
            }
          } catch (e) {
            // Continue checking other paths
          }
        }
      }
      
      this.browser = await puppeteer.launch(launchOptions);

      this.initialized = true;
      logger.info('PDF Generation Service initialized successfully');
    } catch (error: any) {
      logger.error('Failed to initialize PDF Generation Service:', error);
      
      // Provide helpful error message for Render deployment
      if (error.message?.includes('Could not find Chrome') || error.message?.includes('executable')) {
        logger.warn('Chrome not found. PDF generation will be unavailable. Install Chrome or allow Puppeteer to download it.');
        throw new Error('PDF Generation Service requires Chrome/Chromium. Please install Chrome or set PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=false');
      }
      
      throw new Error(`PDF Generation Service initialization failed: ${error.message}`);
    }
  }

  /**
   * Generate PDF from HTML content
   */
  async generatePDFFromHTML(
    html: string,
    options: PDFGenerationOptions = {}
  ): Promise<Buffer> {
    if (!this.browser) {
      await this.initialize();
    }

    if (!this.browser) {
      throw new Error('PDF Generation Service not initialized');
    }

    try {
      const page = await this.browser.newPage();
      
      // Set content with proper waiting
      await page.setContent(html, { 
        waitUntil: 'networkidle0',
        timeout: 30000
      });

      // Generate PDF
      const pdfBuffer = await page.pdf({
        format: options.format || 'A4',
        printBackground: options.printBackground !== false,
        margin: options.margin || {
          top: '20mm',
          right: '20mm',
          bottom: '20mm',
          left: '20mm'
        }
      });

      await page.close();
      logger.info('PDF generated successfully');

      return pdfBuffer;
    } catch (error: any) {
      logger.error('Failed to generate PDF:', error);
      throw new Error(`PDF generation failed: ${error.message}`);
    }
  }

  /**
   * Generate PDF from document data
   */
  async generatePDFFromDocument(
    document: DocumentData,
    options: PDFGenerationOptions = {}
  ): Promise<Buffer> {
    // Generate HTML from document data
    const html = this.generateHTMLFromDocument(document);
    
    // Generate PDF from HTML
    return this.generatePDFFromHTML(html, options);
  }

  /**
   * Generate HTML template from document data
   */
  private generateHTMLFromDocument(document: DocumentData): string {
    const { title, content, metadata } = document;
    
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${title}</title>
  <style>
    body {
      font-family: Arial, sans-serif;
      margin: 0;
      padding: 20px;
      color: #333;
    }
    .header {
      border-bottom: 2px solid #333;
      padding-bottom: 20px;
      margin-bottom: 30px;
    }
    .header h1 {
      margin: 0;
      font-size: 24px;
      color: #2c3e50;
    }
    .metadata {
      margin-top: 10px;
      font-size: 12px;
      color: #666;
    }
    .content {
      line-height: 1.6;
    }
    .section {
      margin-bottom: 30px;
    }
    .section-title {
      font-size: 18px;
      font-weight: bold;
      margin-bottom: 15px;
      color: #2c3e50;
      border-bottom: 1px solid #ddd;
      padding-bottom: 5px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 15px 0;
    }
    th, td {
      border: 1px solid #ddd;
      padding: 12px;
      text-align: left;
    }
    th {
      background-color: #f2f2f2;
      font-weight: bold;
    }
    .footer {
      margin-top: 50px;
      padding-top: 20px;
      border-top: 1px solid #ddd;
      font-size: 10px;
      color: #999;
      text-align: center;
    }
    @media print {
      body {
        padding: 0;
      }
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>${title}</h1>
    ${metadata ? `
    <div class="metadata">
      ${metadata.created_at ? `<p>Generated: ${new Date(metadata.created_at).toLocaleString()}</p>` : ''}
      ${metadata.seller_id ? `<p>Seller ID: ${metadata.seller_id}</p>` : ''}
      ${metadata.anomaly_id ? `<p>Anomaly ID: ${metadata.anomaly_id}</p>` : ''}
      ${metadata.claim_id ? `<p>Claim ID: ${metadata.claim_id}</p>` : ''}
    </div>
    ` : ''}
  </div>

  <div class="content">
    ${this.formatContent(content)}
  </div>

  <div class="footer">
    <p>Generated by Opside FBA Claims System</p>
    <p>Document ID: ${document.id}</p>
  </div>
</body>
</html>
    `;
  }

  /**
   * Format content for HTML display
   */
  private formatContent(content: any): string {
    if (typeof content === 'string') {
      return `<div class="section">${content}</div>`;
    }

    if (Array.isArray(content)) {
      return content.map(item => `
        <div class="section">
          ${this.formatContent(item)}
        </div>
      `).join('');
    }

    if (typeof content === 'object') {
      let html = '';
      
      // Handle sections
      if (content.sections) {
        html = content.sections.map((section: any) => `
          <div class="section">
            <div class="section-title">${section.title || 'Section'}</div>
            ${this.formatContent(section.content || section)}
          </div>
        `).join('');
      }
      
      // Handle tables
      if (content.table) {
        html += this.formatTable(content.table);
      }
      
      // Handle claims/recoveries data
      if (content.recoveries || content.claims) {
        html += this.formatRecoveriesData(content.recoveries || content.claims);
      }
      
      // Handle other properties
      if (!content.sections && !content.table && !content.recoveries && !content.claims) {
        html = Object.entries(content).map(([key, value]) => `
          <div class="section">
            <div class="section-title">${key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}</div>
            ${this.formatContent(value)}
          </div>
        `).join('');
      }
      
      return html;
    }

    return `<div>${String(content)}</div>`;
  }

  /**
   * Format table data
   */
  private formatTable(tableData: any[]): string {
    if (!Array.isArray(tableData) || tableData.length === 0) {
      return '';
    }

    const headers = Object.keys(tableData[0]);
    
    return `
      <table>
        <thead>
          <tr>
            ${headers.map(h => `<th>${h.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}</th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${tableData.map(row => `
            <tr>
              ${headers.map(h => `<td>${row[h] || ''}</td>`).join('')}
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }

  /**
   * Format recoveries/claims data
   */
  private formatRecoveriesData(recoveries: any[]): string {
    if (!Array.isArray(recoveries) || recoveries.length === 0) {
      return '<p>No recoveries found.</p>';
    }

    return `
      <div class="section">
        <div class="section-title">Recoveries Summary</div>
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Status</th>
              <th>Amount</th>
              <th>Type</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            ${recoveries.map((r: any) => `
              <tr>
                <td>${r.id || r.recovery_id || '-'}</td>
                <td>${r.status || '-'}</td>
                <td>$${r.amount || r.recovered_amount || '0.00'}</td>
                <td>${r.type || r.claim_type || '-'}</td>
                <td>${r.created_at ? new Date(r.created_at).toLocaleDateString() : '-'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  /**
   * Close browser instance
   */
  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.initialized = false;
      logger.info('PDF Generation Service closed');
    }
  }

  /**
   * Cleanup on service shutdown
   */
  async shutdown(): Promise<void> {
    await this.close();
  }
}

// Export singleton instance
export const pdfGenerationService = new PDFGenerationService();

