/**
 * PDF Text Extractor Utility
 * Extracts text content from PDF buffers using pdf-parse v1.1.1
 * Used by Agent 5 (Document Parsing) to get raw text before Python API processing
 */

// pdf-parse v1.1.1 exports a simple function
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pdfParse = require('pdf-parse');
import logger from './logger';

export interface PdfExtractionResult {
    text: string;
    pageCount: number;
    info?: {
        title?: string;
        author?: string;
        subject?: string;
        keywords?: string;
        creator?: string;
        producer?: string;
        creationDate?: Date;
        modificationDate?: Date;
    };
    metadata?: any;
    extractionMethod: 'pdf-parse';
    success: boolean;
    error?: string;
}

/**
 * Extract text content from a PDF buffer
 * @param buffer - The PDF file as a Buffer
 * @returns PdfExtractionResult with extracted text and metadata
 */
export async function extractTextFromPdf(buffer: Buffer): Promise<PdfExtractionResult> {
    try {
        logger.info('📄 [PDF EXTRACTOR] Starting PDF text extraction', {
            bufferSize: buffer.length
        });

        // pdf-parse v1.1.1: simple function call
        const data = await pdfParse(buffer);

        const result: PdfExtractionResult = {
            text: data.text || '',
            pageCount: data.numpages || 0,
            info: data.info ? {
                title: data.info.Title,
                author: data.info.Author,
                subject: data.info.Subject,
                keywords: data.info.Keywords,
                creator: data.info.Creator,
                producer: data.info.Producer,
                creationDate: data.info.CreationDate ? new Date(data.info.CreationDate) : undefined,
                modificationDate: data.info.ModDate ? new Date(data.info.ModDate) : undefined
            } : undefined,
            metadata: data.metadata,
            extractionMethod: 'pdf-parse',
            success: true
        };

        logger.info('✅ [PDF EXTRACTOR] Text extraction successful', {
            textLength: result.text.length,
            pageCount: result.pageCount,
            hasTitle: !!result.info?.title
        });

        return result;

    } catch (error: any) {
        logger.error('❌ [PDF EXTRACTOR] Failed to extract text from PDF', {
            error: error.message,
            stack: error.stack
        });

        return {
            text: '',
            pageCount: 0,
            extractionMethod: 'pdf-parse',
            success: false,
            error: error.message
        };
    }
}

/**
 * Extract key data fields from PDF text using regex patterns
 * Useful for Amazon invoices, BOLs, PODs
 */
export function extractKeyFieldsFromText(text: string): {
    orderIds: string[];
    asins: string[];
    skus: string[];
    fnskus: string[];
    trackingNumbers: string[];
    amounts: string[];
    invoiceNumbers: string[];
    dates: string[];
} {
    const patterns = {
        // Amazon order ID: 113-1234567-1234567
        orderIds: /\b(1\d{2}-\d{7}-\d{7})\b/g,
        // ASIN: B0XXXXXXXXX
        asins: /\b(B0[A-Z0-9]{8})\b/g,
        // SKU patterns (various formats)
        skus: /(?:SKU|sku|Sku)[:\s]*([A-Z0-9\-_]+)/gi,
        // FNSKU: X000XXXXXXX
        fnskus: /\b(X[A-Z0-9]{10,})\b/g,
        // UPS tracking: 1Z999AA10123456784
        // Amazon TBA tracking: TBA123456789012
        trackingNumbers: /\b(1Z[A-Z0-9]{16}|TBA\d{12,})\b/gi,
        // Dollar amounts: $123.45 or $1,234.56
        amounts: /\$([0-9,]+\.\d{2})/g,
        // Invoice numbers
        invoiceNumbers: /(?:Invoice|INV|Inv)[:\s#]*([A-Z0-9\-]+)/gi,
        // Dates in various formats
        dates: /\b(\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{2}-\d{2}|\d{1,2}-\w{3}-\d{4})\b/g
    };

    const extractMatches = (regex: RegExp): string[] => {
        const matches: string[] = [];
        let match;
        // Reset regex lastIndex
        regex.lastIndex = 0;
        while ((match = regex.exec(text)) !== null) {
            // Use capture group if exists, otherwise full match
            matches.push(match[1] || match[0]);
        }
        // Return unique values
        return [...new Set(matches)];
    };

    return {
        orderIds: extractMatches(patterns.orderIds),
        asins: extractMatches(patterns.asins),
        skus: extractMatches(patterns.skus),
        fnskus: extractMatches(patterns.fnskus),
        trackingNumbers: extractMatches(patterns.trackingNumbers),
        amounts: extractMatches(patterns.amounts),
        invoiceNumbers: extractMatches(patterns.invoiceNumbers),
        dates: extractMatches(patterns.dates)
    };
}

/**
 * Check if a buffer is likely a PDF
 */
export function isPdfBuffer(buffer: Buffer): boolean {
    // PDF files start with %PDF-
    return buffer.length > 4 && buffer.slice(0, 5).toString() === '%PDF-';
}

export default {
    extractTextFromPdf,
    extractKeyFieldsFromText,
    isPdfBuffer
};
