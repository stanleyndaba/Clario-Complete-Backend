/**
 * MCDE Service - Manufacturing Cost Document Engine Integration
 * 
 * Provides OCR-based document parsing for:
 * - Scanned PDFs and images (JPG, PNG, TIFF)
 * - Chinese supplier invoices
 * - Unit manufacturing cost extraction
 * - Cost component breakdown (material, labor, overhead, shipping, tax)
 * 
 * Calls Python MCDE API endpoints at /api/v1/mcde/
 */

import axios, { AxiosError } from 'axios';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const FormData = require('form-data');
import logger from '../utils/logger';
import { buildPythonServiceAuthHeader } from '../utils/pythonServiceAuth';

export interface MCDEUploadResponse {
    document_id: string;
    filename: string;
    document_type: string;
    status: string;
    uploaded_at: string;
    metadata: Record<string, any>;
}

export interface MCDECostComponents {
    material_cost: number;
    labor_cost: number;
    overhead_cost: number;
    shipping_cost: number;
    tax_cost: number;
    unit_manufacturing_cost?: number;
    total_cost?: number;
}

export interface MCDECostEstimateResponse {
    claim_id: string;
    document_id: string;
    estimated_cost: number;
    confidence: number;
    cost_components: MCDECostComponents;
    validation_status: string;
    generated_at: string;
}

export interface MCDEOCRResult {
    text: string;
    confidence: number;
    language_detected?: string;
    cost_components?: MCDECostComponents;
    extraction_method: 'ocr' | 'regex' | 'ml';
    // Extracted fields
    supplier_name?: string;
    invoice_number?: string;
    invoice_date?: string;
    total_amount?: number;
    currency?: string;
    line_items?: Array<{
        sku?: string;
        description?: string;
        quantity?: number;
        unit_price?: number;
        unit_cost?: number;
        total?: number;
    }>;
}

class MCDEService {
    private pythonApiUrl: string;
    private mcdeEndpoint: string;
    private enabled: boolean;
    private ocrLanguage: string;
    private ocrTimeout: number;

    constructor() {
        this.pythonApiUrl =
            process.env.PYTHON_API_URL ||
            process.env.API_URL ||
            'https://clario-complete-backend-7tgl.onrender.com';

        this.mcdeEndpoint = `${this.pythonApiUrl}/api/v1/mcde`;
        this.enabled = process.env.ENABLE_MCDE_INTEGRATION === 'true';
        this.ocrLanguage = process.env.MCDE_OCR_LANGUAGE || 'eng+chi_sim';
        this.ocrTimeout = parseInt(process.env.MCDE_OCR_TIMEOUT || '60', 10) * 1000;

        logger.info('[MCDE] Service initialized', {
            enabled: this.enabled,
            endpoint: this.mcdeEndpoint,
            ocrLanguage: this.ocrLanguage,
            ocrTimeout: this.ocrTimeout
        });
    }

    private buildServiceHeaders(
        userId: string,
        context: string,
        extraHeaders: Record<string, string> = {}
    ): Record<string, string> {
        return {
            ...extraHeaders,
            Authorization: buildPythonServiceAuthHeader({
                userId,
                metadata: { source: `mcde:${context}` }
            })
        };
    }

    /**
     * Check if MCDE integration is enabled
     */
    isEnabled(): boolean {
        return this.enabled;
    }

    /**
     * Health check for MCDE service
     */
    async healthCheck(): Promise<{ status: string; service: string; version: string } | null> {
        try {
            const response = await axios.get(`${this.mcdeEndpoint}/health`, {
                timeout: 10000
            });
            return response.data;
        } catch (error: any) {
            logger.warn('[MCDE] Health check failed', { error: error.message });
            return null;
        }
    }

    /**
     * Upload a document to MCDE for OCR processing
     */
    async uploadDocument(
        buffer: Buffer,
        filename: string,
        userId: string,
        documentType: string = 'invoice'
    ): Promise<MCDEUploadResponse | null> {
        if (!this.enabled) {
            logger.debug('[MCDE] Service disabled, skipping upload');
            return null;
        }

        try {
            logger.info('[MCDE] Uploading document for OCR processing', {
                filename,
                userId,
                documentType,
                bufferSize: buffer.length
            });

            const formData = new FormData();
            formData.append('file', buffer, {
                filename,
                contentType: this.getContentType(filename)
            });
            formData.append('document_type', documentType);
            formData.append('user_id', userId);
            formData.append('ocr_language', this.ocrLanguage);

            const response = await axios.post<MCDEUploadResponse>(
                `${this.mcdeEndpoint}/upload-document`,
                formData,
                {
                    headers: {
                        ...this.buildServiceHeaders(userId, 'upload'),
                        ...formData.getHeaders()
                    },
                    timeout: this.ocrTimeout
                }
            );

            logger.info('[MCDE] Document uploaded successfully', {
                documentId: response.data.document_id,
                status: response.data.status
            });

            return response.data;
        } catch (error: any) {
            logger.error('[MCDE] Document upload failed', {
                filename,
                error: error.message,
                status: error.response?.status
            });
            return null;
        }
    }

