"""
API Contract Schemas - Version 1.0
Defines stable JSON schemas for all API endpoints to prevent frontend/backend drift
"""

from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any, Union
from datetime import datetime
from enum import Enum

# ============================================================================
# COMMON SCHEMAS
# ============================================================================

class PaginationMeta(BaseModel):
    """Pagination metadata"""
    limit: int
    offset: int
    total: int
    has_more: bool

class TimestampMixin(BaseModel):
    """Mixin for ISO 8601 timestamps"""
    created_at: str = Field(..., description="ISO 8601 timestamp")
    updated_at: str = Field(..., description="ISO 8601 timestamp")

class StatusEnum(str, Enum):
    """Common status values"""
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"
    SUBMITTED = "submitted"
    APPROVED = "approved"
    REJECTED = "rejected"

# ============================================================================
# AUTH SCHEMAS
# ============================================================================

class UserProfile(BaseModel):
    """User profile response"""
    id: str
    email: str
    name: str
    amazon_connected: bool
    stripe_connected: bool
    created_at: str
    last_login: str

class AmazonLoginResponse(BaseModel):
    """Amazon OAuth login response"""
    auth_url: str
    state: str

class LogoutResponse(BaseModel):
    """Logout response"""
    message: str

# ============================================================================
# INTEGRATIONS SCHEMAS
# ============================================================================

class IntegrationInfo(BaseModel):
    """Integration connection info"""
    id: str
    type: str
    status: str
    connected_at: str
    seller_id: Optional[str] = None
    marketplace_id: Optional[str] = None
    permissions: List[str] = []

class SyncJob(BaseModel):
    """Sync job information"""
    id: str
    type: str
    status: str
    started_at: str
    completed_at: Optional[str] = None
    progress: int = Field(..., ge=0, le=100)
    total_items: int
    processed_items: int
    estimated_completion: Optional[str] = None
    errors: List[str] = []
    warnings: List[str] = []

class SyncActivity(BaseModel):
    """Sync activity item"""
    id: str
    type: str
    status: str
    started_at: str
    completed_at: Optional[str] = None
    items_processed: int
    errors: List[str] = []

class SyncActivityResponse(BaseModel):
    """Sync activity list response"""
    activities: List[SyncActivity]
    total: int
    has_more: bool

# ============================================================================
# DETECTION SCHEMAS
# ============================================================================

class DetectionJob(BaseModel):
    """Detection job information"""
    id: str
    status: str
    started_at: str
    completed_at: Optional[str] = None
    estimated_completion: Optional[str] = None
    message: str

class DetectionResult(BaseModel):
    """Detection result details"""
    id: str
    status: str
    started_at: str
    completed_at: str
    claims_found: int
    total_amount: float
    high_confidence_claims: int
    medium_confidence_claims: int
    low_confidence_claims: int
    processing_time_seconds: int

# ============================================================================
# RECOVERIES SCHEMAS
# ============================================================================

class RecoveryMetadata(BaseModel):
    """Recovery metadata"""
    sku: Optional[str] = None
    asin: Optional[str] = None
    fulfillment_center: Optional[str] = None
    quantity_affected: Optional[int] = None

class RecoveryTimelineItem(BaseModel):
    """Recovery timeline item"""
    status: str
    timestamp: str
    description: str

class RecoveryEvidence(BaseModel):
    """Recovery evidence item"""
    id: str
    type: str
    url: str
    uploaded_at: str

class Recovery(BaseModel):
    """Recovery/claim information"""
    id: str
    claim_id: str
    type: str
    status: str
    amount: float
    currency: str
    created_at: str
    updated_at: str
    expected_payout_date: Optional[str] = None
    confidence_score: float
    evidence_count: int
    auto_submit_ready: bool
    amazon_case_id: Optional[str] = None
    timeline: List[RecoveryTimelineItem] = []
    evidence: List[RecoveryEvidence] = []
    metadata: RecoveryMetadata

class RecoveryListResponse(BaseModel):
    """Recovery list response"""
    recoveries: List[Recovery]
    total: int
    has_more: bool
    pagination: PaginationMeta

class RecoveryStatusResponse(BaseModel):
    """Recovery status response"""
    id: str
    status: str
    last_updated: str
    amazon_status: Optional[str] = None
    estimated_resolution: Optional[str] = None
    timeline: List[RecoveryTimelineItem]

