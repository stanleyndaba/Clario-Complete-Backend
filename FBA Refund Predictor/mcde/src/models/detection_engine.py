"""
Detection Engine for MCDE (Manufacturing Cost Document Engine)
Implements anomaly detection pipeline with configurable rules and evidence generation.
"""

import json
import logging
from datetime import datetime
from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass, asdict
from enum import Enum
import boto3
from botocore.exceptions import ClientError
import redis
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

logger = logging.getLogger(__name__)


class AnomalyType(Enum):
    """Types of anomalies that can be detected."""
    LOST_UNITS = "lost_units"
    OVERCHARGED_FEES = "overcharged_fees"
    DAMAGED_STOCK = "damaged_stock"
    DUPLICATE_CHARGES = "duplicate_charges"
    INVALID_SHIPPING = "invalid_shipping"
    PRICING_DISCREPANCY = "pricing_discrepancy"


class AnomalySeverity(Enum):
    """Severity levels for detected anomalies."""
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class ThresholdOperator(Enum):
    """Operators for threshold comparisons."""
    GREATER_THAN = "greater_than"
    GREATER_THAN_OR_EQUAL = "greater_than_or_equal"
    LESS_THAN = "less_than"
    LESS_THAN_OR_EQUAL = "less_than_or_equal"
    EQUALS = "equals"
    NOT_EQUALS = "not_equals"


@dataclass
class DetectionThreshold:
    """Configuration for detection thresholds."""
    anomaly_type: AnomalyType
    threshold: float
    operator: ThresholdOperator
    is_active: bool = True
    description: Optional[str] = None


@dataclass
class DetectionWhitelist:
    """Configuration for detection whitelists."""
    sku_code: Optional[str] = None
    vendor_name: Optional[str] = None
    account_id: Optional[str] = None
    reason: Optional[str] = None
    is_active: bool = True


@dataclass
class AnomalyEvidence:
    """Evidence for a detected anomaly."""
    sync_id: str
    seller_id: str
    detected_anomalies: List[Dict[str, Any]]
    metadata: Dict[str, Any]
    created_at: str


@dataclass
class DetectionResult:
    """Result of anomaly detection."""
    detection_job_id: str
    cost_doc_id: str
    sku_id: str
    anomaly_type: AnomalyType
    severity: AnomalySeverity
    confidence: float
    evidence_url: str
    evidence_json: Dict[str, Any]
    threshold_value: float
    actual_value: float
    is_whitelisted: bool


