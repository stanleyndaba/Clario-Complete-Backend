import { getLogger } from '@/shared/utils/logger';
import { ReportType, ParsedReportData } from '@/types';
import * as fs from 'fs';
import * as path from 'path';
import * as csv from 'csv-parser';
import { createReadStream } from 'fs';
import { Transform } from 'stream';
import { z } from 'zod';

const logger = getLogger('ReportParserService');

export interface ParserOptions {
  skipHeader?: boolean;
  delimiter?: string;
  encoding?: string;
  maxRows?: number;
  validateData?: boolean;
}

export interface ParsedRecord {
  [key: string]: any;
}

export class ReportParserService {
  private parsers: Map<ReportType, (filePath: string, options?: ParserOptions) => Promise<ParsedReportData>>;

  constructor() {
    this.parsers = new Map();
    this.initializeParsers();
  }

  /**
   * Initialize parsers for different report types
   */
  private initializeParsers(): void {
    // Inventory Ledger Report
    this.parsers.set(ReportType.INVENTORY_LEDGER, this.parseInventoryLedger.bind(this));
    
    // FBA Reimbursements Report
    this.parsers.set(ReportType.FBA_REIMBURSEMENTS, this.parseFBAReimbursements.bind(this));
    
    // FBA Returns Report
    this.parsers.set(ReportType.FBA_RETURNS, this.parseFBAReturns.bind(this));
    
    // Fee Preview Report
    this.parsers.set(ReportType.FEE_PREVIEW, this.parseFeePreview.bind(this));
    
    // Inventory Adjustments Report
    this.parsers.set(ReportType.INVENTORY_ADJUSTMENTS, this.parseInventoryAdjustments.bind(this));
    
    // Default parser for unknown report types
    this.parsers.set(ReportType.REMOVAL_ORDERS, this.parseGenericReport.bind(this));
    this.parsers.set(ReportType.STRANDED_INVENTORY, this.parseGenericReport.bind(this));
    this.parsers.set(ReportType.SETTLEMENTS, this.parseGenericReport.bind(this));
    this.parsers.set(ReportType.FBA_SHIPMENTS, this.parseGenericReport.bind(this));
    this.parsers.set(ReportType.FBA_INVENTORY_HEALTH, this.parseGenericReport.bind(this));
  }

  /**
   * Parse a report file based on its type
   */
  async parseReport(
    filePath: string, 
    reportType: ReportType, 
    options: ParserOptions = {}
  ): Promise<ParsedReportData> {
    try {
      logger.info('Starting report parsing', { filePath, reportType });

      if (!fs.existsSync(filePath)) {
        throw new Error(`Report file not found: ${filePath}`);
      }

      const parser = this.parsers.get(reportType);
      if (!parser) {
        throw new Error(`No parser available for report type: ${reportType}`);
      }

      const startTime = Date.now();
      const result = await parser(filePath, options);
      const processingTime = Date.now() - startTime;

      logger.info('Report parsing completed', {
        reportType,
        recordCount: result.records.length,
        processingTime,
        errors: result.metadata.errors.length
      });

      return {
        ...result,
        metadata: {
          ...result.metadata,
          processingTime
        }
      };
    } catch (error) {
      logger.error('Failed to parse report:', error);
      throw error;
    }
  }

  /**
   * Parse Inventory Ledger Report
   */
  private async parseInventoryLedger(filePath: string, options: ParserOptions = {}): Promise<ParsedReportData> {
    const records: ParsedRecord[] = [];
    const errors: string[] = [];

    return new Promise((resolve, reject) => {
      const stream = createReadStream(filePath, { encoding: options.encoding || 'utf8' })
        .pipe(csv({
          separator: options.delimiter || ',',
          headers: true,
          skipEmptyLines: true
        }))
        .on('data', (row) => {
          try {
            // Validate and transform inventory ledger data
            const parsedRow = this.parseInventoryLedgerRow(row);
            if (parsedRow) {
              records.push(parsedRow);
            }
          } catch (error) {
            errors.push(`Row parsing error: ${error instanceof Error ? error.message : 'Unknown error'}`);
          }
        })
        .on('end', () => {
          resolve({
            records,
            metadata: {
              totalRecords: records.length,
              processingTime: 0,
              errors
            }
          });
        })
        .on('error', (error) => {
          reject(error);
        });
    });
  }

