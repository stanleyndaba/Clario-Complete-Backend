import { getLogger } from '../../../shared/utils/logger';

const logger = getLogger('ReportParser');

interface ReportData {
  [key: string]: any;
}

interface ParsedReportData {
  id: string;
  type: string;
  amount?: number;
  currency?: string;
  date: string;
  sku?: string;
  orderId?: string;
  description?: string;
  source: string;
  externalId?: string;
  metadata: { [key: string]: any };
}

interface ParseOptions {
  reportType: string;
  source: string;
  userId: string;
}

class ReportParser {
  async parseReport(reportType: string, rawData: ReportData[]): Promise<ParsedReportData[]> {
    try {
      logger.info(`Parsing ${reportType} report with ${rawData.length} records`);

      const parser = this.getParserForReportType(reportType);
      const parsedData = await parser(rawData);

      logger.info(`Successfully parsed ${parsedData.length} records from ${reportType} report`);
      return parsedData;

    } catch (error) {
      logger.error(`Error parsing ${reportType} report:`, error);
      throw error;
    }
  }

  private getParserForReportType(reportType: string): (data: ReportData[]) => Promise<ParsedReportData[]> {
    const parsers: { [key: string]: (data: ReportData[]) => Promise<ParsedReportData[]> } = {
      inventoryLedger: this.parseInventoryLedger.bind(this),
      feePreview: this.parseFeePreview.bind(this),
      fbaReimbursements: this.parseFbaReimbursements.bind(this),
      orderReturns: this.parseOrderReturns.bind(this),
      orderReports: this.parseOrderReports.bind(this),
      settlementReports: this.parseSettlementReports.bind(this),
      financialEvents: this.parseFinancialEvents.bind(this),
    };

    const parser = parsers[reportType];
    if (!parser) {
      throw new Error(`No parser found for report type: ${reportType}`);
    }

    return parser;
  }

  private async parseInventoryLedger(data: ReportData[]): Promise<ParsedReportData[]> {
    return data.map((record, index) => ({
      id: `inventory_${record.sku || index}_${Date.now()}`,
      type: 'inventory',
      amount: parseInt(record.quantity) || 0,
      currency: 'USD',
      date: record['snapshot-date'] || new Date().toISOString(),
      sku: record.sku,
      description: record['product-name'],
      source: 'amazon',
      externalId: record.asin,
      metadata: {
        fnsku: record.fnsku,
        fulfillmentCenterId: record['fulfillment-center-id'],
        productName: record['product-name'],
      },
    }));
  }

  private async parseFeePreview(data: ReportData[]): Promise<ParsedReportData[]> {
    return data.map((record, index) => ({
      id: `fee_${record['fee-type'] || index}_${Date.now()}`,
      type: 'fee',
      amount: parseFloat(record['fee-amount']) || 0,
      currency: record.currency || 'USD',
      date: new Date().toISOString(),
      description: `${record['fee-type']} fee`,
      source: 'amazon',
      externalId: record['marketplace-name'],
      metadata: {
        feeType: record['fee-type'],
        marketplaceName: record['marketplace-name'],
      },
    }));
  }

  private async parseFbaReimbursements(data: ReportData[]): Promise<ParsedReportData[]> {
    return data.map((record, index) => ({
      id: `reimbursement_${record['reimbursement-id'] || index}_${Date.now()}`,
      type: 'reimbursement',
      amount: parseFloat(record.amount) || 0,
      currency: record.currency || 'USD',
      date: record.date || new Date().toISOString(),
      description: record.reason,
      source: 'amazon',
      externalId: record['reimbursement-id'],
      metadata: {
        reimbursementType: record['reimbursement-type'],
        reason: record.reason,
      },
    }));
  }

  private async parseOrderReturns(data: ReportData[]): Promise<ParsedReportData[]> {
    return data.map((record, index) => ({
      id: `return_${record['order-id'] || index}_${Date.now()}`,
      type: 'return',
      amount: parseInt(record.quantity) || 0,
      currency: 'USD',
      date: record['return-date'] || new Date().toISOString(),
      sku: record.sku,
      orderId: record['order-id'],
      description: record['return-reason'],
      source: 'amazon',
      externalId: record['order-id'],
      metadata: {
        returnReason: record['return-reason'],
        quantity: record.quantity,
      },
    }));
  }

  private async parseOrderReports(data: ReportData[]): Promise<ParsedReportData[]> {
    return data.map((record, index) => ({
      id: `order_${record['order-id'] || index}_${Date.now()}`,
      type: 'order',
      amount: parseFloat(record['item-price']) || 0,
      currency: record.currency || 'USD',
      date: record['order-date'] || new Date().toISOString(),
      sku: record.sku,
      orderId: record['order-id'],
      description: `Order for SKU ${record.sku}`,
      source: 'amazon',
      externalId: record['order-id'],
      metadata: {
        quantity: record.quantity,
        itemPrice: record['item-price'],
      },
    }));
  }

