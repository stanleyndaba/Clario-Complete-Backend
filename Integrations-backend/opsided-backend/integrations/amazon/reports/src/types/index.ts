import { z } from 'zod';

// Amazon SP-API Report Types
export enum ReportType {
  INVENTORY_LEDGER = 'GET_FLAT_FILE_INVENTORY_LEDGER_REPORT_V2',
  FEE_PREVIEW = 'GET_FLAT_FILE_FEE_PREVIEW_REPORT_V2',
  FBA_REIMBURSEMENTS = 'GET_FBA_REIMBURSEMENTS_DATA',
  FBA_RETURNS = 'GET_FBA_FULFILLMENT_CUSTOMER_RETURNS_DATA',
  INVENTORY_ADJUSTMENTS = 'GET_FLAT_FILE_INVENTORY_ADJUSTMENT_DATA_V2',
  REMOVAL_ORDERS = 'GET_FLAT_FILE_FBA_INVENTORY_AGED_DATA',
  STRANDED_INVENTORY = 'GET_STRANDED_INVENTORY_UI_DATA',
  SETTLEMENTS = 'GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE_V2',
  FBA_SHIPMENTS = 'GET_FBA_FULFILLMENT_SHIPMENT_DATA',
  FBA_INVENTORY_HEALTH = 'GET_FBA_INVENTORY_HEALTH_DATA'
}

// Report Processing Status
export enum ReportStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled'
}

// Sync Status
export enum SyncStatus {
  IDLE = 'idle',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
  PAUSED = 'paused'
}

// Report Data Types
export interface ReportMetadata {
  reportId: string;
  reportType: ReportType;
  dataStartTime: Date;
  dataEndTime: Date;
  marketplaceIds: string[];
  reportDocumentId?: string;
  processingStatus: ReportStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface SyncLog {
  id: string;
  userId: string;
  syncType: 'full' | 'incremental';
  status: SyncStatus;
  startTime: Date;
  endTime?: Date;
  totalReports: number;
  processedReports: number;
  failedReports: number;
  errorMessage?: string;
  metadata: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

// FBA Inventory Record
export interface FBAInventoryRecord {
  id: string;
  userId: string;
  sku: string;
  fnsku: string;
  asin: string;
  productName: string;
  condition: string;
  quantityAvailable: number;
  quantityInbound: number;
  quantityUnfulfillable: number;
  quantityReserved: number;
  quantityTotal: number;
  warehouseId: string;
  countryCode: string;
  lastUpdated: Date;
  reportDate: Date;
  createdAt: Date;
  updatedAt: Date;
}

// FBA Reimbursement Record
export interface FBAReimbursementRecord {
  id: string;
  userId: string;
  caseId: string;
  caseType: string;
  caseReason: string;
  asin: string;
  fnsku: string;
  productName: string;
  quantity: number;
  currency: string;
  amountPerUnit: number;
  totalAmount: number;
  reimbursementDate: Date;
  caseStatus: string;
  caseCreationDate: Date;
  caseClosedDate?: Date;
  reportDate: Date;
  createdAt: Date;
  updatedAt: Date;
}

// FBA Returns Record
export interface FBAReturnsRecord {
  id: string;
  userId: string;
  orderId: string;
  asin: string;
  fnsku: string;
  productName: string;
  returnReason: string;
  returnQuantity: number;
  currency: string;
  returnAmount: number;
  returnDate: Date;
  returnStatus: string;
  reportDate: Date;
  createdAt: Date;
  updatedAt: Date;
}

// API Response Types
export interface AmazonAPIResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  pagination?: {
    nextToken?: string;
    hasMore: boolean;
  };
}

export interface ReportRequestResponse {
  reportId: string;
  reportType: ReportType;
  dataStartTime: Date;
  dataEndTime: Date;
  marketplaceIds: string[];
}

export interface ReportDocumentResponse {
  reportDocumentId: string;
  url: string;
  compressionAlgorithm?: string;
}

// Configuration Types
export interface AmazonConfig {
  refreshToken: string;
  region: string;
  marketplaceIds: string[];
  roleArn?: string;
}

export interface SyncConfig {
  schedule: string; // cron expression
  batchSize: number;
  maxRetries: number;
  retryDelay: number;
  timeout: number;
}

export interface StorageConfig {
  s3Bucket: string;
  s3Region: string;
  s3Prefix: string;
  localTempDir: string;
}

// Validation Schemas
export const ReportMetadataSchema = z.object({
  reportId: z.string(),
  reportType: z.nativeEnum(ReportType),
  dataStartTime: z.date(),
  dataEndTime: z.date(),
  marketplaceIds: z.array(z.string()),
  reportDocumentId: z.string().optional(),
  processingStatus: z.nativeEnum(ReportStatus),
  createdAt: z.date(),
  updatedAt: z.date()
});

export const SyncLogSchema = z.object({
  id: z.string(),
  userId: z.string(),
  syncType: z.enum(['full', 'incremental']),
  status: z.nativeEnum(SyncStatus),
  startTime: z.date(),
  endTime: z.date().optional(),
  totalReports: z.number(),
  processedReports: z.number(),
  failedReports: z.number(),
  errorMessage: z.string().optional(),
  metadata: z.record(z.any()),
  createdAt: z.date(),
  updatedAt: z.date()
});

export const FBAInventoryRecordSchema = z.object({
  id: z.string(),
  userId: z.string(),
  sku: z.string(),
  fnsku: z.string(),
  asin: z.string(),
  productName: z.string(),
  condition: z.string(),
  quantityAvailable: z.number(),
  quantityInbound: z.number(),
  quantityUnfulfillable: z.number(),
  quantityReserved: z.number(),
  quantityTotal: z.number(),
  warehouseId: z.string(),
  countryCode: z.string(),
  lastUpdated: z.date(),
  reportDate: z.date(),
  createdAt: z.date(),
  updatedAt: z.date()
});

// Event Types
export interface ReportProcessedEvent {
  type: 'REPORT_PROCESSED';
  userId: string;
  reportId: string;
  reportType: ReportType;
  recordCount: number;
  processingTime: number;
  timestamp: Date;
}

export interface SyncCompletedEvent {
  type: 'SYNC_COMPLETED';
  userId: string;
  syncId: string;
  totalReports: number;
  processedReports: number;
  failedReports: number;
  duration: number;
  timestamp: Date;
}

export interface SyncFailedEvent {
  type: 'SYNC_FAILED';
  userId: string;
  syncId: string;
  error: string;
  timestamp: Date;
}

export type NotificationEvent = ReportProcessedEvent | SyncCompletedEvent | SyncFailedEvent;

// Queue Job Types
export interface SyncJobData {
  userId: string;
  syncType: 'full' | 'incremental';
  reportTypes?: ReportType[];
  startDate?: Date;
  endDate?: Date;
  priority?: number;
}

export interface ReportProcessJobData {
  userId: string;
  reportId: string;
  reportType: ReportType;
  documentUrl: string;
  priority?: number;
}

// Utility Types
export type ReportTypeMap = {
  [K in ReportType]: {
    schema: z.ZodSchema<any>;
    parser: string;
    tableName: string;
  };
};

export interface ParsedReportData {
  records: any[];
  metadata: {
    totalRecords: number;
    processingTime: number;
    errors: string[];
  };
} 