  /**
   * Parse a single inventory ledger row
   */
  private parseInventoryLedgerRow(row: any): ParsedRecord | null {
    try {
      // Map Amazon inventory ledger columns to our schema
      return {
        sku: row['seller-sku'] || row['sku'] || '',
        fnsku: row['fnsku'] || '',
        asin: row['asin'] || '',
        productName: row['product-name'] || row['product_name'] || '',
        condition: row['condition'] || '',
        quantityAvailable: parseInt(row['quantity-available'] || row['quantity_available'] || '0'),
        quantityInbound: parseInt(row['quantity-inbound'] || row['quantity_inbound'] || '0'),
        quantityUnfulfillable: parseInt(row['quantity-unfulfillable'] || row['quantity_unfulfillable'] || '0'),
        quantityReserved: parseInt(row['quantity-reserved'] || row['quantity_reserved'] || '0'),
        quantityTotal: parseInt(row['quantity-total'] || row['quantity_total'] || '0'),
        warehouseId: row['warehouse-id'] || row['warehouse_id'] || '',
        countryCode: row['country-code'] || row['country_code'] || '',
        lastUpdated: new Date(row['last-updated'] || row['last_updated'] || Date.now()),
        reportDate: new Date()
      };
    } catch (error) {
      logger.error('Failed to parse inventory ledger row:', error);
      return null;
    }
  }

  /**
   * Parse FBA Reimbursements Report
   */
  private async parseFBAReimbursements(filePath: string, options: ParserOptions = {}): Promise<ParsedReportData> {
    const records: ParsedRecord[] = [];
    const errors: string[] = [];

    return new Promise((resolve, reject) => {
      const stream = createReadStream(filePath, { encoding: options.encoding || 'utf8' })
        .pipe(csv({
          separator: options.delimiter || ',',
          headers: true,
          skipEmptyLines: true
        }))
        .on('data', (row) => {
          try {
            const parsedRow = this.parseFBAReimbursementsRow(row);
            if (parsedRow) {
              records.push(parsedRow);
            }
          } catch (error) {
            errors.push(`Row parsing error: ${error instanceof Error ? error.message : 'Unknown error'}`);
          }
        })
        .on('end', () => {
          resolve({
            records,
            metadata: {
              totalRecords: records.length,
              processingTime: 0,
              errors
            }
          });
        })
        .on('error', (error) => {
          reject(error);
        });
    });
  }

  /**
   * Parse a single FBA reimbursements row
   */
  private parseFBAReimbursementsRow(row: any): ParsedRecord | null {
    try {
      return {
        caseId: row['case-id'] || row['case_id'] || '',
        caseType: row['case-type'] || row['case_type'] || '',
        caseReason: row['case-reason'] || row['case_reason'] || '',
        asin: row['asin'] || '',
        fnsku: row['fnsku'] || '',
        productName: row['product-name'] || row['product_name'] || '',
        quantity: parseInt(row['quantity'] || '0'),
        currency: row['currency'] || 'USD',
        amountPerUnit: parseFloat(row['amount-per-unit'] || row['amount_per_unit'] || '0'),
        totalAmount: parseFloat(row['total-amount'] || row['total_amount'] || '0'),
        reimbursementDate: new Date(row['reimbursement-date'] || row['reimbursement_date'] || Date.now()),
        caseStatus: row['case-status'] || row['case_status'] || '',
        caseCreationDate: new Date(row['case-creation-date'] || row['case_creation_date'] || Date.now()),
        caseClosedDate: row['case-closed-date'] || row['case_closed_date'] ? new Date(row['case-closed-date'] || row['case_closed_date']) : undefined,
        reportDate: new Date()
      };
    } catch (error) {
      logger.error('Failed to parse FBA reimbursements row:', error);
      return null;
    }
  }

