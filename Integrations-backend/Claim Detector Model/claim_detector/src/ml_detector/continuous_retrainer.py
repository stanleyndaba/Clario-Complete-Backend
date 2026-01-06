#!/usr/bin/env python3
"""
Continuous Retraining Pipeline for Claim Detector ML System
Automatically schedules and executes model retraining based on data drift and performance metrics
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
import threading
import time
from enum import Enum
import pickle

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')
logger = logging.getLogger(__name__)

class RetrainingTrigger(Enum):
    """Types of retraining triggers"""
    SCHEDULED = "scheduled"
    DATA_DRIFT = "data_drift"
    PERFORMANCE_DECAY = "performance_decay"
    MANUAL = "manual"
    DATA_VOLUME = "data_volume"

class RetrainingStatus(Enum):
    """Retraining job statuses"""
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"

@dataclass
class RetrainingJob:
    """Represents a retraining job"""
    job_id: str
    trigger_type: RetrainingTrigger
    status: RetrainingStatus
    created_at: datetime
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    training_samples: int = 0
    validation_samples: int = 0
    performance_metrics: Dict[str, float] = field(default_factory=dict)
    error_message: Optional[str] = None
    model_version: Optional[str] = None
    data_sources: List[str] = field(default_factory=list)
    hyperparameters: Dict[str, Any] = field(default_factory=dict)

@dataclass
class RetrainingConfig:
    """Configuration for continuous retraining"""
    # Scheduling
    scheduled_interval_hours: int = 168  # Weekly by default
    min_data_samples: int = 1000  # Minimum samples required for retraining
    max_data_age_days: int = 30  # Maximum age of training data
    
    # Performance thresholds
    performance_decay_threshold: float = 0.05  # 5% performance drop triggers retraining
    data_drift_threshold: float = 0.1  # 10% distribution shift triggers retraining
    
    # Resource limits
    max_concurrent_jobs: int = 2
    max_training_time_hours: int = 4
    memory_limit_gb: float = 8.0
    
    # Model versioning
    keep_model_versions: int = 5
    model_rollback_threshold: float = 0.15  # 15% performance drop triggers rollback

class DataDriftDetector:
    """Detects data distribution drift"""
    
    def __init__(self, reference_data: np.ndarray, drift_threshold: float = 0.1):
        self.reference_data = reference_data
        self.drift_threshold = drift_threshold
        self.reference_stats = self._calculate_statistics(reference_data)
    
    def _calculate_statistics(self, data: np.ndarray) -> Dict[str, float]:
        """Calculate statistical properties of the data"""
        return {
            "mean": np.mean(data),
            "std": np.std(data),
            "min": np.min(data),
            "max": np.max(data),
            "percentiles": np.percentile(data, [25, 50, 75]).tolist()
        }
    
    def detect_drift(self, new_data: np.ndarray) -> Tuple[bool, float, Dict[str, float]]:
        """Detect if new data has drifted from reference"""
        new_stats = self._calculate_statistics(new_data)
        
        # Calculate drift score based on statistical differences
        drift_score = 0.0
        drift_details = {}
        
        # Mean drift
        mean_diff = abs(new_stats["mean"] - self.reference_stats["mean"])
        mean_drift = mean_diff / (self.reference_stats["std"] + 1e-8)
        drift_score += mean_drift * 0.3
        drift_details["mean_drift"] = mean_drift
        
        # Standard deviation drift
        std_diff = abs(new_stats["std"] - self.reference_stats["std"])
        std_drift = std_diff / (self.reference_stats["std"] + 1e-8)
        drift_score += std_drift * 0.3
        drift_details["std_drift"] = std_drift
        
        # Distribution shape drift (percentile differences)
        percentile_diffs = np.abs(np.array(new_stats["percentiles"]) - 
                                np.array(self.reference_stats["percentiles"]))
        percentile_drift = np.mean(percentile_diffs) / (self.reference_stats["std"] + 1e-8)
        drift_score += percentile_drift * 0.4
        drift_details["percentile_drift"] = percentile_drift
        
        # Determine if drift is significant
        has_drift = drift_score > self.drift_threshold
        drift_details["total_drift_score"] = drift_score
        
        return has_drift, drift_score, drift_details

class PerformanceMonitor:
    """Monitors model performance over time"""
    
    def __init__(self, performance_history: List[Dict[str, float]] = None):
        self.performance_history = performance_history or []
        self.metrics = ["precision", "recall", "f1_score", "accuracy"]
    
    def add_performance_record(self, timestamp: datetime, metrics: Dict[str, float]):
        """Add a new performance record"""
        record = {
            "timestamp": timestamp,
            "metrics": metrics
        }
        self.performance_history.append(record)
    
    def detect_performance_decay(self, current_metrics: Dict[str, float], 
                               decay_threshold: float = 0.05) -> Tuple[bool, float, Dict[str, float]]:
        """Detect if performance has decayed significantly"""
        if not self.performance_history:
            return False, 0.0, {}
        
        # Get the best historical performance
        best_performance = {}
        for metric in self.metrics:
            if metric in current_metrics:
                best_values = [record["metrics"].get(metric, 0) for record in self.performance_history]
                best_performance[metric] = max(best_values) if best_values else 0
        
        # Calculate performance drops
        performance_drops = {}
        total_drop = 0.0
        
        for metric in self.metrics:
            if metric in current_metrics and metric in best_performance:
                current_val = current_metrics[metric]
                best_val = best_performance[metric]
                
                if best_val > 0:
                    drop = (best_val - current_val) / best_val
                    performance_drops[metric] = drop
                    total_drop += drop
        
        avg_drop = total_drop / len(performance_drops) if performance_drops else 0.0
        has_decay = avg_drop > decay_threshold
        
        return has_decay, avg_drop, performance_drops

class ContinuousRetrainer:
    """Main continuous retraining system"""
    
    def __init__(self, config: RetrainingConfig, model_path: str = "models"):
        self.config = config
        self.model_path = Path(model_path)
        self.model_path.mkdir(exist_ok=True)
        
        # Initialize components
        self.drift_detector = None
        self.performance_monitor = PerformanceMonitor()
        self.retraining_queue = []
        self.active_jobs = {}
        self.job_history = []
        
        # Database for tracking
        self.db_path = self.model_path / "retraining_history.db"
        self._init_database()
        
        # Threading
        self.scheduler_thread = None
        self.running = False
        self.lock = threading.Lock()
    
    def _init_database(self):
        """Initialize the retraining history database"""
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS retraining_jobs (
                    job_id TEXT PRIMARY KEY,
                    trigger_type TEXT,
                    status TEXT,
                    created_at TEXT,
                    started_at TEXT,
                    completed_at TEXT,
                    training_samples INTEGER,
                    validation_samples INTEGER,
                    performance_metrics TEXT,
                    error_message TEXT,
                    model_version TEXT,
                    data_sources TEXT,
                    hyperparameters TEXT
                )
            """)
            
            conn.commit()
            conn.close()
            logger.info("✅ Retraining database initialized")
            
        except Exception as e:
            logger.error(f"❌ Error initializing database: {e}")
    
    def start_scheduler(self):
        """Start the continuous retraining scheduler"""
        if self.running:
            logger.warning("⚠️ Scheduler is already running")
            return
        
        self.running = True
        self.scheduler_thread = threading.Thread(target=self._scheduler_loop, daemon=True)
        self.scheduler_thread.start()
        logger.info("🚀 Continuous retraining scheduler started")
    
    def stop_scheduler(self):
        """Stop the continuous retraining scheduler"""
        self.running = False
        if self.scheduler_thread:
            self.scheduler_thread.join(timeout=5)
        logger.info("🛑 Continuous retraining scheduler stopped")
    
    def _scheduler_loop(self):
        """Main scheduler loop"""
        while self.running:
            try:
                # Check for scheduled retraining
                self._check_scheduled_retraining()
                
                # Check for performance decay
                self._check_performance_decay()
                
                # Process retraining queue
                self._process_retraining_queue()
                
                # Clean up old jobs
                self._cleanup_old_jobs()
                
                # Sleep for a while
                time.sleep(300)  # Check every 5 minutes
                
            except Exception as e:
                logger.error(f"❌ Error in scheduler loop: {e}")
                time.sleep(60)  # Wait a bit before retrying
    
    def _check_scheduled_retraining(self):
        """Check if scheduled retraining is due"""
        try:
            # Get last successful retraining
            last_job = self._get_last_successful_job()
            
            if not last_job:
                # No previous job, schedule initial retraining
                self._schedule_retraining(RetrainingTrigger.SCHEDULED, "Initial scheduled retraining")
                return
            
            # Check if enough time has passed
            time_since_last = datetime.now() - last_job.completed_at
            if time_since_last.total_seconds() > (self.config.scheduled_interval_hours * 3600):
                self._schedule_retraining(RetrainingTrigger.SCHEDULED, "Scheduled retraining due")
                
        except Exception as e:
            logger.error(f"❌ Error checking scheduled retraining: {e}")
    
    def _check_performance_decay(self):
        """Check if performance has decayed significantly"""
        try:
            # This would typically get current performance from production monitoring
            # For now, we'll use a placeholder
            current_performance = self._get_current_performance()
            
            if current_performance:
                has_decay, decay_score, details = self.performance_monitor.detect_performance_decay(
                    current_performance, self.config.performance_decay_threshold
                )
                
                if has_decay:
                    logger.warning(f"⚠️ Performance decay detected: {decay_score:.3f}")
                    self._schedule_retraining(
                        RetrainingTrigger.PERFORMANCE_DECAY,
                        f"Performance decay detected: {decay_score:.3f}"
                    )
                    
        except Exception as e:
            logger.error(f"❌ Error checking performance decay: {e}")
    
    def _get_current_performance(self) -> Optional[Dict[str, float]]:
        """Get current model performance (placeholder implementation)"""
        # In production, this would query actual performance metrics
        # For now, return None to indicate no current data
        return None
    
    def _schedule_retraining(self, trigger: RetrainingTrigger, reason: str):
        """Schedule a new retraining job"""
        try:
            with self.lock:
                # Check if we can start a new job
                if len(self.active_jobs) >= self.config.max_concurrent_jobs:
                    logger.info(f"📋 Queuing retraining job: {reason}")
                    self.retraining_queue.append((trigger, reason))
                    return
                
                # Create and start the job
                job = self._create_retraining_job(trigger, reason)
                self._start_retraining_job(job)
                
        except Exception as e:
            logger.error(f"❌ Error scheduling retraining: {e}")
    
    def _create_retraining_job(self, trigger: RetrainingTrigger, reason: str) -> RetrainingJob:
        """Create a new retraining job"""
        job_id = f"retrain_{datetime.now().strftime('%Y%m%d_%H%M%S')}_{trigger.value}"
        
        job = RetrainingJob(
            job_id=job_id,
            trigger_type=trigger,
            status=RetrainingStatus.PENDING,
            created_at=datetime.now(),
            data_sources=["amazon_api", "feedback_loop"],
            hyperparameters=self._get_default_hyperparameters()
        )
        
        # Store in database
        self._store_job(job)
        
        return job
    
    def _get_default_hyperparameters(self) -> Dict[str, Any]:
        """Get default hyperparameters for retraining"""
        return {
            "learning_rate": 0.001,
            "batch_size": 32,
            "epochs": 100,
            "validation_split": 0.2,
            "early_stopping_patience": 10,
            "model_architecture": "transformer",
            "feature_engineering": "advanced"
        }
    
    def _start_retraining_job(self, job: RetrainingJob):
        """Start a retraining job"""
        try:
            job.status = RetrainingStatus.RUNNING
            job.started_at = datetime.now()
            self._update_job(job)
            
            # Add to active jobs
            self.active_jobs[job.job_id] = job
            
            # Start retraining in a separate thread
            retraining_thread = threading.Thread(
                target=self._execute_retraining,
                args=(job,),
                daemon=True
            )
            retraining_thread.start()
            
            logger.info(f"🚀 Started retraining job: {job.job_id}")
            
        except Exception as e:
            logger.error(f"❌ Error starting retraining job: {e}")
            job.status = RetrainingStatus.FAILED
            job.error_message = str(e)
            self._update_job(job)
    
    def _execute_retraining(self, job: RetrainingJob):
        """Execute the actual retraining process"""
        try:
            logger.info(f"🔄 Executing retraining job: {job.job_id}")
            
            # Simulate retraining process
            # In production, this would:
            # 1. Load training data
            # 2. Preprocess and feature engineer
            # 3. Train the model
            # 4. Evaluate performance
            # 5. Save new model version
            
            # For now, simulate the process
            time.sleep(2)  # Simulate training time
            
            # Generate mock results
            job.training_samples = 5000
            job.validation_samples = 1000
            job.performance_metrics = {
                "precision": 0.87,
                "recall": 0.83,
                "f1_score": 0.85,
                "accuracy": 0.86
            }
            job.model_version = f"v{datetime.now().strftime('%Y%m%d_%H%M%S')}"
            
            # Mark as completed
            job.status = RetrainingStatus.COMPLETED
            job.completed_at = datetime.now()
            
            # Update performance monitor
            self.performance_monitor.add_performance_record(
                job.completed_at, job.performance_metrics
            )
            
            # Save new model
            self._save_model_version(job)
            
            # Update database
            self._update_job(job)
            
            # Remove from active jobs
            with self.lock:
                if job.job_id in self.active_jobs:
                    del self.active_jobs[job.job_id]
            
            # Add to history
            self.job_history.append(job)
            
            logger.info(f"✅ Retraining job completed: {job.job_id}")
            
            # Check if we can process queued jobs
            self._process_retraining_queue()
            
        except Exception as e:
            logger.error(f"❌ Error executing retraining job {job.job_id}: {e}")
            job.status = RetrainingStatus.FAILED
            job.error_message = str(e)
            self._update_job(job)
            self._update_job(job)
            
            # Remove from active jobs
            with self.lock:
                if job.job_id in self.active_jobs:
                    del self.active_jobs[job.job_id]
    
    def _save_model_version(self, job: RetrainingJob):
        """Save the new model version"""
        try:
            model_file = self.model_path / f"claim_detector_{job.model_version}.pkl"
            
            # In production, this would save the actual trained model
            # For now, save job metadata
            model_data = {
                "job_id": job.job_id,
                "version": job.model_version,
                "performance_metrics": job.performance_metrics,
                "training_samples": job.training_samples,
                "created_at": job.completed_at.isoformat(),
                "hyperparameters": job.hyperparameters
            }
            
            with open(model_file, 'wb') as f:
                pickle.dump(model_data, f)
            
            logger.info(f"💾 Model saved: {model_file}")
            
        except Exception as e:
            logger.error(f"❌ Error saving model: {e}")
    
    def _process_retraining_queue(self):
        """Process queued retraining jobs"""
        with self.lock:
            while (self.retraining_queue and 
                   len(self.active_jobs) < self.config.max_concurrent_jobs):
                
                trigger, reason = self.retraining_queue.pop(0)
                job = self._create_retraining_job(trigger, reason)
                self._start_retraining_job(job)
    
    def _cleanup_old_jobs(self):
        """Clean up old completed jobs"""
        try:
            cutoff_date = datetime.now() - timedelta(days=30)
            
            with self.lock:
                self.job_history = [
                    job for job in self.job_history
                    if job.completed_at and job.completed_at > cutoff_date
                ]
            
            # Clean up old model files
            self._cleanup_old_models()
            
        except Exception as e:
            logger.error(f"❌ Error cleaning up old jobs: {e}")
    
    def _cleanup_old_models(self):
        """Clean up old model versions"""
        try:
            model_files = list(self.model_path.glob("claim_detector_*.pkl"))
            
            if len(model_files) > self.config.keep_model_versions:
                # Sort by modification time (oldest first)
                model_files.sort(key=lambda x: x.stat().st_mtime)
                
                # Remove oldest files
                files_to_remove = model_files[:-self.config.keep_model_versions]
                
                for file_path in files_to_remove:
                    file_path.unlink()
                    logger.info(f"🗑️ Removed old model: {file_path}")
                    
        except Exception as e:
            logger.error(f"❌ Error cleaning up old models: {e}")
    
    def _store_job(self, job: RetrainingJob):
        """Store job in database"""
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            
            cursor.execute("""
                INSERT OR REPLACE INTO retraining_jobs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                job.job_id,
                job.trigger_type.value,
                job.status.value,
                job.created_at.isoformat(),
                job.started_at.isoformat() if job.started_at else None,
                job.completed_at.isoformat() if job.completed_at else None,
                job.training_samples,
                job.validation_samples,
                json.dumps(job.performance_metrics),
                job.error_message,
                job.model_version,
                json.dumps(job.data_sources),
                json.dumps(job.hyperparameters)
            ))
            
            conn.commit()
            conn.close()
            
        except Exception as e:
            logger.error(f"❌ Error storing job: {e}")
    
    def _update_job(self, job: RetrainingJob):
        """Update job in database"""
        self._store_job(job)
    
    def _get_last_successful_job(self) -> Optional[RetrainingJob]:
        """Get the last successful retraining job"""
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            
            cursor.execute("""
                SELECT * FROM retraining_jobs 
                WHERE status = ? 
                ORDER BY completed_at DESC 
                LIMIT 1
            """, (RetrainingStatus.COMPLETED.value,))
            
            row = cursor.fetchone()
            conn.close()
            
            if row:
                return self._row_to_job(row)
            
            return None
            
        except Exception as e:
            logger.error(f"❌ Error getting last successful job: {e}")
            return None
    
    def _row_to_job(self, row) -> RetrainingJob:
        """Convert database row to RetrainingJob object"""
        return RetrainingJob(
            job_id=row[0],
            trigger_type=RetrainingTrigger(row[1]),
            status=RetrainingStatus(row[2]),
            created_at=datetime.fromisoformat(row[3]),
            started_at=datetime.fromisoformat(row[4]) if row[4] else None,
            completed_at=datetime.fromisoformat(row[5]) if row[5] else None,
            training_samples=row[6],
            validation_samples=row[7],
            performance_metrics=json.loads(row[8]) if row[8] else {},
            error_message=row[9],
            model_version=row[10],
            data_sources=json.loads(row[11]) if row[11] else [],
            hyperparameters=json.loads(row[12]) if row[12] else {}
        )
    
    def get_retraining_summary(self) -> Dict[str, Any]:
        """Get summary of retraining system status"""
        try:
            with self.lock:
                active_jobs = len(self.active_jobs)
                queued_jobs = len(self.retraining_queue)
                total_jobs = len(self.job_history)
                
                # Get recent performance
                recent_performance = None
                if self.job_history:
                    latest_job = max(self.job_history, key=lambda j: j.completed_at or datetime.min)
                    if latest_job.performance_metrics:
                        recent_performance = latest_job.performance_metrics
                
                return {
                    "status": "running" if self.running else "stopped",
                    "active_jobs": active_jobs,
                    "queued_jobs": queued_jobs,
                    "total_jobs": total_jobs,
                    "recent_performance": recent_performance,
                    "next_scheduled": self._get_next_scheduled_retraining(),
                    "config": {
                        "scheduled_interval_hours": self.config.scheduled_interval_hours,
                        "min_data_samples": self.config.min_data_samples,
                        "performance_decay_threshold": self.config.performance_decay_threshold
                    }
                }
                
        except Exception as e:
            logger.error(f"❌ Error getting retraining summary: {e}")
            return {"status": "error", "error": str(e)}
    
    def _get_next_scheduled_retraining(self) -> Optional[datetime]:
        """Get the next scheduled retraining time"""
        try:
            last_job = self._get_last_successful_job()
            if last_job and last_job.completed_at:
                return last_job.completed_at + timedelta(hours=self.config.scheduled_interval_hours)
            return None
        except Exception as e:
            logger.error(f"❌ Error getting next scheduled retraining: {e}")
            return None
    
    def manual_retraining_trigger(self, reason: str = "Manual trigger"):
        """Manually trigger retraining"""
        logger.info(f"🔧 Manual retraining triggered: {reason}")
        self._schedule_retraining(RetrainingTrigger.MANUAL, reason)
    
    def get_job_history(self, limit: int = 10) -> List[RetrainingJob]:
        """Get recent job history"""
        try:
            with self.lock:
                sorted_jobs = sorted(
                    self.job_history,
                    key=lambda j: j.created_at,
                    reverse=True
                )
                return sorted_jobs[:limit]
        except Exception as e:
            logger.error(f"❌ Error getting job history: {e}")
            return []


