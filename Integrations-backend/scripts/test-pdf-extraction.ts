/**
 * Test PDF Extractor Utility
 * Tests the pdfExtractor on existing PDF files in test-documents folder
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { extractTextFromPdf, extractKeyFieldsFromText, isPdfBuffer } from '../src/utils/pdfExtractor';
import logger from '../src/utils/logger';

async function testPdfExtraction() {
    logger.info('\n🧪 Starting PDF Extraction Test...\n');

    // test-documents is at repo root level (2 levels up from scripts/)
    const testDocsPath = path.join(__dirname, '..', '..', 'test-documents');

    // Check if test-documents folder exists
    if (!fs.existsSync(testDocsPath)) {
        logger.error('❌ test-documents folder not found at:', testDocsPath);
        return false;
    }

    // Get all PDF files
    const pdfFiles = fs.readdirSync(testDocsPath).filter(f => f.endsWith('.pdf'));
    logger.info(`📂 Found ${pdfFiles.length} PDF files in test-documents/\n`);

    let allPassed = true;

    for (const pdfFile of pdfFiles) {
        const filePath = path.join(testDocsPath, pdfFile);
        logger.info(`\n📄 Testing: ${pdfFile}`);
        logger.info('='.repeat(50));

        try {
            // Read the PDF file
            const buffer = fs.readFileSync(filePath);
            logger.info(`   File size: ${(buffer.length / 1024).toFixed(2)} KB`);

            // Check if it's a valid PDF
            if (!isPdfBuffer(buffer)) {
                logger.warn(`   ⚠️ Not a valid PDF buffer`);
                continue;
            }
            logger.info(`   ✅ Valid PDF signature detected`);

            // Extract text
            const result = await extractTextFromPdf(buffer);

            if (!result.success) {
                logger.error(`   ❌ Extraction failed: ${result.error}`);
                allPassed = false;
                continue;
            }

            logger.info(`   ✅ Text extracted successfully`);
            logger.info(`   📊 Pages: ${result.pageCount}`);
            logger.info(`   📝 Text length: ${result.text.length} characters`);

            // Show first 500 chars of text
            if (result.text.length > 0) {
                logger.info(`   📖 Preview: ${result.text.substring(0, 300).replace(/\n/g, ' ').trim()}...`);
            }

            // Extract key fields
            const fields = extractKeyFieldsFromText(result.text);
            logger.info(`\n   🔍 Extracted Fields:`);
            logger.info(`      Order IDs:     ${fields.orderIds.length} found ${fields.orderIds.length > 0 ? '→ ' + fields.orderIds.join(', ') : ''}`);
            logger.info(`      ASINs:         ${fields.asins.length} found ${fields.asins.length > 0 ? '→ ' + fields.asins.join(', ') : ''}`);
            logger.info(`      SKUs:          ${fields.skus.length} found ${fields.skus.length > 0 ? '→ ' + fields.skus.join(', ') : ''}`);
            logger.info(`      FNSKUs:        ${fields.fnskus.length} found ${fields.fnskus.length > 0 ? '→ ' + fields.fnskus.join(', ') : ''}`);
            logger.info(`      Tracking #s:   ${fields.trackingNumbers.length} found ${fields.trackingNumbers.length > 0 ? '→ ' + fields.trackingNumbers.join(', ') : ''}`);
            logger.info(`      Amounts:       ${fields.amounts.length} found ${fields.amounts.length > 0 ? '→ $' + fields.amounts.join(', $') : ''}`);
            logger.info(`      Invoice #s:    ${fields.invoiceNumbers.length} found ${fields.invoiceNumbers.length > 0 ? '→ ' + fields.invoiceNumbers.join(', ') : ''}`);
            logger.info(`      Dates:         ${fields.dates.length} found ${fields.dates.length > 0 ? '→ ' + fields.dates.join(', ') : ''}`);

        } catch (error: any) {
            logger.error(`   ❌ Error: ${error.message}`);
            allPassed = false;
        }
    }

    logger.info('\n' + '='.repeat(50));
    if (allPassed) {
        logger.info('🎉 All PDF files processed successfully!\n');
    } else {
        logger.error('⚠️ Some files had issues. Check the logs above.\n');
    }

    return allPassed;
}

// Run the test
testPdfExtraction()
    .then(success => {
        process.exit(success ? 0 : 1);
    })
    .catch(error => {
        logger.error('Fatal error:', error);
        process.exit(1);
    });
