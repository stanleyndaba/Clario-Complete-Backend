import hashlib
import json
from typing import Dict, Any, List
from datetime import datetime

import boto3
from botocore.exceptions import ClientError

from .types import (
    Anomaly, EvidenceArtifact, EvidenceMetadata, Threshold, WhitelistItem,
    RuleType, ThresholdOperator, WhitelistScope
)


class EvidenceBuilder:
    def __init__(self, s3_client, bucket_name: str, region: str):
        self.s3_client = s3_client
        self.bucket_name = bucket_name
        self.region = region

    async def build_evidence(
        self,
        anomaly: Anomaly,
        seller_id: str,
        sync_id: str,
        input_data: Dict[str, Any],
        thresholds: List[Threshold],
        whitelist: List[WhitelistItem]
    ) -> EvidenceArtifact:
        """Build deterministic evidence JSON and upload to S3."""
        # Create deterministic evidence JSON
        evidence_json = self._create_evidence_json(
            anomaly, seller_id, sync_id, input_data, thresholds, whitelist
        )
        
        # Generate S3 URL with consistent pathing
        evidence_s3_url = await self._upload_evidence_to_s3(
            evidence_json, seller_id, sync_id, anomaly.rule_type, anomaly.dedupe_hash
        )
        
        return EvidenceArtifact(
            evidence_json=evidence_json,
            evidence_s3_url=evidence_s3_url,
            dedupe_hash=anomaly.dedupe_hash
        )

    def _create_evidence_json(
        self,
        anomaly: Anomaly,
        seller_id: str,
        sync_id: str,
        input_data: Dict[str, Any],
        thresholds: List[Threshold],
        whitelist: List[WhitelistItem]
    ) -> Dict[str, Any]:
        """Create deterministic evidence JSON."""
        input_snapshot_hash = self._generate_input_snapshot_hash(input_data)
        
        metadata: EvidenceMetadata = EvidenceMetadata(
            rule_type=anomaly.rule_type,
            seller_id=seller_id,
            sync_id=sync_id,
            timestamp=datetime.utcnow().isoformat(),
            input_snapshot_hash=input_snapshot_hash,
            computations={
                "severity": anomaly.severity.value,
                "score": anomaly.score,
                "rulePriority": self._get_rule_priority(anomaly.rule_type)
            }
        )

        # Find applied thresholds
        applied_thresholds = [
            t for t in thresholds
            if t.rule_type == anomaly.rule_type and
            (t.seller_id is None or t.seller_id == seller_id)
        ]

        if applied_thresholds:
            metadata.threshold_applied = {
                "thresholdId": applied_thresholds[0].id,
                "operator": applied_thresholds[0].operator.value,
                "value": float(applied_thresholds[0].value)
            }

        # Find applied whitelist rules
        applied_whitelist = [
            w for w in whitelist
            if w.active and w.seller_id == seller_id
        ]

        if applied_whitelist:
            metadata.whitelist_applied = {
                "whitelistId": applied_whitelist[0].id,
                "scope": applied_whitelist[0].scope.value,
                "value": applied_whitelist[0].value
            }

        return {
            "metadata": {
                "ruleType": metadata.rule_type.value,
                "sellerId": metadata.seller_id,
                "syncId": metadata.sync_id,
                "timestamp": metadata.timestamp,
                "inputSnapshotHash": metadata.input_snapshot_hash,
                "thresholdApplied": metadata.threshold_applied,
                "whitelistApplied": metadata.whitelist_applied,
                "computations": metadata.computations
            },
            "anomaly": {
                "ruleType": anomaly.rule_type.value,
                "severity": anomaly.severity.value,
                "score": anomaly.score,
                "summary": anomaly.summary,
                "evidence": anomaly.evidence
            },
            "inputData": self._sanitize_input_data(input_data)
        }

    async def _upload_evidence_to_s3(
        self,
        evidence_json: Dict[str, Any],
        seller_id: str,
        sync_id: str,
        rule_type: RuleType,
        dedupe_hash: str
    ) -> str:
        """Upload evidence to S3 with consistent pathing."""
        key = f"evidence/{seller_id}/{sync_id}/{rule_type.value}/{dedupe_hash}.json"
        content = json.dumps(evidence_json, indent=2, default=str)

        try:
            self.s3_client.put_object(
                Bucket=self.bucket_name,
                Key=key,
                Body=content,
                ContentType='application/json',
                Metadata={
                    'seller-id': seller_id,
                    'sync-id': sync_id,
                    'rule-type': rule_type.value,
                    'dedupe-hash': dedupe_hash
                }
            )
            return f"s3://{self.bucket_name}/{key}"
        except ClientError as e:
            raise Exception(f"Failed to upload evidence to S3: {e}")

    def _generate_input_snapshot_hash(self, input_data: Dict[str, Any]) -> str:
        """Generate hash of input data for reproducibility."""
        normalized_data = self._normalize_data_for_hashing(input_data)
        return hashlib.sha256(
            json.dumps(normalized_data, sort_keys=True).encode()
        ).hexdigest()[:16]

    def _normalize_data_for_hashing(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Normalize data for consistent hashing."""
        normalized = {}
        
        for key, value in data.items():
            if isinstance(value, (int, float, str, bool)):
                normalized[key] = value
            elif isinstance(value, list):
                normalized[key] = sorted([
                    self._normalize_data_for_hashing(item) if isinstance(item, dict)
                    else item
                    for item in value
                ])
            elif isinstance(value, dict):
                normalized[key] = self._normalize_data_for_hashing(value)
        
        return normalized

    def _sanitize_input_data(self, input_data: Dict[str, Any]) -> Dict[str, Any]:
        """Remove sensitive information and normalize data for storage."""
        sanitized = {}
        
        for key, value in input_data.items():
            if any(sensitive in key.lower() for sensitive in ['password', 'secret', 'key']):
                sanitized[key] = '[REDACTED]'
            elif isinstance(value, dict):
                sanitized[key] = self._sanitize_input_data(value)
            else:
                sanitized[key] = value
        
        return sanitized

    def _get_rule_priority(self, rule_type: RuleType) -> str:
        """Get priority for a rule type."""
        if rule_type in [RuleType.LOST_UNITS, RuleType.OVERCHARGED_FEES]:
            return "HIGH"
        elif rule_type == RuleType.DAMAGED_STOCK:
            return "MEDIUM"
        else:
            return "NORMAL"