class ClaimSubmissionResponse(BaseModel):
    """Claim submission response"""
    id: str
    status: str
    submitted_at: str
    amazon_case_id: str
    message: str
    estimated_resolution: str

# ============================================================================
# EVIDENCE SCHEMAS
# ============================================================================

class DocumentExtractedData(BaseModel):
    """Document extracted data"""
    amount: Optional[float] = None
    date: Optional[str] = None
    vendor: Optional[str] = None
    sku: Optional[str] = None
    quantity: Optional[int] = None
    unit_price: Optional[float] = None

class DocumentMetadata(BaseModel):
    """Document metadata"""
    pages: Optional[int] = None
    resolution: Optional[str] = None
    language: Optional[str] = None
    confidence_score: Optional[float] = None

class Document(BaseModel):
    """Document/evidence information"""
    id: str
    claim_id: str
    type: str
    filename: str
    size_bytes: int
    uploaded_at: str
    view_url: str
    download_url: str
    status: str
    ocr_text: Optional[str] = None
    extracted_data: DocumentExtractedData
    metadata: DocumentMetadata

class DocumentListResponse(BaseModel):
    """Document list response"""
    documents: List[Document]
    total: int
    has_more: bool
    pagination: PaginationMeta

class DocumentViewResponse(BaseModel):
    """Document view URL response"""
    id: str
    view_url: str
    expires_at: str
    max_views: int
    current_views: int

class DocumentDownloadResponse(BaseModel):
    """Document download URL response"""
    id: str
    download_url: str
    expires_at: str
    filename: str
    content_type: str

class DocumentUploadResponse(BaseModel):
    """Document upload response"""
    id: str
    status: str
    uploaded_at: str
    message: str
    processing_status: str

# ============================================================================
# EVIDENCE VALIDATOR (EV) SCHEMAS
# ============================================================================

class EvidenceSourceProvider(str, Enum):
    """Evidence source provider types"""
    GMAIL = "gmail"
    OUTLOOK = "outlook"
    GDRIVE = "gdrive"
    DROPBOX = "dropbox"

class EvidenceSourceStatus(str, Enum):
    """Evidence source connection status"""
    CONNECTED = "connected"
    DISCONNECTED = "disconnected"
    ERROR = "error"
    REFRESHING = "refreshing"

class EvidenceSource(BaseModel):
    """Evidence source connection information"""
    id: str
    provider: EvidenceSourceProvider
    account_email: str
    status: EvidenceSourceStatus
    connected_at: str
    last_sync_at: Optional[str] = None
    permissions: List[str] = []
    metadata: Dict[str, Any] = {}

class EvidenceSourceConnectRequest(BaseModel):
    """Request to connect evidence source"""
    provider: EvidenceSourceProvider
    oauth_code: str
    redirect_uri: Optional[str] = None

class EvidenceSourceConnectResponse(BaseModel):
    """Response after connecting evidence source"""
    status: str
    provider: str
    account: str
    source_id: str
    permissions: List[str] = []

class EvidenceSourceListResponse(BaseModel):
    """List of connected evidence sources"""
    sources: List[EvidenceSource]
    total: int

class EvidenceDocument(BaseModel):
    """Evidence document from external sources"""
    id: str
    source_id: str
    provider: str
    external_id: str
    filename: str
    size_bytes: int
    content_type: str
    created_at: str
    modified_at: str
    sender: Optional[str] = None
    subject: Optional[str] = None
    message_id: Optional[str] = None
    folder_path: Optional[str] = None
    download_url: Optional[str] = None
    thumbnail_url: Optional[str] = None
    metadata: Dict[str, Any] = {}
    processing_status: str = "pending"
    ocr_text: Optional[str] = None
    extracted_data: Optional[DocumentExtractedData] = None

class EvidenceDocumentListResponse(BaseModel):
    """List of evidence documents"""
    documents: List[EvidenceDocument]
    total: int
    has_more: bool
    pagination: PaginationMeta

class EvidenceIngestionJob(BaseModel):
    """Evidence ingestion job status"""
    id: str
    source_id: str
    status: str
    started_at: str
    completed_at: Optional[str] = None
    documents_found: int = 0
    documents_processed: int = 0
    errors: List[str] = []
    progress: int = Field(..., ge=0, le=100)

class EvidenceMatch(BaseModel):
    """Evidence match to claim candidate"""
    id: str
    claim_id: str
    document_id: str
    confidence_score: float = Field(..., ge=0, le=1)
    match_type: str
    matched_fields: List[str] = []
    reasoning: str
    created_at: str

