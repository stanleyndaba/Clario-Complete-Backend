const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

async function convertHtmlToPdf(htmlFile, outputDir) {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  try {
    const page = await browser.newPage();
    
    // Read HTML file
    const htmlContent = fs.readFileSync(htmlFile, 'utf8');
    const filePath = path.resolve(htmlFile);
    const fileUrl = `file://${filePath}`;
    
    // Load HTML content
    await page.goto(fileUrl, { waitUntil: 'networkidle0' });
    
    // Generate PDF
    const pdfPath = path.join(outputDir, path.basename(htmlFile, '.html') + '.pdf');
    await page.pdf({
      path: pdfPath,
      format: 'A4',
      printBackground: true,
      margin: {
        top: '20px',
        right: '20px',
        bottom: '20px',
        left: '20px'
      }
    });
    
    console.log(`✅ Converted: ${path.basename(htmlFile)} → ${path.basename(pdfPath)}`);
    return pdfPath;
  } finally {
    await browser.close();
  }
}

async function main() {
  const testDocsDir = __dirname;
  const htmlFiles = [
    path.join(testDocsDir, 'invoice-001.html'),
    path.join(testDocsDir, 'invoice-002.html'),
    path.join(testDocsDir, 'pod-001.html')
  ];
  
  console.log('🔄 Converting HTML files to PDF...\n');
  
  for (const htmlFile of htmlFiles) {
    if (fs.existsSync(htmlFile)) {
      try {
        await convertHtmlToPdf(htmlFile, testDocsDir);
      } catch (error) {
        console.error(`❌ Error converting ${path.basename(htmlFile)}:`, error.message);
      }
    } else {
      console.warn(`⚠️  File not found: ${path.basename(htmlFile)}`);
    }
  }
  
  console.log('\n✨ Conversion complete!');
}

main().catch(console.error);