class DetectionEngine:
    """
    Core detection engine that analyzes cost documents for anomalies.
    """
    
    def __init__(self, config: Dict[str, Any]):
        """
        Initialize the detection engine.
        
        Args:
            config: Configuration dictionary containing database, S3, and Redis settings
        """
        self.config = config
        self.logger = logging.getLogger(__name__)
        
        # Initialize database connection
        self.db_engine = create_engine(config['database']['url'])
        self.SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=self.db_engine)
        
        # Initialize S3 client
        self.s3_client = boto3.client(
            's3',
            aws_access_key_id=config['aws']['access_key_id'],
            aws_secret_access_key=config['aws']['secret_access_key'],
            region_name=config['aws']['region']
        )
        self.s3_bucket = config['aws']['s3_bucket']
        
        # Initialize Redis client
        self.redis_client = redis.Redis.from_url(config['redis']['url'])
        
        # Default thresholds
        self.default_thresholds = {
            AnomalyType.LOST_UNITS: DetectionThreshold(
                anomaly_type=AnomalyType.LOST_UNITS,
                threshold=1.0,
                operator=ThresholdOperator.GREATER_THAN,
                description="Alert when lost units exceed 1"
            ),
            AnomalyType.OVERCHARGED_FEES: DetectionThreshold(
                anomaly_type=AnomalyType.OVERCHARGED_FEES,
                threshold=0.50,
                operator=ThresholdOperator.GREATER_THAN,
                description="Alert when fee discrepancy exceeds $0.50"
            ),
            AnomalyType.DAMAGED_STOCK: DetectionThreshold(
                anomaly_type=AnomalyType.DAMAGED_STOCK,
                threshold=0.0,
                operator=ThresholdOperator.GREATER_THAN,
                description="Alert when damaged stock is greater than 0"
            )
        }
        
        # Load custom thresholds from database
        self.load_custom_thresholds()
        
        # Load whitelists from database
        self.load_whitelists()
    
    def load_custom_thresholds(self) -> None:
        """Load custom thresholds from database."""
        try:
            with self.SessionLocal() as session:
                result = session.execute(text("""
                    SELECT anomaly_type, threshold, operator, is_active, description
                    FROM detection_thresholds
                    WHERE is_active = true
                """))
                
                for row in result:
                    anomaly_type = AnomalyType(row.anomaly_type)
                    operator = ThresholdOperator(row.operator)
                    
                    self.default_thresholds[anomaly_type] = DetectionThreshold(
                        anomaly_type=anomaly_type,
                        threshold=float(row.threshold),
                        operator=operator,
                        is_active=row.is_active,
                        description=row.description
                    )
                    
            self.logger.info(f"Loaded {len(self.default_thresholds)} custom thresholds")
        except Exception as e:
            self.logger.warning(f"Failed to load custom thresholds: {e}")
    
    def load_whitelists(self) -> None:
        """Load whitelists from database."""
        try:
            with self.SessionLocal() as session:
                result = session.execute(text("""
                    SELECT sku_code, vendor_name, account_id, reason, is_active
                    FROM detection_whitelists
                    WHERE is_active = true
                """))
                
                self.whitelists = [
                    DetectionWhitelist(
                        sku_code=row.sku_code,
                        vendor_name=row.vendor_name,
                        account_id=row.account_id,
                        reason=row.reason,
                        is_active=row.is_active
                    )
                    for row in result
                ]
                
            self.logger.info(f"Loaded {len(self.whitelists)} whitelist entries")
        except Exception as e:
            self.logger.warning(f"Failed to load whitelists: {e}")
            self.whitelists = []
    
    def detect_anomalies(self, cost_documents: List[Dict[str, Any]], claim_id: str, user_id: str) -> List[DetectionResult]:
        """
        Detect anomalies in cost documents.
        
        Args:
            cost_documents: List of cost document data
            claim_id: ID of the claim being analyzed
            user_id: ID of the user requesting analysis
            
        Returns:
            List of detected anomalies
        """
        anomalies = []
        
        for cost_doc in cost_documents:
            metadata = cost_doc.get('metadata', {})
            
            # Check for lost units
            if 'lost_units' in metadata:
                anomaly = self._check_lost_units(cost_doc, metadata)
                if anomaly:
                    anomalies.append(anomaly)
            
            # Check for overcharged fees
            if 'fee_amount' in metadata and 'expected_fee' in metadata:
                anomaly = self._check_overcharged_fees(cost_doc, metadata)
                if anomaly:
                    anomalies.append(anomaly)
            
            # Check for damaged stock
            if 'damaged_stock' in metadata:
                anomaly = self._check_damaged_stock(cost_doc, metadata)
                if anomaly:
                    anomalies.append(anomaly)
        
        return anomalies
    
    def _check_lost_units(self, cost_doc: Dict[str, Any], metadata: Dict[str, Any]) -> Optional[DetectionResult]:
        """Check for lost units anomaly."""
        threshold = self.default_thresholds.get(AnomalyType.LOST_UNITS)
        if not threshold:
            return None
        
        lost_units = metadata.get('lost_units', 0)
        if self._check_threshold(lost_units, threshold):
            if not self._is_whitelisted(cost_doc):
                return DetectionResult(
                    detection_job_id="",  # Will be set by caller
                    cost_doc_id=cost_doc['id'],
                    sku_id=cost_doc['sku_id'],
                    anomaly_type=AnomalyType.LOST_UNITS,
                    severity=self._calculate_severity(lost_units, threshold.threshold),
                    confidence=self._calculate_confidence(lost_units, threshold.threshold),
                    evidence_url="",  # Will be set by caller
                    evidence_json={
                        'claim_id': cost_doc.get('claim_id'),
                        'cost_document': cost_doc['id'],
                        'metadata': metadata
                    },
                    threshold_value=threshold.threshold,
                    actual_value=lost_units,
                    is_whitelisted=False
                )
        return None
    
    def _check_overcharged_fees(self, cost_doc: Dict[str, Any], metadata: Dict[str, Any]) -> Optional[DetectionResult]:
        """Check for overcharged fees anomaly."""
        threshold = self.default_thresholds.get(AnomalyType.OVERCHARGED_FEES)
        if not threshold:
            return None
        
        fee_amount = metadata.get('fee_amount', 0)
        expected_fee = metadata.get('expected_fee', 0)
        discrepancy = fee_amount - expected_fee
        
        if self._check_threshold(discrepancy, threshold):
            if not self._is_whitelisted(cost_doc):
                return DetectionResult(
                    detection_job_id="",  # Will be set by caller
                    cost_doc_id=cost_doc['id'],
                    sku_id=cost_doc['sku_id'],
                    anomaly_type=AnomalyType.OVERCHARGED_FEES,
                    severity=self._calculate_severity(discrepancy, threshold.threshold),
                    confidence=self._calculate_confidence(discrepancy, threshold.threshold),
                    evidence_url="",  # Will be set by caller
                    evidence_json={
                        'claim_id': cost_doc.get('claim_id'),
                        'cost_document': cost_doc['id'],
                        'metadata': metadata
                    },
                    threshold_value=threshold.threshold,
                    actual_value=discrepancy,
                    is_whitelisted=False
                )
        return None
    
    def _check_damaged_stock(self, cost_doc: Dict[str, Any], metadata: Dict[str, Any]) -> Optional[DetectionResult]:
        """Check for damaged stock anomaly."""
        threshold = self.default_thresholds.get(AnomalyType.DAMAGED_STOCK)
        if not threshold:
            return None
        
        damaged_stock = metadata.get('damaged_stock', 0)
        if self._check_threshold(damaged_stock, threshold):
            if not self._is_whitelisted(cost_doc):
                return DetectionResult(
                    detection_job_id="",  # Will be set by caller
                    cost_doc_id=cost_doc['id'],
                    sku_id=cost_doc['sku_id'],
                    anomaly_type=AnomalyType.DAMAGED_STOCK,
                    severity=self._calculate_severity(damaged_stock, threshold.threshold),
                    confidence=self._calculate_confidence(damaged_stock, threshold.threshold),
                    evidence_url="",  # Will be set by caller
                    evidence_json={
                        'claim_id': cost_doc.get('claim_id'),
                        'cost_document': cost_doc['id'],
                        'metadata': metadata
                    },
                    threshold_value=threshold.threshold,
                    actual_value=damaged_stock,
                    is_whitelisted=False
                )
        return None
    
    def _check_threshold(self, value: float, threshold: DetectionThreshold) -> bool:
        """Check if a value exceeds a threshold based on the operator."""
        if threshold.operator == ThresholdOperator.GREATER_THAN:
            return value > threshold.threshold
        elif threshold.operator == ThresholdOperator.GREATER_THAN_OR_EQUAL:
            return value >= threshold.threshold
        elif threshold.operator == ThresholdOperator.LESS_THAN:
            return value < threshold.threshold
        elif threshold.operator == ThresholdOperator.LESS_THAN_OR_EQUAL:
            return value <= threshold.threshold
        elif threshold.operator == ThresholdOperator.EQUALS:
            return value == threshold.threshold
        elif threshold.operator == ThresholdOperator.NOT_EQUALS:
            return value != threshold.threshold
        return False
    
    def _is_whitelisted(self, cost_doc: Dict[str, Any]) -> bool:
        """Check if a cost document is whitelisted."""
        metadata = cost_doc.get('metadata', {})
        
        for whitelist in self.whitelists:
            if not whitelist.is_active:
                continue
            
            if whitelist.sku_code and cost_doc.get('sku_id') == whitelist.sku_code:
                return True
            if whitelist.vendor_name and metadata.get('vendor_name') == whitelist.vendor_name:
                return True
            if whitelist.account_id and metadata.get('account_id') == whitelist.account_id:
                return True
        
        return False
    
    def _calculate_severity(self, value: float, threshold: float) -> AnomalySeverity:
        """Calculate anomaly severity based on value and threshold."""
        ratio = abs(value) / abs(threshold)
        
        if ratio >= 5:
            return AnomalySeverity.CRITICAL
        elif ratio >= 3:
            return AnomalySeverity.HIGH
        elif ratio >= 1.5:
            return AnomalySeverity.MEDIUM
        else:
            return AnomalySeverity.LOW
    
    def _calculate_confidence(self, value: float, threshold: float) -> float:
        """Calculate confidence score based on value and threshold."""
        ratio = abs(value) / abs(threshold)
        # Higher ratio = higher confidence
        return min(0.95, max(0.5, ratio / 10))
    
    def generate_evidence_artifact(self, detection_job_id: str, user_id: str, anomalies: List[DetectionResult]) -> str:
        """
        Generate evidence artifact and upload to S3.
        
        Args:
            detection_job_id: ID of the detection job
            user_id: ID of the user
            anomalies: List of detected anomalies
            
        Returns:
            S3 key of the uploaded evidence artifact
        """
        evidence = AnomalyEvidence(
            sync_id=detection_job_id,
            seller_id=user_id,
            detected_anomalies=[
                {
                    'event_type': anomaly.anomaly_type.value,
                    'item_id': anomaly.sku_id,
                    'amount_discrepancy': anomaly.actual_value,
                    'evidence_refs': [
                        f"claim:{anomaly.evidence_json.get('claim_id')}",
                        f"doc:{anomaly.evidence_json.get('cost_document')}"
                    ]
                }
                for anomaly in anomalies
            ],
            metadata={
                'source_tables': ['claims', 'cost_documents', 'skus'],
                'detection_version': 'v1.0',
                'thresholds_applied': {
                    threshold.anomaly_type.value: threshold.threshold
                    for threshold in self.default_thresholds.values()
                },
                'whitelist_checks': {
                    'whitelist_count': len(self.whitelists)
                }
            },
            created_at=datetime.utcnow().isoformat()
        )
        
        # Upload evidence to S3
        evidence_key = f"evidence/{user_id}/{detection_job_id}/detection.json"
        
        try:
            self.s3_client.put_object(
                Bucket=self.s3_bucket,
                Key=evidence_key,
                Body=json.dumps(asdict(evidence), default=str),
                ContentType='application/json'
            )
            
            self.logger.info(f"Evidence artifact uploaded to S3: {evidence_key}")
            return evidence_key
            
        except ClientError as e:
            self.logger.error(f"Failed to upload evidence to S3: {e}")
            raise
    
    def store_detection_results(self, detection_job_id: str, anomalies: List[DetectionResult], evidence_key: str) -> None:
        """
        Store detection results in database.
        
        Args:
            detection_job_id: ID of the detection job
            anomalies: List of detected anomalies
            evidence_key: S3 key of the evidence artifact
        """
        try:
            with self.SessionLocal() as session:
                for anomaly in anomalies:
                    # Update anomaly with detection job ID and evidence URL
                    anomaly.detection_job_id = detection_job_id
                    anomaly.evidence_url = evidence_key
                    
                    # Insert detection result
                    session.execute(text("""
                        INSERT INTO detection_results (
                            detection_job_id, cost_doc_id, sku_id, anomaly_type,
                            severity, confidence, evidence_url, evidence_json,
                            threshold_value, actual_value, is_whitelisted, created_at
                        ) VALUES (
                            :detection_job_id, :cost_doc_id, :sku_id, :anomaly_type,
                            :severity, :confidence, :evidence_url, :evidence_json,
                            :threshold_value, :actual_value, :is_whitelisted, :created_at
                        )
                    """), {
                        'detection_job_id': anomaly.detection_job_id,
                        'cost_doc_id': anomaly.cost_doc_id,
                        'sku_id': anomaly.sku_id,
                        'anomaly_type': anomaly.anomaly_type.value,
                        'severity': anomaly.severity.value,
                        'confidence': anomaly.confidence,
                        'evidence_url': anomaly.evidence_url,
                        'evidence_json': json.dumps(anomaly.evidence_json),
                        'threshold_value': anomaly.threshold_value,
                        'actual_value': anomaly.actual_value,
                        'is_whitelisted': anomaly.is_whitelisted,
                        'created_at': datetime.utcnow()
                    })
                
                session.commit()
                self.logger.info(f"Stored {len(anomalies)} detection results")
                
        except Exception as e:
            self.logger.error(f"Failed to store detection results: {e}")
            raise
    
    def get_detection_results(self, claim_id: str) -> List[Dict[str, Any]]:
        """
        Get detection results for a claim.
        
        Args:
            claim_id: ID of the claim
            
        Returns:
            List of detection results
        """
        try:
            with self.SessionLocal() as session:
                result = session.execute(text("""
                    SELECT dr.*, dj.claim_id, dj.user_id
                    FROM detection_results dr
                    JOIN detection_jobs dj ON dr.detection_job_id = dj.id
                    WHERE dj.claim_id = :claim_id
                    ORDER BY dr.created_at DESC
                """), {'claim_id': claim_id})
                
                return [dict(row) for row in result]
                
        except Exception as e:
            self.logger.error(f"Failed to get detection results: {e}")
            return []
    
    def get_detection_statistics(self, user_id: str) -> Dict[str, Any]:
        """
        Get detection statistics for a user.
        
        Args:
            user_id: ID of the user
            
        Returns:
            Dictionary containing detection statistics
        """
        try:
            with self.SessionLocal() as session:
                # Get job counts
                job_stats = session.execute(text("""
                    SELECT 
                        COUNT(*) as total_jobs,
                        COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_jobs,
                        COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_jobs
                    FROM detection_jobs
                    WHERE user_id = :user_id
                """), {'user_id': user_id}).fetchone()
                
                # Get anomaly count
                anomaly_count = session.execute(text("""
                    SELECT COUNT(*) as total_anomalies
                    FROM detection_results dr
                    JOIN detection_jobs dj ON dr.detection_job_id = dj.id
                    WHERE dj.user_id = :user_id
                """), {'user_id': user_id}).fetchone()
                
                total_jobs = job_stats.total_jobs or 0
                completed_jobs = job_stats.completed_jobs or 0
                failed_jobs = job_stats.failed_jobs or 0
                total_anomalies = anomaly_count.total_anomalies or 0
                
                return {
                    'total_jobs': total_jobs,
                    'completed_jobs': completed_jobs,
                    'failed_jobs': failed_jobs,
                    'total_anomalies': total_anomalies,
                    'success_rate': (completed_jobs / total_jobs * 100) if total_jobs > 0 else 0
                }
                
        except Exception as e:
            self.logger.error(f"Failed to get detection statistics: {e}")
            return {
                'total_jobs': 0,
                'completed_jobs': 0,
                'failed_jobs': 0,
                'total_anomalies': 0,
                'success_rate': 0
            }