  private async parseSettlementReports(data: ReportData[]): Promise<ParsedReportData[]> {
    return data.map((record, index) => ({
      id: `settlement_${record['settlement-id'] || index}_${Date.now()}`,
      type: 'settlement',
      amount: parseFloat(record['total-amount']) || 0,
      currency: record.currency || 'USD',
      date: record['settlement-end-date'] || new Date().toISOString(),
      description: `Settlement for period ${record['settlement-start-date']} to ${record['settlement-end-date']}`,
      source: 'amazon',
      externalId: record['settlement-id'],
      metadata: {
        settlementStartDate: record['settlement-start-date'],
        settlementEndDate: record['settlement-end-date'],
        settlementId: record['settlement-id'],
      },
    }));
  }

  private async parseFinancialEvents(data: ReportData[]): Promise<ParsedReportData[]> {
    return data.map((record, index) => ({
      id: `financial_${record['event-type'] || index}_${Date.now()}`,
      type: 'financial_event',
      amount: parseFloat(record.amount) || 0,
      currency: record.currency || 'USD',
      date: record['event-date'] || new Date().toISOString(),
      description: `${record['event-type']} event`,
      source: 'amazon',
      externalId: record['marketplace-name'],
      metadata: {
        eventType: record['event-type'],
        marketplaceName: record['marketplace-name'],
      },
    }));
  }

  // Method to clean and validate data
  private cleanData(data: any): any {
    if (typeof data === 'string') {
      return data.trim();
    }
    if (typeof data === 'number') {
      return isNaN(data) ? 0 : data;
    }
    if (Array.isArray(data)) {
      return data.map(item => this.cleanData(item));
    }
    if (typeof data === 'object' && data !== null) {
      const cleaned: any = {};
      for (const [key, value] of Object.entries(data)) {
        cleaned[key] = this.cleanData(value);
      }
      return cleaned;
    }
    return data;
  }

  // Method to generate unique IDs
  private generateId(prefix: string, record: ReportData, index: number): string {
    const timestamp = Date.now();
    const uniqueKey = record.id || record.sku || record['order-id'] || index;
    return `${prefix}_${uniqueKey}_${timestamp}`;
  }

  // Method to normalize dates
  private normalizeDate(dateString: string): string {
    try {
      const date = new Date(dateString);
      if (isNaN(date.getTime())) {
        return new Date().toISOString();
      }
      return date.toISOString();
    } catch (error) {
      logger.warn(`Invalid date format: ${dateString}, using current date`);
      return new Date().toISOString();
    }
  }

  // Method to normalize amounts
  private normalizeAmount(amount: any): number {
    if (typeof amount === 'number') {
      return isNaN(amount) ? 0 : amount;
    }
    if (typeof amount === 'string') {
      const parsed = parseFloat(amount.replace(/[^0-9.-]/g, ''));
      return isNaN(parsed) ? 0 : parsed;
    }
    return 0;
  }

  // Method to validate parsed data
  private validateParsedData(data: ParsedReportData[]): ParsedReportData[] {
    return data.filter(record => {
      // Ensure required fields are present
      if (!record.id || !record.type || !record.date) {
        logger.warn(`Skipping invalid record: missing required fields`, record);
        return false;
      }

      // Ensure amount is a valid number
      if (record.amount !== undefined && (isNaN(record.amount) || record.amount < 0)) {
        logger.warn(`Skipping invalid record: invalid amount`, record);
        return false;
      }

      return true;
    });
  }

  // Method to deduplicate data based on external ID
  private deduplicateData(data: ParsedReportData[]): ParsedReportData[] {
    const seen = new Set<string>();
    return data.filter(record => {
      if (record.externalId && seen.has(record.externalId)) {
        logger.info(`Removing duplicate record with external ID: ${record.externalId}`);
        return false;
      }
      if (record.externalId) {
        seen.add(record.externalId);
      }
      return true;
    });
  }

  // Enhanced parse method with data cleaning and validation
  async parseReportWithValidation(
    reportType: string,
    rawData: ReportData[],
    options: ParseOptions
  ): Promise<ParsedReportData[]> {
    try {
      logger.info(`Parsing ${reportType} report with validation for user ${options.userId}`);

      // Clean the raw data
      const cleanedData = rawData.map(record => this.cleanData(record));

      // Parse the report
      const parsedData = await this.parseReport(reportType, cleanedData);

      // Validate the parsed data
      const validatedData = this.validateParsedData(parsedData);

      // Deduplicate the data
      const deduplicatedData = this.deduplicateData(validatedData);

      logger.info(`Parsing completed: ${rawData.length} raw records -> ${deduplicatedData.length} valid records`);
      return deduplicatedData;

    } catch (error) {
      logger.error(`Error parsing ${reportType} report with validation:`, error);
      throw error;
    }
  }
}

export const reportParser = new ReportParser();
export default reportParser; 