  /**
   * Parse FBA Returns Report
   */
  private async parseFBAReturns(filePath: string, options: ParserOptions = {}): Promise<ParsedReportData> {
    const records: ParsedRecord[] = [];
    const errors: string[] = [];

    return new Promise((resolve, reject) => {
      const stream = createReadStream(filePath, { encoding: options.encoding || 'utf8' })
        .pipe(csv({
          separator: options.delimiter || ',',
          headers: true,
          skipEmptyLines: true
        }))
        .on('data', (row) => {
          try {
            const parsedRow = this.parseFBAReturnsRow(row);
            if (parsedRow) {
              records.push(parsedRow);
            }
          } catch (error) {
            errors.push(`Row parsing error: ${error instanceof Error ? error.message : 'Unknown error'}`);
          }
        })
        .on('end', () => {
          resolve({
            records,
            metadata: {
              totalRecords: records.length,
              processingTime: 0,
              errors
            }
          });
        })
        .on('error', (error) => {
          reject(error);
        });
    });
  }

  /**
   * Parse a single FBA returns row
   */
  private parseFBAReturnsRow(row: any): ParsedRecord | null {
    try {
      return {
        orderId: row['order-id'] || row['order_id'] || '',
        asin: row['asin'] || '',
        fnsku: row['fnsku'] || '',
        productName: row['product-name'] || row['product_name'] || '',
        returnReason: row['return-reason'] || row['return_reason'] || '',
        returnQuantity: parseInt(row['return-quantity'] || row['return_quantity'] || '0'),
        currency: row['currency'] || 'USD',
        returnAmount: parseFloat(row['return-amount'] || row['return_amount'] || '0'),
        returnDate: new Date(row['return-date'] || row['return_date'] || Date.now()),
        returnStatus: row['return-status'] || row['return_status'] || '',
        reportDate: new Date()
      };
    } catch (error) {
      logger.error('Failed to parse FBA returns row:', error);
      return null;
    }
  }

  /**
   * Parse Fee Preview Report
   */
  private async parseFeePreview(filePath: string, options: ParserOptions = {}): Promise<ParsedReportData> {
    const records: ParsedRecord[] = [];
    const errors: string[] = [];

    return new Promise((resolve, reject) => {
      const stream = createReadStream(filePath, { encoding: options.encoding || 'utf8' })
        .pipe(csv({
          separator: options.delimiter || ',',
          headers: true,
          skipEmptyLines: true
        }))
        .on('data', (row) => {
          try {
            const parsedRow = this.parseFeePreviewRow(row);
            if (parsedRow) {
              records.push(parsedRow);
            }
          } catch (error) {
            errors.push(`Row parsing error: ${error instanceof Error ? error.message : 'Unknown error'}`);
          }
        })
        .on('end', () => {
          resolve({
            records,
            metadata: {
              totalRecords: records.length,
              processingTime: 0,
              errors
            }
          });
        })
        .on('error', (error) => {
          reject(error);
        });
    });
  }

  /**
   * Parse a single fee preview row
   */
  private parseFeePreviewRow(row: any): ParsedRecord | null {
    try {
      return {
        sku: row['seller-sku'] || row['sku'] || '',
        asin: row['asin'] || '',
        productName: row['product-name'] || row['product_name'] || '',
        feeType: row['fee-type'] || row['fee_type'] || '',
        feeAmount: parseFloat(row['fee-amount'] || row['fee_amount'] || '0'),
        currency: row['currency'] || 'USD',
        marketplace: row['marketplace'] || '',
        reportDate: new Date()
      };
    } catch (error) {
      logger.error('Failed to parse fee preview row:', error);
      return null;
    }
  }