# ============================================================================
# DOCUMENT PARSER SCHEMAS
# ============================================================================

class LineItem(BaseModel):
    """Invoice line item"""
    sku: Optional[str] = None
    description: str
    quantity: int
    unit_price: float
    total: float

class ParsedInvoiceData(BaseModel):
    """Structured invoice data extracted from documents"""
    supplier_name: Optional[str] = None
    invoice_number: Optional[str] = None
    invoice_date: Optional[str] = None
    total_amount: Optional[float] = None
    currency: Optional[str] = None
    line_items: List[LineItem] = []
    tax_amount: Optional[float] = None
    shipping_amount: Optional[float] = None
    payment_terms: Optional[str] = None
    po_number: Optional[str] = None
    raw_text: Optional[str] = None
    extraction_method: str = "regex"  # regex, ocr, ml
    confidence_score: float = Field(..., ge=0, le=1)

class ParserStatus(str, Enum):
    """Document parser status"""
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"
    RETRYING = "retrying"

class ParserJob(BaseModel):
    """Document parser job"""
    id: str
    document_id: str
    status: ParserStatus
    started_at: str
    completed_at: Optional[str] = None
    retry_count: int = 0
    max_retries: int = 3
    error_message: Optional[str] = None
    parser_type: str  # pdf, email, image
    extraction_method: str  # regex, ocr, ml
    confidence_score: Optional[float] = None

class ParserJobResponse(BaseModel):
    """Parser job response"""
    job_id: str
    status: str
    message: str
    estimated_completion: Optional[str] = None

class DocumentWithParsedData(EvidenceDocument):
    """Document with parsed invoice data"""
    parsed_metadata: Optional[ParsedInvoiceData] = None
    parser_status: ParserStatus = ParserStatus.PENDING
    parser_confidence: Optional[float] = None
    parser_error: Optional[str] = None

# ============================================================================
# EVIDENCE MATCHING SCHEMAS
# ============================================================================

class DisputeStatus(str, Enum):
    """Dispute case status"""
    PENDING = "pending"
    EVIDENCE_LINKED = "evidence_linked"
    AUTO_SUBMITTED = "auto_submitted"
    SMART_PROMPT_SENT = "smart_prompt_sent"
    MANUAL_REVIEW = "manual_review"
    RESOLVED = "resolved"
    REJECTED = "rejected"

class LinkType(str, Enum):
    """Evidence link type"""
    AUTO_MATCH = "auto_match"
    MANUAL_LINK = "manual_link"
    SMART_PROMPT_CONFIRMED = "smart_prompt_confirmed"
    ML_SUGGESTED = "ml_suggested"

class PromptStatus(str, Enum):
    """Smart prompt status"""
    PENDING = "pending"
    ANSWERED = "answered"
    DISMISSED = "dismissed"
    EXPIRED = "expired"

class DisputeCase(BaseModel):
    """Dispute case information"""
    id: str
    user_id: str
    order_id: str
    asin: Optional[str] = None
    sku: Optional[str] = None
    dispute_type: str
    status: DisputeStatus
    amount_claimed: Optional[float] = None
    currency: str = "USD"
    dispute_date: str
    order_date: Optional[str] = None
    evidence_linked_ids: List[str] = []
    match_confidence: Optional[float] = None
    match_path: Optional[str] = None
    auto_submit_ready: bool = False
    smart_prompt_sent: bool = False
    metadata: Dict[str, Any] = {}
    created_at: str
    updated_at: str

class DisputeEvidenceLink(BaseModel):
    """Link between dispute case and evidence document"""
    id: str
    dispute_id: str
    evidence_document_id: str
    link_type: LinkType
    confidence: float = Field(..., ge=0, le=1)
    match_reasoning: Optional[str] = None
    matched_fields: List[str] = []
    created_at: str

class SmartPrompt(BaseModel):
    """Smart prompt for ambiguous evidence matches"""
    id: str
    dispute_id: str
    evidence_document_id: str
    question: str
    options: List[Dict[str, Any]] = []
    status: PromptStatus = PromptStatus.PENDING
    selected_option: Optional[str] = None
    answered_at: Optional[str] = None
    expires_at: str
    created_at: str
    updated_at: str