    /**
     * Extract text and cost components using OCR
     */
    async extractWithOCR(
        documentId: string,
        userId: string
    ): Promise<MCDEOCRResult | null> {
        if (!this.enabled) {
            logger.debug('[MCDE] Service disabled, skipping OCR extraction');
            return null;
        }

        try {
            logger.info('[MCDE] Triggering OCR extraction', { documentId, userId });

            const response = await axios.post<{ ok: boolean; data: MCDEOCRResult }>(
                `${this.mcdeEndpoint}/extract-ocr`,
                {
                    document_id: documentId,
                    language: this.ocrLanguage,
                    extract_costs: true
                },
                {
                    headers: this.buildServiceHeaders(userId, 'ocr', {
                        'Content-Type': 'application/json'
                    }),
                    timeout: this.ocrTimeout
                }
            );

            if (response.data?.ok && response.data.data) {
                logger.info('[MCDE] OCR extraction completed', {
                    documentId,
                    confidence: response.data.data.confidence,
                    hasCostComponents: !!response.data.data.cost_components
                });
                return response.data.data;
            }

            return null;
        } catch (error: any) {
            logger.error('[MCDE] OCR extraction failed', {
                documentId,
                error: error.message,
                status: error.response?.status
            });
            return null;
        }
    }

    /**
     * Get cost estimate from document
     */
    async estimateCost(
        documentId: string,
        claimId: string,
        userId: string
    ): Promise<MCDECostEstimateResponse | null> {
        if (!this.enabled) {
            logger.debug('[MCDE] Service disabled, skipping cost estimation');
            return null;
        }

        try {
            logger.info('[MCDE] Requesting cost estimate', { documentId, claimId, userId });

            const response = await axios.post<MCDECostEstimateResponse>(
                `${this.mcdeEndpoint}/cost-estimate`,
                {
                    document_id: documentId,
                    claim_id: claimId,
                    processing_options: {
                        include_breakdown: true,
                        calculate_unit_cost: true
                    }
                },
                {
                    headers: this.buildServiceHeaders(userId, 'cost-estimate', {
                        'Content-Type': 'application/json'
                    }),
                    timeout: 30000
                }
            );

            logger.info('[MCDE] Cost estimate received', {
                documentId,
                claimId,
                estimatedCost: response.data.estimated_cost,
                confidence: response.data.confidence
            });

            return response.data;
        } catch (error: any) {
            logger.error('[MCDE] Cost estimation failed', {
                documentId,
                claimId,
                error: error.message
            });
            return null;
        }
    }

    /**
     * Check if a file needs OCR (image or scanned PDF)
     */
    needsOCR(filename: string, contentType?: string): boolean {
        const imageExtensions = ['.jpg', '.jpeg', '.png', '.tiff', '.tif', '.bmp', '.gif'];
        const lowerFilename = filename.toLowerCase();

        // Images always need OCR
        if (imageExtensions.some(ext => lowerFilename.endsWith(ext))) {
            return true;
        }

        // Check content type for images
        if (contentType) {
            if (contentType.startsWith('image/')) {
                return true;
            }
        }

        return false;
    }

    /**
     * Get content type from filename
     */
    private getContentType(filename: string): string {
        const lowerFilename = filename.toLowerCase();

        if (lowerFilename.endsWith('.pdf')) return 'application/pdf';
        if (lowerFilename.endsWith('.jpg') || lowerFilename.endsWith('.jpeg')) return 'image/jpeg';
        if (lowerFilename.endsWith('.png')) return 'image/png';
        if (lowerFilename.endsWith('.tiff') || lowerFilename.endsWith('.tif')) return 'image/tiff';
        if (lowerFilename.endsWith('.bmp')) return 'image/bmp';
        if (lowerFilename.endsWith('.gif')) return 'image/gif';

        return 'application/octet-stream';
    }

    /**
     * Parse Chinese cost patterns from text
     * Used as fallback when MCDE API is unavailable
     */
    parseChineseCostPatterns(text: string): Partial<MCDECostComponents> {
        const patterns = {
            // 单位成本 / 单价 = Unit Cost
            unit_manufacturing_cost: /(?:单位成本|单价|unit\s*cost)[:\s]*([¥￥$]?\s*[\d,]+\.?\d*)/gi,
            // 材料费 / 材料成本 = Material Cost
            material_cost: /(?:材料费|材料成本|material)[:\s]*([¥￥$]?\s*[\d,]+\.?\d*)/gi,
            // 人工费 / 人工成本 = Labor Cost
            labor_cost: /(?:人工费|人工成本|labor)[:\s]*([¥￥$]?\s*[\d,]+\.?\d*)/gi,
            // 运费 = Shipping Cost
            shipping_cost: /(?:运费|freight|shipping)[:\s]*([¥￥$]?\s*[\d,]+\.?\d*)/gi,
            // 税费 / 税金 = Tax Cost
            tax_cost: /(?:税费|税金|税|tax|vat)[:\s]*([¥￥$]?\s*[\d,]+\.?\d*)/gi,
            // 总成本 / 合计 = Total Cost
            total_cost: /(?:总成本|合计|total)[:\s]*([¥￥$]?\s*[\d,]+\.?\d*)/gi,
        };

        const result: Partial<MCDECostComponents> = {};

        for (const [key, regex] of Object.entries(patterns)) {
            const match = regex.exec(text);
            if (match && match[1]) {
                const valueStr = match[1].replace(/[¥￥$,\s]/g, '');
                const value = parseFloat(valueStr);
                if (!isNaN(value)) {
                    (result as any)[key] = value;
                }
            }
        }

        return result;
    }
}

export const mcdeService = new MCDEService();
export default mcdeService;
