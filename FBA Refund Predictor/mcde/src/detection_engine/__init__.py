"""
MCDE Detection Engine

A Python-based detection engine that processes Amazon FBA data to identify anomalies
and generate evidence artifacts. This module provides parity with the TypeScript
detection system.

Modules:
    - types: Data types and interfaces
    - rules: Detection rule implementations
    - evidence: Evidence building and S3 artifact management
    - worker: Main worker process for job processing
"""

from .types import (
    Anomaly, RuleInput, RuleContext, Threshold, WhitelistItem,
    RuleType, AnomalySeverity, ThresholdOperator, WhitelistScope,
    DetectionJob, DetectionResult, EvidenceArtifact, DetectionJobRequest, QueueStats
)

from .rules import (
    BaseRule, LostUnitsRule, OverchargedFeesRule, DamagedStockRule, ALL_RULES
)

from .evidence import EvidenceBuilder
from .worker import DetectionWorker

__version__ = "1.0.0"
__all__ = [
    # Types
    "Anomaly", "RuleInput", "RuleContext", "Threshold", "WhitelistItem",
    "RuleType", "AnomalySeverity", "ThresholdOperator", "WhitelistScope",
    "DetectionJob", "DetectionResult", "EvidenceArtifact", "DetectionJobRequest", "QueueStats",
    
    # Rules
    "BaseRule", "LostUnitsRule", "OverchargedFeesRule", "DamagedStockRule", "ALL_RULES",
    
    # Core components
    "EvidenceBuilder", "DetectionWorker"
]

