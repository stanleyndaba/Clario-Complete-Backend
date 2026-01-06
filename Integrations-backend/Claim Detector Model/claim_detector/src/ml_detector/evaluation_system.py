#!/usr/bin/env python3
"""
Comprehensive Evaluation System for Claim Detector ML System
Tracks performance metrics, business impact, and system health
"""

import logging
import numpy as np
import pandas as pd
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, Any, Optional, List, Tuple, Union
from dataclasses import dataclass, field
import json
import sqlite3
from enum import Enum
from sklearn.metrics import (
    precision_score, recall_score, f1_score, accuracy_score,
    confusion_matrix, classification_report, roc_auc_score
)

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')
logger = logging.getLogger(__name__)

class MetricType(Enum):
    """Types of evaluation metrics"""
    CLASSIFICATION = "classification"
    BUSINESS = "business"
    SYSTEM = "system"
    CALIBRATION = "calibration"

class EvaluationPeriod(Enum):
    """Evaluation time periods"""
    HOURLY = "hourly"
    DAILY = "daily"
    WEEKLY = "weekly"
    MONTHLY = "monthly"

@dataclass
class ClassificationMetrics:
    """Classification performance metrics"""
    precision: float
    recall: float
    f1_score: float
    accuracy: float
    roc_auc: float
    timestamp: datetime
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for storage"""
        return {
            "precision": self.precision,
            "recall": self.recall,
            "f1_score": self.f1_score,
            "accuracy": self.accuracy,
            "roc_auc": self.roc_auc,
            "timestamp": self.timestamp.isoformat()
        }

@dataclass
class BusinessMetrics:
    """Business impact metrics"""
    total_claims: int
    valid_claims: int
    invalid_claims: int
    claim_approval_rate: float
    cost_savings: float
    revenue_impact: float
    timestamp: datetime
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for storage"""
        return {
            "total_claims": self.total_claims,
            "valid_claims": self.valid_claims,
            "invalid_claims": self.invalid_claims,
            "claim_approval_rate": self.claim_approval_rate,
            "cost_savings": self.cost_savings,
            "revenue_impact": self.revenue_impact,
            "timestamp": self.timestamp.isoformat()
        }

