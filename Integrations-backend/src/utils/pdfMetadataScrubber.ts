/**
 * PDF Metadata Scrubber
 * 
 * ANTI-DETECTION: Ensures PDFs sent to Amazon have clean, professional metadata
 * that looks like they came from a scanner or business system, not a script.
 * 
 * The Risk: If metadata says "Creator: Puppeteer" or "Producer: Chrome",
 * Amazon's fraud detection might flag it as automated.
 * 
 * The Fix: Set metadata to look like legitimate business documents.
 */

import logger from './logger';

/**
 * Realistic metadata profiles that look like legitimate business documents
 * These simulate common scanner/business software outputs
 */
const METADATA_PROFILES = {
    scanner: {
        creators: [
            'Canon MG3600 series',
            'HP OfficeJet Pro 8035',
            'Epson WorkForce ES-400',
            'Brother ADS-2700W',
            'Fujitsu ScanSnap iX1500',
        ],
        producers: [
            'Canon IJ Scan Utility',
            'HP Scan',
            'Epson Scan 2',
            'Brother iPrint&Scan',
            'ScanSnap Manager',
        ],
    },
    office: {
        creators: [
            'Microsoft Excel',
            'Microsoft Word',
            'Adobe Acrobat',
            'QuickBooks',
            'FreshBooks',
        ],
        producers: [
            'Microsoft: Print To PDF',
            'Adobe PDF Library',
            'Windows Photo Viewer',
            'macOS Quartz PDFContext',
            'LibreOffice Impress',
        ],
    },
    accounting: {
        creators: [
            'QuickBooks Online',
            'Xero',
            'FreshBooks',
            'Wave Accounting',
            'Zoho Books',
        ],
        producers: [
            'QuickBooks PDF Printer',
            'Xero PDF Export',
            'Adobe PDF Library 15.0',
            'PDFSharp 1.50.5147',
            'iText Core 7.1.9',
        ],
    },
};

export interface PDFMetadataOptions {
    profile?: 'scanner' | 'office' | 'accounting';
    title?: string;
    author?: string;
    subject?: string;
    keywords?: string[];
    creationDate?: Date;
    modificationDate?: Date;
}

/**
 * Get randomized clean metadata based on profile
 */
export function getCleanMetadata(options: PDFMetadataOptions = {}): {
    creator: string;
    producer: string;
    title: string;
    author: string;
    subject: string;
    keywords: string;
    creationDate: Date;
    modificationDate: Date;
} {
    const profile = options.profile || 'scanner';
    const profileData = METADATA_PROFILES[profile] || METADATA_PROFILES.scanner;

    // Random selection from profile
    const creator = profileData.creators[Math.floor(Math.random() * profileData.creators.length)];
    const producer = profileData.producers[Math.floor(Math.random() * profileData.producers.length)];

    // Add slight time jitter (±0-48 hours) to make creation time look natural
    const baseDate = options.creationDate || new Date();
    const jitterHours = Math.floor(Math.random() * 48);
    const jitterMinutes = Math.floor(Math.random() * 60);
    const creationDate = new Date(baseDate.getTime() - (jitterHours * 60 + jitterMinutes) * 60 * 1000);

    // Modification date is slightly after creation
    const modificationDate = options.modificationDate || new Date(creationDate.getTime() + Math.floor(Math.random() * 3600000));

    return {
        creator,
        producer,
        title: options.title || 'Scanned Document',
        author: options.author || '',
        subject: options.subject || '',
        keywords: options.keywords?.join(', ') || '',
        creationDate,
        modificationDate,
    };
}

/**
 * Log metadata scrubbing for audit purposes
 * IMPORTANT: We log this so we can demonstrate compliance if needed
 */
export function logMetadataScrub(
    documentId: string,
    originalMetadata: any,
    newMetadata: ReturnType<typeof getCleanMetadata>
): void {
    logger.debug('🧹 [METADATA SCRUB] Document metadata sanitized', {
        documentId,
        original: {
            creator: originalMetadata?.creator || 'unknown',
            producer: originalMetadata?.producer || 'unknown',
        },
        sanitized: {
            creator: newMetadata.creator,
            producer: newMetadata.producer,
            creationDate: newMetadata.creationDate.toISOString(),
        },
    });
}

/**
 * Check if metadata looks suspicious (automated/scripted)
 */
export function hasScriptMetadata(metadata: any): boolean {
    if (!metadata) return false;

    const suspiciousPatterns = [
        /puppeteer/i,
        /chrome/i,
        /headless/i,
        /pdfkit/i,
        /jspdf/i,
        /pdf-lib/i,
        /python/i,
        /reportlab/i,
        /wkhtmltopdf/i,
        /phantom/i,
        /selenium/i,
        /playwright/i,
    ];

    const creator = String(metadata.creator || '');
    const producer = String(metadata.producer || '');
    const combined = `${creator} ${producer}`;

    return suspiciousPatterns.some(pattern => pattern.test(combined));
}

/**
 * Configuration for metadata scrubbing feature
 */
export const METADATA_SCRUB_CONFIG = {
    enabled: true,
    defaultProfile: 'scanner' as const,
    logScrubbing: true,
};

export default {
    getCleanMetadata,
    logMetadataScrub,
    hasScriptMetadata,
    METADATA_PROFILES,
    METADATA_SCRUB_CONFIG,
};
