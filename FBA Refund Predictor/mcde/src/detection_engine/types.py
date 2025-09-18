from enum import Enum
from typing import Dict, List, Optional, Any, Union
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal


class RuleType(str, Enum):
    LOST_UNITS = "LOST_UNITS"
    OVERCHARGED_FEES = "OVERCHARGED_FEES"
    DAMAGED_STOCK = "DAMAGED_STOCK"
    DUPLICATE_CHARGES = "DUPLICATE_CHARGES"
    INVALID_SHIPPING = "INVALID_SHIPPING"
    PRICING_DISCREPANCY = "PRICING_DISCREPANCY"


class AnomalySeverity(str, Enum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    CRITICAL = "CRITICAL"


class ThresholdOperator(str, Enum):
    GT = "GT"
    GTE = "GTE"
    LT = "LT"
    LTE = "LTE"
    EQ = "EQ"


class WhitelistScope(str, Enum):
    SKU = "SKU"
    ASIN = "ASIN"
    VENDOR = "VENDOR"
    SHIPMENT = "SHIPMENT"


@dataclass
class Anomaly:
    rule_type: RuleType
    severity: AnomalySeverity
    score: float  # 0.0 to 1.0 confidence score
    summary: str
    evidence: Dict[str, Any]
    dedupe_hash: str


@dataclass
class RuleInput:
    seller_id: str
    sync_id: str
    data: Dict[str, Any]


@dataclass
class Threshold:
    id: str
    seller_id: Optional[str]
    rule_type: RuleType
    operator: ThresholdOperator
    value: Decimal
    active: bool


@dataclass
class WhitelistItem:
    id: str
    seller_id: str
    scope: WhitelistScope
    value: str
    reason: Optional[str]
    active: bool


@dataclass
class RuleContext:
    seller_id: str
    sync_id: str
    thresholds: List[Threshold]
    whitelist: List[WhitelistItem]


@dataclass
class EvidenceMetadata:
    rule_type: RuleType
    seller_id: str
    sync_id: str
    timestamp: str
    input_snapshot_hash: str
    threshold_applied: Optional[Dict[str, Any]] = None
    whitelist_applied: Optional[Dict[str, Any]] = None
    computations: Optional[Dict[str, Any]] = None


@dataclass
class DetectionJob:
    id: str
    seller_id: str
    sync_id: str
    status: str  # PENDING, PROCESSING, COMPLETED, FAILED
    priority: str  # LOW, NORMAL, HIGH, CRITICAL
    attempts: int
    last_error: Optional[str]
    created_at: datetime
    updated_at: datetime


@dataclass
class DetectionResult:
    id: str
    seller_id: str
    sync_id: str
    rule_type: RuleType
    severity: AnomalySeverity
    score: float
    summary: str
    evidence_json: Dict[str, Any]
    evidence_s3_url: str
    dedupe_hash: str
    detection_job_id: str
    created_at: datetime


@dataclass
class EvidenceArtifact:
    evidence_json: Dict[str, Any]
    evidence_s3_url: str
    dedupe_hash: str


@dataclass
class DetectionJobRequest:
    seller_id: str
    sync_id: str
    priority: Optional[str] = None
    triggered_at: Optional[datetime] = None


@dataclass
class QueueStats:
    pending_count: int
    processing_count: int
    total_count: int
    priority_breakdown: Dict[str, int]

