export interface AnomalyEvidence {
  anomaly_id: string;
  type: 'lost_units' | 'overcharges' | 'damaged_stock' | 'incorrect_fee' | 'duplicate_charge' | 'pricing_discrepancy';
  sku: string;
  expected_units?: number;
  received_units?: number;
  loss?: number;
  cost_per_unit: number;
  total_loss: number;
  detected_at: string;
  evidence_links: string[];
  seller_info?: SellerInfo;
  metadata?: Record<string, any>;
}

export interface SellerInfo {
  seller_id: string;
  business_name?: string;
  email?: string;
  phone?: string;
  address?: string;
}

export interface CostDocumentationJob {
  id: string;
  evidence: AnomalyEvidence;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  priority: 'low' | 'normal' | 'high' | 'critical';
  attempts: number;
  max_attempts: number;
  error_message?: string;
  created_at: string;
  updated_at: string;
  completed_at?: string;
  pdf_url?: string;
  pdf_s3_key?: string;
}

export interface PDFTemplate {
  id: string;
  name: string;
  anomaly_type: string;
  template_html: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface GeneratedPDF {
  id: string;
  anomaly_id: string;
  seller_id: string;
  pdf_s3_key: string;
  pdf_url: string;
  template_used: string;
  template_version: string;
  generated_at: string;
  file_size: number;
  content_hash: string; // SHA256 hash of final PDF content
  linked_tx_ids: string[]; // Related transaction IDs from detection pipeline
  status: DocumentStatus;
  locked_at?: string;
  locked_by?: string;
  exported_at?: string;
  exported_by?: string;
  export_bundle_id?: string;
  metadata: Record<string, any>;
}

export interface CostBreakdown {
  item_description: string;
  quantity: number;
  unit_cost: number;
  total_cost: number;
  currency: string;
}

export interface EvidenceSection {
  title: string;
  description: string;
  links: string[];
  embedded_content?: string;
}

export interface PDFGenerationOptions {
  template_id?: string;
  include_watermark?: boolean;
  include_timestamp?: boolean;
  custom_styling?: Record<string, any>;
}

// Enums for document lifecycle
export enum DocumentStatus {
  DRAFT = 'DRAFT',
  LOCKED = 'LOCKED',
  EXPORTED = 'EXPORTED',
  ARCHIVED = 'ARCHIVED'
}

export enum AuditEvent {
  CREATED = 'CREATED',
  UPDATED = 'UPDATED',
  LOCKED = 'LOCKED',
  EXPORTED = 'EXPORTED',
  REFRESHED = 'REFRESHED',
  SYNC_WARNING = 'SYNC_WARNING'
}

export enum ExportStatus {
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED'
}

// Audit trail interface
export interface CostDocAuditLog {
  id: string;
  doc_id: string;
  timestamp: string;
  actor: string;
  event: AuditEvent;
  prev_hash?: string;
  new_hash?: string;
  details?: Record<string, any>;
}

// Export bundle interfaces
export interface ExportBundle {
  id: string;
  name: string;
  description?: string;
  created_by: string;
  created_at: string;
  s3_key: string;
  s3_url: string;
  file_size: number;
  document_count: number;
  status: ExportStatus;
  completed_at?: string;
}

export interface ExportBundleItem {
  id: string;
  bundle_id: string;
  document_id: string;
}

// Notification interface
export interface NotificationLog {
  id: string;
  event_type: string;
  event_data: Record<string, any>;
  user_id?: string;
  created_at: string;
  read_at?: string;
  is_read: boolean;
}

// Sync cross-check interface
export interface SyncCrossCheck {
  doc_id: string;
  current_hash: string;
  latest_sync_hash: string;
  is_synced: boolean;
  sync_warnings: string[];
  last_sync_check: string;
}

// Export request interface
export interface ExportRequest {
  document_ids: string[];
  bundle_name: string;
  description?: string;
  include_metadata?: boolean;
  format: 'zip' | 'combined_pdf';
}

// Transaction journaling types
export interface TransactionJournalEntry {
  id: string;
  tx_type: string;
  entity_id: string;
  payload: Record<string, any>;
  timestamp: string;
  actor_id: string;
  hash: string;
}

export interface RecordTransactionInput {
  tx_type: string;
  entity_id: string;
  payload: Record<string, any>;
  actor_id: string;
}

export interface TransactionQuery {
  tx_type?: string;
  entity_id?: string;
  actor_id?: string;
  since?: string;
  until?: string;
  limit?: number;
  cursor?: string;
}