  /**
   * Parse Inventory Adjustments Report
   */
  private async parseInventoryAdjustments(filePath: string, options: ParserOptions = {}): Promise<ParsedReportData> {
    const records: ParsedRecord[] = [];
    const errors: string[] = [];

    return new Promise((resolve, reject) => {
      const stream = createReadStream(filePath, { encoding: options.encoding || 'utf8' })
        .pipe(csv({
          separator: options.delimiter || ',',
          headers: true,
          skipEmptyLines: true
        }))
        .on('data', (row) => {
          try {
            const parsedRow = this.parseInventoryAdjustmentsRow(row);
            if (parsedRow) {
              records.push(parsedRow);
            }
          } catch (error) {
            errors.push(`Row parsing error: ${error instanceof Error ? error.message : 'Unknown error'}`);
          }
        })
        .on('end', () => {
          resolve({
            records,
            metadata: {
              totalRecords: records.length,
              processingTime: 0,
              errors
            }
          });
        })
        .on('error', (error) => {
          reject(error);
        });
    });
  }

  /**
   * Parse a single inventory adjustments row
   */
  private parseInventoryAdjustmentsRow(row: any): ParsedRecord | null {
    try {
      return {
        sku: row['seller-sku'] || row['sku'] || '',
        asin: row['asin'] || '',
        productName: row['product-name'] || row['product_name'] || '',
        adjustmentType: row['adjustment-type'] || row['adjustment_type'] || '',
        quantity: parseInt(row['quantity'] || '0'),
        reason: row['reason'] || '',
        adjustmentDate: new Date(row['adjustment-date'] || row['adjustment_date'] || Date.now()),
        warehouseId: row['warehouse-id'] || row['warehouse_id'] || '',
        reportDate: new Date()
      };
    } catch (error) {
      logger.error('Failed to parse inventory adjustments row:', error);
      return null;
    }
  }

  /**
   * Generic parser for unknown report types
   */
  private async parseGenericReport(filePath: string, options: ParserOptions = {}): Promise<ParsedReportData> {
    const records: ParsedRecord[] = [];
    const errors: string[] = [];

    return new Promise((resolve, reject) => {
      const stream = createReadStream(filePath, { encoding: options.encoding || 'utf8' })
        .pipe(csv({
          separator: options.delimiter || ',',
          headers: true,
          skipEmptyLines: true
        }))
        .on('data', (row) => {
          try {
            // For generic reports, just store the raw data
            records.push(row);
          } catch (error) {
            errors.push(`Row parsing error: ${error instanceof Error ? error.message : 'Unknown error'}`);
          }
        })
        .on('end', () => {
          resolve({
            records,
            metadata: {
              totalRecords: records.length,
              processingTime: 0,
              errors
            }
          });
        })
        .on('error', (error) => {
          reject(error);
        });
    });
  }

  /**
   * Validate parsed data against schema
   */
  validateData(records: ParsedRecord[], schema: z.ZodSchema): {
    valid: ParsedRecord[];
    invalid: { record: ParsedRecord; error: string }[];
  } {
    const valid: ParsedRecord[] = [];
    const invalid: { record: ParsedRecord; error: string }[] = [];

    records.forEach((record, index) => {
      try {
        schema.parse(record);
        valid.push(record);
      } catch (error) {
        invalid.push({
          record,
          error: error instanceof Error ? error.message : 'Validation failed'
        });
      }
    });

    return { valid, invalid };
  }

  /**
   * Get supported report types
   */
  getSupportedReportTypes(): ReportType[] {
    return Array.from(this.parsers.keys());
  }

  /**
   * Check if a report type is supported
   */
  isReportTypeSupported(reportType: ReportType): boolean {
    return this.parsers.has(reportType);
  }
}

export const reportParserService = new ReportParserService(); 