class EvidenceMatchingJob(BaseModel):
    """Evidence matching job"""
    id: str
    user_id: str
    status: str
    started_at: str
    completed_at: Optional[str] = None
    disputes_processed: int = 0
    evidence_documents_processed: int = 0
    matches_found: int = 0
    auto_submits_triggered: int = 0
    smart_prompts_created: int = 0
    errors: List[str] = []
    metadata: Dict[str, Any] = {}

class EvidenceMatchingResult(BaseModel):
    """Evidence matching result"""
    id: str
    job_id: str
    dispute_id: str
    evidence_document_id: str
    rule_score: Optional[float] = None
    ml_score: Optional[float] = None
    final_confidence: float = Field(..., ge=0, le=1)
    match_type: str
    matched_fields: List[str] = []
    reasoning: str
    action_taken: str
    created_at: str

# ============================================================================
# DISPUTE SUBMISSION SCHEMAS (compatibility)
# ============================================================================

class SubmissionStatus(str, Enum):
    """Submission status values"""
    PENDING = "pending"
    SUBMITTED = "submitted"
    APPROVED = "approved"
    REJECTED = "rejected"
    FAILED = "failed"

class DisputeSubmission(BaseModel):
    """Minimal dispute submission schema for imports and responses"""
    id: str
    submission_id: Optional[str] = None
    amazon_case_id: Optional[str] = None
    status: str
    message: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)
    created_at: str
    updated_at: str

class AutoSubmitRequest(BaseModel):
    """Request to auto-submit evidence"""
    dispute_id: str
    evidence_document_id: str
    confidence: float = Field(..., ge=0, le=1)
    reasoning: Optional[str] = None

class AutoSubmitResponse(BaseModel):
    """Response from auto-submit"""
    success: bool
    dispute_id: str
    evidence_document_id: str
    action_taken: str
    message: str

class SmartPromptAnswer(BaseModel):
    """Answer to smart prompt"""
    selected_option: str
    reasoning: Optional[str] = None

class SmartPromptAnswerResponse(BaseModel):
    """Response from smart prompt answer"""
    success: bool
    prompt_id: str
    action_taken: str
    message: str

class EvidenceMatchMetrics(BaseModel):
    """Evidence matching metrics"""
    evidence_match_rate: float = Field(..., ge=0, le=1)
    auto_submit_rate: float = Field(..., ge=0, le=1)
    smart_prompt_rate: float = Field(..., ge=0, le=1)
    false_positive_alerts: int = 0
    total_disputes: int
    total_evidence_documents: int
    total_matches: int
    period: str

# ============================================================================
# METRICS SCHEMAS
# ============================================================================

class RecoveryTotals(BaseModel):
    """Recovery totals"""
    total_claims: int
    total_amount: float
    approved_claims: int
    approved_amount: float
    pending_claims: int
    pending_amount: float
    rejected_claims: int
    rejected_amount: float

class RecentActivity(BaseModel):
    """Recent activity item"""
    date: str
    claims_processed: int
    amount_recovered: float
    claims_approved: int

class UpcomingPayout(BaseModel):
    """Upcoming payout item"""
    id: str
    claim_id: str
    amount: float
    expected_date: str
    status: str
    confidence: float

class MonthlyBreakdown(BaseModel):
    """Monthly breakdown item"""
    month: str
    claims: int
    amount: float
    success_rate: float

class ClaimTypeStats(BaseModel):
    """Claim type statistics"""
    type: str
    count: int
    total_amount: float
    success_rate: float

class RecoveryMetrics(BaseModel):
    """Recovery metrics response"""
    period: str
    start_date: str
    end_date: str
    totals: RecoveryTotals
    success_rate: float
    average_claim_amount: float
    recent_activity: List[RecentActivity]
    upcoming_payouts: List[UpcomingPayout]
    monthly_breakdown: List[MonthlyBreakdown]
    top_claim_types: List[ClaimTypeStats]

class DashboardOverview(BaseModel):
    """Dashboard overview metrics"""
    total_recovered: float
    pending_amount: float
    this_month_recovered: float
    active_claims: int
    success_rate: float

class DashboardActivity(BaseModel):
    """Dashboard activity item"""
    id: str
    type: str
    description: str
    timestamp: str
    amount: Optional[float] = None

class QuickStats(BaseModel):
    """Quick stats"""
    claims_this_week: int
    amount_this_week: float
    avg_processing_time_days: float
    evidence_documents: int
    integrations_connected: int

class DashboardMetrics(BaseModel):
    """Dashboard metrics response"""
    overview: DashboardOverview
    recent_activity: List[DashboardActivity]
    quick_stats: QuickStats

