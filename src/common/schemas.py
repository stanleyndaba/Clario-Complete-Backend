from typing import List, Optional, Dict, Literal
from pydantic import BaseModel, Field
from datetime import datetime

ClaimType = Literal["lost_inventory","damaged_goods","fee_error","missing_reimbursement",
                    "weight_dimension_error","destroyed_inventory","return_processing_error",
                    "shipment_shortage","shipment_overcharge","high_value_loss","other"]

class ClaimMetadata(BaseModel):
    marketplace_id: str
    seller_id: str
    order_id: Optional[str] = None
    sku: Optional[str] = None
    fnsku: Optional[str] = None
    asin: Optional[str] = None
    shipment_id: Optional[str] = None
    fulfillment_center: Optional[str] = None
    detected_at: datetime

class ClaimDetection(BaseModel):
    claim_id: str
    claim_type: ClaimType
    confidence: float = Field(ge=0, le=1)
    amount_estimate: float
    quantity_affected: int
    features: Dict[str, float] = {}
    text_excerpt: Optional[str] = None
    metadata: ClaimMetadata

class EvidenceItem(BaseModel):
    kind: str  # "invoice","shipment_report","fee_report","photo","chat_log","return_report"
    uri: str   # s3://..., file://..., https://...
    checksum: Optional[str] = None
    captured_at: Optional[datetime] = None
    extra: Dict[str, str] = {}

class ValidationResult(BaseModel):
    claim_id: str
    claim_type: ClaimType
    compliant: bool
    evidence_required: List[str]
    evidence_present: List[str]
    missing_evidence: List[str]
    ml_validity_score: float  # 0..1
    reasons: List[str]
    recommended_actions: List[str]
    auto_file_ready: bool
    confidence_calibrated: float

class ClaimPacket(BaseModel):
    claim_id: str
    claim_type: ClaimType
    narrative: str
    line_items: List[Dict]
    amount_requested: float
    evidence: List[EvidenceItem]
    attachments_manifest: Dict[str, str]  # kind -> uri
    metadata: ClaimMetadata
    built_at: datetime

class FilingResult(BaseModel):
    claim_id: str
    submitted: bool
    amazon_case_id: Optional[str]
    status: Literal["submitted","queued","failed"]
    message: Optional[str] = None
    filed_at: Optional[datetime] = None