@dataclass
class SystemMetrics:
    """System performance metrics"""
    response_time_avg: float
    error_rate: float
    uptime_percentage: float
    throughput_requests_per_sec: float
    memory_usage_mb: float
    cpu_usage_percentage: float
    timestamp: datetime
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for storage"""
        return {
            "response_time_avg": self.response_time_avg,
            "error_rate": self.error_rate,
            "uptime_percentage": self.uptime_percentage,
            "throughput_requests_per_sec": self.throughput_requests_per_sec,
            "memory_usage_mb": self.memory_usage_mb,
            "cpu_usage_percentage": self.cpu_usage_percentage,
            "timestamp": self.timestamp.isoformat()
        }

class EvaluationSystem:
    """Main evaluation system for tracking ML performance and business impact"""
    
    def __init__(self, db_path: str = "evaluation_metrics.db"):
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(exist_ok=True)
        
        # Initialize database
        self._init_database()
        
        # Metric storage
        self.classification_metrics: List[ClassificationMetrics] = []
        self.business_metrics: List[BusinessMetrics] = []
        self.system_metrics: List[SystemMetrics] = []
        
        # Performance thresholds
        self.performance_thresholds = {
            "precision_min": 0.80,
            "recall_min": 0.75,
            "f1_min": 0.77,
            "accuracy_min": 0.80,
            "roc_auc_min": 0.85,
            "error_rate_max": 0.05,
            "response_time_max": 2.0,  # seconds
            "uptime_min": 0.99
        }
    
    def _init_database(self):
        """Initialize the evaluation metrics database"""
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            
            # Classification metrics table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS classification_metrics (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp TEXT,
                    precision REAL,
                    recall REAL,
                    f1_score REAL,
                    accuracy REAL,
                    roc_auc REAL
                )
            """)
            
            # Business metrics table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS business_metrics (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp TEXT,
                    total_claims INTEGER,
                    valid_claims INTEGER,
                    invalid_claims INTEGER,
                    claim_approval_rate REAL,
                    cost_savings REAL,
                    revenue_impact REAL
                )
            """)
            
            # System metrics table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS system_metrics (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp TEXT,
                    response_time_avg REAL,
                    error_rate REAL,
                    uptime_percentage REAL,
                    throughput_requests_per_sec REAL,
                    memory_usage_mb REAL,
                    cpu_usage_percentage REAL
                )
            """)
            
            conn.commit()
            conn.close()
            logger.info("✅ Evaluation database initialized")
            
        except Exception as e:
            logger.error(f"❌ Error initializing evaluation database: {e}")
    
    def evaluate_classification(self, y_true: np.ndarray, y_pred: np.ndarray, 
                              y_proba: Optional[np.ndarray] = None) -> ClassificationMetrics:
        """Evaluate classification performance"""
        try:
            # Basic classification metrics
            precision = precision_score(y_true, y_pred, average='weighted', zero_division=0)
            recall = recall_score(y_true, y_pred, average='weighted', zero_division=0)
            f1 = f1_score(y_true, y_pred, average='weighted', zero_division=0)
            accuracy = accuracy_score(y_true, y_pred)
            
            # ROC AUC (if probabilities provided)
            roc_auc = 0.0
            if y_proba is not None and len(np.unique(y_true)) == 2:
                try:
                    roc_auc = roc_auc_score(y_true, y_proba[:, 1] if y_proba.ndim > 1 else y_proba)
                except:
                    roc_auc = 0.0
            
            # Create metrics object
            metrics = ClassificationMetrics(
                precision=precision,
                recall=recall,
                f1_score=f1,
                accuracy=accuracy,
                roc_auc=roc_auc,
                timestamp=datetime.now()
            )
            
            # Store metrics
            self.classification_metrics.append(metrics)
            self._store_classification_metrics(metrics)
            
            logger.info(f"✅ Classification evaluation completed:")
            logger.info(f"   Precision: {precision:.3f}")
            logger.info(f"   Recall: {recall:.3f}")
            logger.info(f"   F1-Score: {f1:.3f}")
            logger.info(f"   Accuracy: {accuracy:.3f}")
            logger.info(f"   ROC AUC: {roc_auc:.3f}")
            
            return metrics
            
        except Exception as e:
            logger.error(f"❌ Error evaluating classification: {e}")
            raise
    
    def evaluate_business_impact(self, claims_data: Dict[str, Any]) -> BusinessMetrics:
        """Evaluate business impact metrics"""
        try:
            # Extract business metrics from claims data
            total_claims = claims_data.get('total_claims', 0)
            valid_claims = claims_data.get('valid_claims', 0)
            invalid_claims = claims_data.get('invalid_claims', 0)
            
            # Calculate derived metrics
            claim_approval_rate = valid_claims / total_claims if total_claims > 0 else 0.0
            cost_savings = claims_data.get('cost_savings', 0.0)
            revenue_impact = claims_data.get('revenue_impact', 0.0)
            
            # Create metrics object
            metrics = BusinessMetrics(
                total_claims=total_claims,
                valid_claims=valid_claims,
                invalid_claims=invalid_claims,
                claim_approval_rate=claim_approval_rate,
                cost_savings=cost_savings,
                revenue_impact=revenue_impact,
                timestamp=datetime.now()
            )
            
            # Store metrics
            self.business_metrics.append(metrics)
            self._store_business_metrics(metrics)
            
            logger.info(f"✅ Business impact evaluation completed:")
            logger.info(f"   Total claims: {total_claims}")
            logger.info(f"   Approval rate: {claim_approval_rate:.1%}")
            logger.info(f"   Cost savings: ${cost_savings:,.2f}")
            logger.info(f"   Revenue impact: ${revenue_impact:,.2f}")
            
            return metrics
            
        except Exception as e:
            logger.error(f"❌ Error evaluating business impact: {e}")
            raise
    
    def evaluate_system_performance(self, system_data: Dict[str, Any]) -> SystemMetrics:
        """Evaluate system performance metrics"""
        try:
            # Extract system metrics
            response_time_avg = system_data.get('response_time_avg', 0.0)
            error_rate = system_data.get('error_rate', 0.0)
            uptime = system_data.get('uptime_percentage', 1.0)
            throughput = system_data.get('throughput_requests_per_sec', 0.0)
            memory_usage = system_data.get('memory_usage_mb', 0.0)
            cpu_usage = system_data.get('cpu_usage_percentage', 0.0)
            
            # Create metrics object
            metrics = SystemMetrics(
                response_time_avg=response_time_avg,
                error_rate=error_rate,
                uptime_percentage=uptime,
                throughput_requests_per_sec=throughput,
                memory_usage_mb=memory_usage,
                cpu_usage_percentage=cpu_usage,
                timestamp=datetime.now()
            )
            
            # Store metrics
            self.system_metrics.append(metrics)
            self._store_system_metrics(metrics)
            
            logger.info(f"✅ System performance evaluation completed:")
            logger.info(f"   Response time (avg): {response_time_avg:.3f}s")
            logger.info(f"   Throughput: {throughput:.1f} req/s")
            logger.info(f"   Error rate: {error_rate:.1%}")
            logger.info(f"   Uptime: {uptime:.1%}")
            
            return metrics
            
        except Exception as e:
            logger.error(f"❌ Error evaluating system performance: {e}")
            raise
    
    def generate_performance_report(self, period: EvaluationPeriod = EvaluationPeriod.DAILY) -> Dict[str, Any]:
        """Generate comprehensive performance report"""
        try:
            # Get metrics for the specified period
            cutoff_time = self._get_cutoff_time(period)
            
            # Filter metrics by time
            recent_classification = [m for m in self.classification_metrics if m.timestamp >= cutoff_time]
            recent_business = [m for m in self.business_metrics if m.timestamp >= cutoff_time]
            recent_system = [m for m in self.system_metrics if m.timestamp >= cutoff_time]
            
            # Calculate summary statistics
            report = {
                "period": period.value,
                "evaluation_window": {
                    "start": cutoff_time.isoformat(),
                    "end": datetime.now().isoformat()
                },
                "classification_performance": self._summarize_classification_metrics(recent_classification),
                "business_impact": self._summarize_business_metrics(recent_business),
                "system_performance": self._summarize_system_metrics(recent_system),
                "overall_health": self._calculate_overall_health(recent_classification, recent_system),
                "recommendations": self._generate_recommendations(recent_classification, recent_system)
            }
            
            logger.info(f"✅ Performance report generated for {period.value} period")
            return report
            
        except Exception as e:
            logger.error(f"❌ Error generating performance report: {e}")
            return {"error": str(e)}
    
    def _get_cutoff_time(self, period: EvaluationPeriod) -> datetime:
        """Get cutoff time for the specified period"""
        now = datetime.now()
        
        if period == EvaluationPeriod.HOURLY:
            return now - timedelta(hours=1)
        elif period == EvaluationPeriod.DAILY:
            return now - timedelta(days=1)
        elif period == EvaluationPeriod.WEEKLY:
            return now - timedelta(weeks=1)
        elif period == EvaluationPeriod.MONTHLY:
            return now - timedelta(days=30)
        else:
            return now - timedelta(days=1)
    
    def _summarize_classification_metrics(self, metrics: List[ClassificationMetrics]) -> Dict[str, Any]:
        """Summarize classification metrics"""
        if not metrics:
            return {"status": "No data available"}
        
        return {
            "count": len(metrics),
            "latest": {
                "precision": metrics[-1].precision,
                "recall": metrics[-1].recall,
                "f1_score": metrics[-1].f1_score,
                "accuracy": metrics[-1].accuracy,
                "roc_auc": metrics[-1].roc_auc
            },
            "average": {
                "precision": np.mean([m.precision for m in metrics]),
                "recall": np.mean([m.recall for m in metrics]),
                "f1_score": np.mean([m.f1_score for m in metrics]),
                "accuracy": np.mean([m.accuracy for m in metrics]),
                "roc_auc": np.mean([m.roc_auc for m in metrics])
            }
        }
    
    def _summarize_business_metrics(self, metrics: List[BusinessMetrics]) -> Dict[str, Any]:
        """Summarize business metrics"""
        if not metrics:
            return {"status": "No data available"}
        
        return {
            "count": len(metrics),
            "latest": {
                "total_claims": metrics[-1].total_claims,
                "claim_approval_rate": metrics[-1].claim_approval_rate,
                "cost_savings": metrics[-1].cost_savings,
                "revenue_impact": metrics[-1].revenue_impact
            },
            "total": {
                "claims_processed": sum(m.total_claims for m in metrics),
                "total_cost_savings": sum(m.cost_savings for m in metrics),
                "total_revenue_impact": sum(m.revenue_impact for m in metrics)
            }
        }
    
    def _summarize_system_metrics(self, metrics: List[SystemMetrics]) -> Dict[str, Any]:
        """Summarize system metrics"""
        if not metrics:
            return {"status": "No data available"}
        
        return {
            "count": len(metrics),
            "latest": {
                "response_time_avg": metrics[-1].response_time_avg,
                "error_rate": metrics[-1].error_rate,
                "uptime_percentage": metrics[-1].uptime_percentage,
                "throughput": metrics[-1].throughput_requests_per_sec
            },
            "average": {
                "response_time_avg": np.mean([m.response_time_avg for m in metrics]),
                "error_rate": np.mean([m.error_rate for m in metrics]),
                "uptime_percentage": np.mean([m.uptime_percentage for m in metrics]),
                "throughput": np.mean([m.throughput_requests_per_sec for m in metrics])
            }
        }
    
    def _calculate_overall_health(self, classification_metrics: List[ClassificationMetrics], 
                                 system_metrics: List[SystemMetrics]) -> Dict[str, Any]:
        """Calculate overall system health score"""
        try:
            health_score = 100.0
            issues = []
            
            # Check classification performance
            if classification_metrics:
                latest_class = classification_metrics[-1]
                
                if latest_class.f1_score < self.performance_thresholds["f1_min"]:
                    health_score -= 20
                    issues.append(f"F1 score below threshold: {latest_class.f1_score:.3f}")
                
                if latest_class.accuracy < self.performance_thresholds["accuracy_min"]:
                    health_score -= 15
                    issues.append(f"Accuracy below threshold: {latest_class.accuracy:.3f}")
            
            # Check system performance
            if system_metrics:
                latest_system = system_metrics[-1]
                
                if latest_system.error_rate > self.performance_thresholds["error_rate_max"]:
                    health_score -= 25
                    issues.append(f"Error rate above threshold: {latest_system.error_rate:.1%}")
                
                if latest_system.response_time_avg > self.performance_thresholds["response_time_max"]:
                    health_score -= 15
                    issues.append(f"Response time above threshold: {latest_system.response_time_avg:.3f}s")
                
                if latest_system.uptime_percentage < self.performance_thresholds["uptime_min"]:
                    health_score -= 30
                    issues.append(f"Uptime below threshold: {latest_system.uptime_percentage:.1%}")
            
            # Ensure health score is within bounds
            health_score = max(0, min(100, health_score))
            
            # Determine health level
            if health_score >= 90:
                health_level = "excellent"
            elif health_score >= 75:
                health_level = "good"
            elif health_score >= 60:
                health_level = "fair"
            else:
                health_level = "poor"
            
            return {
                "score": health_score,
                "level": health_level,
                "issues": issues,
                "status": "healthy" if health_score >= 75 else "needs_attention"
            }
            
        except Exception as e:
            logger.error(f"❌ Error calculating overall health: {e}")
            return {"score": 0, "level": "unknown", "issues": [str(e)], "status": "error"}
    
    def _generate_recommendations(self, classification_metrics: List[ClassificationMetrics], 
                                 system_metrics: List[SystemMetrics]) -> List[str]:
        """Generate actionable recommendations"""
        recommendations = []
        
        try:
            # Classification performance recommendations
            if classification_metrics:
                latest_class = classification_metrics[-1]
                
                if latest_class.f1_score < self.performance_thresholds["f1_min"]:
                    recommendations.append("Consider retraining the model with recent data")
                    recommendations.append("Review feature engineering and data quality")
                
                if latest_class.precision < self.performance_thresholds["precision_min"]:
                    recommendations.append("Investigate false positive cases")
                    recommendations.append("Consider adjusting classification thresholds")
                
                if latest_class.recall < self.performance_thresholds["recall_min"]:
                    recommendations.append("Investigate false negative cases")
                    recommendations.append("Review class imbalance in training data")
            
            # System performance recommendations
            if system_metrics:
                latest_system = system_metrics[-1]
                
                if latest_system.error_rate > self.performance_thresholds["error_rate_max"]:
                    recommendations.append("Investigate error logs and system stability")
                    recommendations.append("Consider scaling system resources")
                
                if latest_system.response_time_avg > self.performance_thresholds["response_time_max"]:
                    recommendations.append("Optimize model inference performance")
                    recommendations.append("Consider model compression or caching")
                
                if latest_system.uptime_percentage < self.performance_thresholds["uptime_min"]:
                    recommendations.append("Review system monitoring and alerting")
                    recommendations.append("Implement automatic failover mechanisms")
            
            # General recommendations
            if not recommendations:
                recommendations.append("System performing well - continue monitoring")
                recommendations.append("Consider A/B testing for model improvements")
            
        except Exception as e:
            logger.error(f"❌ Error generating recommendations: {e}")
            recommendations.append("Unable to generate recommendations due to error")
        
        return recommendations
    
    def _store_classification_metrics(self, metrics: ClassificationMetrics):
        """Store classification metrics in database"""
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            
            cursor.execute("""
                INSERT INTO classification_metrics VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (
                None,  # Auto-increment ID
                metrics.timestamp.isoformat(),
                metrics.precision,
                metrics.recall,
                metrics.f1_score,
                metrics.accuracy,
                metrics.roc_auc
            ))
            
            conn.commit()
            conn.close()
            
        except Exception as e:
            logger.error(f"❌ Error storing classification metrics: {e}")
    
    def _store_business_metrics(self, metrics: BusinessMetrics):
        """Store business metrics in database"""
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            
            cursor.execute("""
                INSERT INTO business_metrics VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                None,  # Auto-increment ID
                metrics.timestamp.isoformat(),
                metrics.total_claims,
                metrics.valid_claims,
                metrics.invalid_claims,
                metrics.claim_approval_rate,
                metrics.cost_savings,
                metrics.revenue_impact
            ))
            
            conn.commit()
            conn.close()
            
        except Exception as e:
            logger.error(f"❌ Error storing business metrics: {e}")
    
    def _store_system_metrics(self, metrics: SystemMetrics):
        """Store system metrics in database"""
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            
            cursor.execute("""
                INSERT INTO system_metrics VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                None,  # Auto-increment ID
                metrics.timestamp.isoformat(),
                metrics.response_time_avg,
                metrics.error_rate,
                metrics.uptime_percentage,
                metrics.throughput_requests_per_sec,
                metrics.memory_usage_mb,
                metrics.cpu_usage_percentage
            ))
            
            conn.commit()
            conn.close()
            
        except Exception as e:
            logger.error(f"❌ Error storing system metrics: {e}")
    
    def get_metrics_summary(self) -> Dict[str, Any]:
        """Get summary of all stored metrics"""
        try:
            return {
                "classification_metrics": len(self.classification_metrics),
                "business_metrics": len(self.business_metrics),
                "system_metrics": len(self.system_metrics),
                "database_path": str(self.db_path),
                "last_updated": datetime.now().isoformat()
            }
        except Exception as e:
            logger.error(f"❌ Error getting metrics summary: {e}")
            return {"error": str(e)}
