#!/usr/bin/env python3
"""
Enhanced Rejection Logger for Claim Detector v2.0
Integrates with normalization engine and tracks processing status for continuous learning
"""

import json
import logging
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass, asdict
import uuid
from pathlib import Path
import sqlite3
import pandas as pd
from collections import defaultdict, deque

# Add parent directory to path for imports
import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(__file__))))

from .live_rejection_collector import RejectionLog
from .rejection_normalizer import RejectionNormalizer, NormalizedRejection

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')
logger = logging.getLogger(__name__)

@dataclass
class ProcessedRejection:
    """Processed rejection with normalization and status"""
    rejection_id: str
    original_rejection: RejectionLog
    normalized_rejection: NormalizedRejection
    processing_status: str  # 'unprocessed', 'processing', 'processed', 'failed'
    processing_timestamp: datetime
    processing_notes: Optional[str] = None
    feedback_tag: Optional[str] = None  # 'fixable', 'unclaimable', 'requires_review'
    priority_score: float = 0.0
    retry_count: int = 0
    last_retry: Optional[datetime] = None

@dataclass
class ProcessingQueue:
    """Processing queue for rejections"""
    high_priority: deque
    normal_priority: deque
    low_priority: deque
    failed_items: deque
    max_retries: int = 3

class EnhancedRejectionLogger:
    """Enhanced rejection logger with processing status tracking"""
    
    def __init__(self, db_path: str = "rejections.db", patterns_file: Optional[str] = None):
        self.db_path = db_path
        self.normalizer = RejectionNormalizer(patterns_file)
        self.processing_queue = ProcessingQueue(
            high_priority=deque(),
            normal_priority=deque(),
            low_priority=deque(),
            failed_items=deque()
        )
        
        # Processing statistics
        self.processing_stats = {
            "total_rejections": 0,
            "processed": 0,
            "unprocessed": 0,
            "processing": 0,
            "failed": 0,
            "fixable_count": 0,
            "unclaimable_count": 0,
            "requires_review_count": 0
        }
        
        # Initialize database
        self._init_database()
        
        # Processing configuration
        self.processing_config = {
            "auto_normalize": True,
            "auto_tag": True,
            "priority_thresholds": {
                "high": 0.8,
                "normal": 0.4,
                "low": 0.0
            },
            "batch_size": 50,
            "max_processing_time": 300  # 5 minutes
        }
    
    def _init_database(self):
        """Initialize database with required tables"""
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            
            # Create rejections table
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS rejections (
                    rejection_id TEXT PRIMARY KEY,
                    sku TEXT,
                    asin TEXT,
                    claim_type TEXT,
                    rejection_reason TEXT,
                    rejection_date TEXT,
                    amount_requested REAL,
                    quantity_affected INTEGER,
                    seller_id TEXT,
                    marketplace_id TEXT,
                    raw_amazon_data TEXT,
                    processing_status TEXT DEFAULT 'unprocessed',
                    normalized_category TEXT,
                    normalized_confidence REAL,
                    required_evidence TEXT,
                    is_fixable BOOLEAN,
                    feedback_tag TEXT,
                    priority_score REAL,
                    processing_timestamp TEXT,
                    processing_notes TEXT,
                    retry_count INTEGER DEFAULT 0,
                    last_retry TEXT,
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP
                )
            ''')
            
            # Create processing_log table
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS processing_log (
                    log_id TEXT PRIMARY KEY,
                    rejection_id TEXT,
                    action TEXT,
                    status TEXT,
                    timestamp TEXT,
                    notes TEXT,
                    FOREIGN KEY (rejection_id) REFERENCES rejections (rejection_id)
                )
            ''')
            
            # Create patterns table for custom patterns
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS custom_patterns (
                    pattern_id TEXT PRIMARY KEY,
                    pattern TEXT,
                    category TEXT,
                    subcategory TEXT,
                    confidence REAL,
                    required_evidence TEXT,
                    is_fixable BOOLEAN,
                    policy_reference TEXT,
                    time_constraint TEXT,
                    amount_constraint TEXT,
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP
                )
            ''')
            
            conn.commit()
            conn.close()
            logger.info("✅ Database initialized successfully")
            
        except Exception as e:
            logger.error(f"❌ Error initializing database: {e}")
    
    def log_rejection(self, rejection: RejectionLog) -> str:
        """Log a new rejection and add to processing queue"""
        try:
            # Generate unique ID if not provided
            if not rejection.rejection_id:
                rejection.rejection_id = f"rej_{uuid.uuid4().hex[:8]}"
            
            # Normalize rejection reason if auto-normalize is enabled
            normalized_rejection = None
            if self.processing_config["auto_normalize"]:
                normalized_rejection = self.normalizer.normalize_rejection(rejection.rejection_reason)
            
            # Create processed rejection
            processed_rejection = ProcessedRejection(
                rejection_id=rejection.rejection_id,
                original_rejection=rejection,
                normalized_rejection=normalized_rejection,
                processing_status="unprocessed",
                processing_timestamp=datetime.now(),
                priority_score=self._calculate_priority_score(rejection, normalized_rejection)
            )
            
            # Auto-tag if enabled
            if self.processing_config["auto_tag"] and normalized_rejection:
                processed_rejection.feedback_tag = self._auto_tag_rejection(normalized_rejection)
            
            # Save to database
            self._save_rejection_to_db(processed_rejection)
            
            # Add to processing queue
            self._add_to_processing_queue(processed_rejection)
            
            # Update statistics
            self.processing_stats["total_rejections"] += 1
            self.processing_stats["unprocessed"] += 1
            
            logger.info(f"✅ Rejection logged: {rejection.rejection_id}")
            return rejection.rejection_id
            
        except Exception as e:
            logger.error(f"❌ Error logging rejection: {e}")
            raise
    
    def _calculate_priority_score(self, rejection: RejectionLog, normalized_rejection: Optional[NormalizedRejection]) -> float:
        """Calculate priority score for rejection processing"""
        score = 0.0
        
        # Base score from amount (higher amount = higher priority)
        if rejection.amount_requested > 0:
            score += min(rejection.amount_requested / 1000.0, 0.3)  # Cap at 30%
        
        # Score from quantity affected
        if rejection.quantity_affected > 0:
            score += min(rejection.quantity_affected / 100.0, 0.2)  # Cap at 20%
        
        # Score from normalization confidence
        if normalized_rejection:
            score += normalized_rejection.confidence * 0.3  # Up to 30%
        
        # Score from claim type (some types are more urgent)
        claim_type_priority = {
            "lost": 0.1,
            "damaged": 0.15,
            "fee_error": 0.05,
            "missing_reimbursement": 0.1
        }
        score += claim_type_priority.get(rejection.claim_type, 0.05)
        
        # Score from time sensitivity (recent rejections get higher priority)
        if rejection.rejection_date:
            days_old = (datetime.now() - rejection.rejection_date).days
            if days_old <= 1:
                score += 0.1
            elif days_old <= 7:
                score += 0.05
        
        return min(score, 1.0)  # Cap at 100%
    
    def _auto_tag_rejection(self, normalized_rejection: NormalizedRejection) -> str:
        """Automatically tag rejection based on normalization"""
        if normalized_rejection.is_fixable:
            return "fixable"
        else:
            return "unclaimable"
    
    def _add_to_processing_queue(self, processed_rejection: ProcessedRejection):
        """Add rejection to appropriate processing queue based on priority"""
        priority_score = processed_rejection.priority_score
        
        if priority_score >= self.processing_config["priority_thresholds"]["high"]:
            self.processing_queue.high_priority.append(processed_rejection)
        elif priority_score >= self.processing_config["priority_thresholds"]["normal"]:
            self.processing_queue.normal_priority.append(processed_rejection)
        else:
            self.processing_queue.low_priority.append(processed_rejection)
    
    def _save_rejection_to_db(self, processed_rejection: ProcessedRejection):
        """Save processed rejection to database"""
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            
            rejection = processed_rejection.original_rejection
            normalized = processed_rejection.normalized_rejection
            
            cursor.execute('''
                INSERT OR REPLACE INTO rejections (
                    rejection_id, sku, asin, claim_type, rejection_reason,
                    rejection_date, amount_requested, quantity_affected,
                    seller_id, marketplace_id, raw_amazon_data,
                    processing_status, normalized_category, normalized_confidence,
                    required_evidence, is_fixable, feedback_tag, priority_score,
                    processing_timestamp, processing_notes, retry_count, last_retry
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                processed_rejection.rejection_id,
                rejection.sku,
                rejection.asin,
                rejection.claim_type,
                rejection.rejection_reason,
                rejection.rejection_date.isoformat(),
                rejection.amount_requested,
                rejection.quantity_affected,
                rejection.seller_id,
                rejection.marketplace_id,
                json.dumps(rejection.raw_amazon_data),
                processed_rejection.processing_status,
                normalized.category if normalized else None,
                normalized.confidence if normalized else None,
                json.dumps(normalized.required_evidence) if normalized else None,
                normalized.is_fixable if normalized else None,
                processed_rejection.feedback_tag,
                processed_rejection.priority_score,
                processed_rejection.processing_timestamp.isoformat(),
                processed_rejection.processing_notes,
                processed_rejection.retry_count,
                processed_rejection.last_retry.isoformat() if processed_rejection.last_retry else None
            ))
            
            conn.commit()
            conn.close()
            
        except Exception as e:
            logger.error(f"❌ Error saving rejection to database: {e}")
    
    def get_processing_status(self) -> Dict[str, Any]:
        """Get current processing status and queue information"""
        return {
            "queue_sizes": {
                "high_priority": len(self.processing_queue.high_priority),
                "normal_priority": len(self.processing_queue.normal_priority),
                "low_priority": len(self.processing_queue.low_priority),
                "failed_items": len(self.processing_queue.failed_items)
            },
            "processing_stats": self.processing_stats.copy(),
            "total_queue_size": (
                len(self.processing_queue.high_priority) +
                len(self.processing_queue.normal_priority) +
                len(self.processing_queue.low_priority)
            )
        }
    
    def get_next_batch(self, batch_size: Optional[int] = None) -> List[ProcessedRejection]:
        """Get next batch of rejections for processing"""
        batch_size = batch_size or self.processing_config["batch_size"]
        batch = []
        
        # Prioritize high priority items
        while len(batch) < batch_size and self.processing_queue.high_priority:
            item = self.processing_queue.high_priority.popleft()
            item.processing_status = "processing"
            batch.append(item)
        
        # Add normal priority items
        while len(batch) < batch_size and self.processing_queue.normal_priority:
            item = self.processing_queue.normal_priority.popleft()
            item.processing_status = "processing"
            batch.append(item)
        
        # Add low priority items if needed
        while len(batch) < batch_size and self.processing_queue.low_priority:
            item = self.processing_queue.low_priority.popleft()
            item.processing_status = "processing"
            batch.append(item)
        
        # Update statistics
        self.processing_stats["processing"] += len(batch)
        self.processing_stats["unprocessed"] -= len(batch)
        
        return batch
    
    def mark_rejection_processed(self, rejection_id: str, results: Dict[str, Any]):
        """Mark rejection as processed with results"""
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            
            # Update rejection status
            cursor.execute('''
                UPDATE rejections 
                SET processing_status = ?, processing_notes = ?
                WHERE rejection_id = ?
            ''', (
                "processed",
                json.dumps(results),
                rejection_id
            ))
            
            # Log processing action
            log_id = f"log_{uuid.uuid4().hex[:8]}"
            cursor.execute('''
                INSERT INTO processing_log (log_id, rejection_id, action, status, timestamp, notes)
                VALUES (?, ?, ?, ?, ?, ?)
            ''', (
                log_id,
                rejection_id,
                "process",
                "completed",
                datetime.now().isoformat(),
                json.dumps(results)
            ))
            
            conn.commit()
            conn.close()
            
            # Update statistics
            self.processing_stats["processed"] += 1
            self.processing_stats["processing"] -= 1
            
            # Update feedback counts
            if results.get("feedback_tag"):
                tag = results["feedback_tag"]
                if tag == "fixable":
                    self.processing_stats["fixable_count"] += 1
                elif tag == "unclaimable":
                    self.processing_stats["unclaimable_count"] += 1
                elif tag == "requires_review":
                    self.processing_stats["requires_review_count"] += 1
            
            logger.info(f"✅ Rejection {rejection_id} marked as processed")
            
        except Exception as e:
            logger.error(f"❌ Error marking rejection as processed: {e}")
    
    def mark_rejection_failed(self, rejection_id: str, error_message: str):
        """Mark rejection as failed with error message"""
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            
            # Update rejection status
            cursor.execute('''
                UPDATE rejections 
                SET processing_status = ?, processing_notes = ?
                WHERE rejection_id = ?
            ''', (
                "failed",
                json.dumps({"error": error_message, "timestamp": datetime.now().isoformat()})
            ))
            
            # Log processing action
            log_id = f"log_{uuid.uuid4().hex[:8]}"
            cursor.execute('''
                INSERT INTO processing_log (log_id, rejection_id, action, status, timestamp, notes)
                VALUES (?, ?, ?, ?, ?, ?)
            ''', (
                log_id,
                rejection_id,
                "process",
                "failed",
                datetime.now().isoformat(),
                json.dumps({"error": error_message})
            ))
            
            conn.commit()
            conn.close()
            
            # Update statistics
            self.processing_stats["failed"] += 1
            self.processing_stats["processing"] -= 1
            
            logger.warning(f"⚠️ Rejection {rejection_id} marked as failed: {error_message}")
            
        except Exception as e:
            logger.error(f"❌ Error marking rejection as failed: {e}")
    
    def retry_failed_rejection(self, rejection_id: str) -> bool:
        """Retry processing a failed rejection"""
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            
            # Get rejection details
            cursor.execute('''
                SELECT * FROM rejections WHERE rejection_id = ?
            ''', (rejection_id,))
            
            row = cursor.fetchone()
            if not row:
                logger.warning(f"⚠️ Rejection {rejection_id} not found for retry")
                return False
            
            # Check retry count
            retry_count = row[21] or 0
            if retry_count >= self.processing_queue.max_retries:
                logger.warning(f"⚠️ Rejection {rejection_id} exceeded max retries")
                return False
            
            # Update retry count and status
            cursor.execute('''
                UPDATE rejections 
                SET processing_status = ?, retry_count = ?, last_retry = ?
                WHERE rejection_id = ?
            ''', (
                "unprocessed",
                retry_count + 1,
                datetime.now().isoformat(),
                rejection_id
            ))
            
            conn.commit()
            conn.close()
            
            # Re-add to processing queue
            # Note: This would require reconstructing the ProcessedRejection object
            # For now, just update the database status
            
            logger.info(f"✅ Rejection {rejection_id} queued for retry")
            return True
            
        except Exception as e:
            logger.error(f"❌ Error retrying failed rejection: {e}")
            return False
    
    def get_rejection_summary(self) -> Dict[str, Any]:
        """Get comprehensive rejection summary"""
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            
            # Get counts by status
            cursor.execute('''
                SELECT processing_status, COUNT(*) FROM rejections GROUP BY processing_status
            ''')
            status_counts = dict(cursor.fetchall())
            
            # Get counts by feedback tag
            cursor.execute('''
                SELECT feedback_tag, COUNT(*) FROM rejections 
                WHERE feedback_tag IS NOT NULL 
                GROUP BY feedback_tag
            ''')
            tag_counts = dict(cursor.fetchall())
            
            # Get counts by normalized category
            cursor.execute('''
                SELECT normalized_category, COUNT(*) FROM rejections 
                WHERE normalized_category IS NOT NULL 
                GROUP BY normalized_category
            ''')
            category_counts = dict(cursor.fetchall())
            
            conn.close()
            
            return {
                "status_counts": status_counts,
                "tag_counts": tag_counts,
                "category_counts": category_counts,
                "processing_stats": self.processing_stats.copy(),
                "queue_status": self.get_processing_status()
            }
            
        except Exception as e:
            logger.error(f"❌ Error getting rejection summary: {e}")
            return {}
    
    def export_rejections(self, filepath: str, status_filter: Optional[str] = None):
        """Export rejections to CSV file"""
        try:
            conn = sqlite3.connect(self.db_path)
            
            query = "SELECT * FROM rejections"
            if status_filter:
                query += f" WHERE processing_status = '{status_filter}'"
            
            df = pd.read_sql_query(query, conn)
            conn.close()
            
            df.to_csv(filepath, index=False)
            logger.info(f"✅ Rejections exported to {filepath}")
            
        except Exception as e:
            logger.error(f"❌ Error exporting rejections: {e}")
    
    def cleanup_old_rejections(self, days_old: int = 90):
        """Clean up old processed rejections"""
        try:
            cutoff_date = datetime.now() - timedelta(days=days_old)
            
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            
            # Delete old processed rejections
            cursor.execute('''
                DELETE FROM rejections 
                WHERE processing_status = 'processed' 
                AND processing_timestamp < ?
            ''', (cutoff_date.isoformat(),))
            
            deleted_count = cursor.rowcount
            conn.commit()
            conn.close()
            
            logger.info(f"✅ Cleaned up {deleted_count} old rejections")
            
        except Exception as e:
            logger.error(f"❌ Error cleaning up old rejections: {e}")