# ============================================================================
# ERROR SCHEMAS
# ============================================================================

class APIError(BaseModel):
    """API error response"""
    detail: str
    error_code: Optional[str] = None
    timestamp: str = Field(default_factory=lambda: datetime.utcnow().isoformat() + "Z")

class ValidationError(BaseModel):
    """Validation error response"""
    detail: List[Dict[str, Any]]
    error_code: str = "VALIDATION_ERROR"
    timestamp: str = Field(default_factory=lambda: datetime.utcnow().isoformat() + "Z")

# ============================================================================
# VERSION INFO
# ============================================================================

# ============================================================================
# PHASE 4: SMART PROMPTS & PROOF PACKETS SCHEMAS
# ============================================================================

class SmartPromptRequest(BaseModel):
    """Smart prompt creation request"""
    claim_id: str
    question: str
    options: List[Dict[str, Any]] = Field(default_factory=list)
    expiry_hours: Optional[int] = 24
    metadata: Optional[Dict[str, Any]] = Field(default_factory=dict)

class SmartPromptResponse(BaseModel):
    """Smart prompt creation response"""
    prompt_id: str
    claim_id: str
    question: str
    options: List[Dict[str, Any]] = Field(default_factory=list)
    status: str
    expires_at: str
    created_at: str

class SmartPromptAnswer(BaseModel):
    """Smart prompt answer"""
    selected_option: str
    reasoning: Optional[str] = None

class SmartPromptAnswerResponse(BaseModel):
    """Smart prompt answer response"""
    success: bool
    prompt_id: str
    action_taken: str
    message: str

class ProofPacket(BaseModel):
    """Proof packet schema"""
    id: str
    claim_id: str
    user_id: str
    packet_url: str
    packet_size_bytes: Optional[int] = None
    status: str
    generation_started_at: Optional[str] = None
    generation_completed_at: Optional[str] = None
    error_message: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)
    created_at: str
    updated_at: str

class ProofPacketResponse(BaseModel):
    """Proof packet response"""
    packet_id: str
    claim_id: str
    packet_url: str
    status: str
    generated_at: str

class ProofPacketStatus(BaseModel):
    """Proof packet status"""
    packet_id: str
    status: str
    generation_started_at: Optional[str] = None
    generation_completed_at: Optional[str] = None
    error_message: Optional[str] = None
    packet_size_bytes: Optional[int] = None
    created_at: str

class AuditAction(str, Enum):
    """Audit action types"""
    PROMPT_CREATED = "prompt_created"
    PROMPT_ANSWERED = "prompt_answered"
    PROMPT_EXPIRED = "prompt_expired"
    PROMPT_CANCELLED = "prompt_cancelled"
    PACKET_GENERATED = "packet_generated"
    PACKET_FAILED = "packet_failed"
    PACKET_DOWNLOADED = "packet_downloaded"

class AuditLogEntry(BaseModel):
    """Audit log entry"""
    id: str
    user_id: str
    claim_id: Optional[str] = None
    action: AuditAction
    entity_type: str
    entity_id: str
    details: Dict[str, Any] = Field(default_factory=dict)
    ip_address: Optional[str] = None
    user_agent: Optional[str] = None
    created_at: str

class WebSocketMessage(BaseModel):
    """WebSocket message schema"""
    event: str
    data: Dict[str, Any]
    timestamp: str

class WebSocketEvent(BaseModel):
    """WebSocket event schema"""
    event_type: str
    prompt_id: Optional[str] = None
    claim_id: Optional[str] = None
    user_id: str
    data: Dict[str, Any]
    timestamp: str

class PacketStatus(str, Enum):
    """Proof packet status values"""
    PENDING = "pending"
    GENERATING = "generating"
    COMPLETED = "completed"
    FAILED = "failed"

class APIVersion(BaseModel):
    """API version information"""
    version: str = "1.0.0"
    schema_version: str = "1.0.0"
    last_updated: str = "2025-01-07T00:00:00Z"
    endpoints: Dict[str, str] = {
        "auth": "/api/auth",
        "integrations": "/api/integrations", 
        "detections": "/api/detections",
        "recoveries": "/api/recoveries",
        "evidence": "/api/documents",
        "metrics": "/api/metrics",
        "prompts": "/api/v1/evidence/prompts",
        "proof_packets": "/api/v1/evidence/proof-packets",
        "websocket": "/ws/evidence"
    }





