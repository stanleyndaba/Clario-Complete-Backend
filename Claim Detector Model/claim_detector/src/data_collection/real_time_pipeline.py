#!/usr/bin/env python3
"""
Real-Time Data Ingestion Pipeline for Claim Detector v2.0
Orchestrates collection, normalization, and logging of Amazon rejections
"""

import asyncio
import logging
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass, asdict
import json
import time
from pathlib import Path
import signal
import sys

# Add parent directory to path for imports
import os
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(__file__))))

from .live_rejection_collector import LiveRejectionCollector, RejectionCollectionConfig
from .enhanced_rejection_logger import EnhancedRejectionLogger
from .data_collector import AmazonAPIConfig

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')
logger = logging.getLogger(__name__)

@dataclass
class PipelineConfig:
    """Configuration for the real-time ingestion pipeline"""
    collection_interval_minutes: int = 15
    max_hours_back: int = 24
    batch_size: int = 100
    enable_real_time: bool = True
    enable_batch_collection: bool = True
    max_workers: int = 4
    health_check_interval: int = 60  # seconds
    error_retry_delay: int = 30  # seconds
    max_retries: int = 3
    enable_metrics: bool = True
    metrics_export_interval: int = 300  # 5 minutes

@dataclass
class PipelineMetrics:
    """Metrics for pipeline performance monitoring"""
    total_rejections_collected: int = 0
    total_rejections_processed: int = 0
    total_rejections_failed: int = 0
    collection_cycles: int = 0
    processing_cycles: int = 0
    last_collection_time: Optional[datetime] = None
    last_processing_time: Optional[datetime] = None
    average_collection_time: float = 0.0
    average_processing_time: float = 0.0
    error_count: int = 0
    last_error_time: Optional[datetime] = None
    uptime_seconds: int = 0
    start_time: Optional[datetime] = None

class RealTimeIngestionPipeline:
    """Real-time data ingestion pipeline for Amazon rejections"""
    
    def __init__(self, 
                 amazon_config: AmazonAPIConfig,
                 pipeline_config: PipelineConfig,
                 logger_db_path: str = "rejections.db"):
        
        self.amazon_config = amazon_config
        self.pipeline_config = pipeline_config
        self.logger_db_path = logger_db_path
        
        # Initialize components
        self.collection_config = RejectionCollectionConfig(
            collection_interval_minutes=pipeline_config.collection_interval_minutes,
            max_hours_back=pipeline_config.max_hours_back,
            batch_size=pipeline_config.batch_size,
            enable_real_time=pipeline_config.enable_real_time,
            enable_batch_collection=pipeline_config.enable_batch_collection
        )
        
        self.rejection_collector = LiveRejectionCollector(amazon_config, self.collection_config)
        self.rejection_logger = EnhancedRejectionLogger(logger_db_path)
        
        # Pipeline state
        self.is_running = False
        self.shutdown_requested = False
        self.collection_task = None
        self.processing_task = None
        self.health_check_task = None
        self.metrics_task = None
        
        # Metrics
        self.metrics = PipelineMetrics()
        self.metrics.start_time = datetime.now()
        
        # Performance tracking
        self.collection_times = []
        self.processing_times = []
        
        # Error tracking
        self.error_history = []
        
        # Setup signal handlers
        self._setup_signal_handlers()
        
        logger.info("✅ Real-time ingestion pipeline initialized")
    
    def _setup_signal_handlers(self):
        """Setup signal handlers for graceful shutdown"""
        def signal_handler(signum, frame):
            logger.info(f"🛑 Received signal {signum}, initiating graceful shutdown")
            self.shutdown_requested = True
            self.stop()
        
        signal.signal(signal.SIGINT, signal_handler)
        signal.signal(signal.SIGTERM, signal_handler)
    
    async def start(self):
        """Start the real-time ingestion pipeline"""
        if self.is_running:
            logger.warning("⚠️ Pipeline is already running")
            return
        
        logger.info("🚀 Starting real-time ingestion pipeline")
        self.is_running = True
        self.shutdown_requested = False
        
        try:
            # Test Amazon API connection
            connection_ok = await self.rejection_collector.test_connection()
            if not connection_ok:
                raise Exception("Failed to connect to Amazon API")
            
            # Start all pipeline tasks
            tasks = []
            
            if self.pipeline_config.enable_real_time:
                self.collection_task = asyncio.create_task(self._collection_worker())
                tasks.append(self.collection_task)
                logger.info("✅ Collection worker started")
            
            self.processing_task = asyncio.create_task(self._processing_worker())
            tasks.append(self.processing_task)
            logger.info("✅ Processing worker started")
            
            self.health_check_task = asyncio.create_task(self._health_check_worker())
            tasks.append(self.health_check_task)
            logger.info("✅ Health check worker started")
            
            if self.pipeline_config.enable_metrics:
                self.metrics_task = asyncio.create_task(self._metrics_worker())
                tasks.append(self.metrics_task)
                logger.info("✅ Metrics worker started")
            
            # Wait for all tasks to complete or shutdown
            await asyncio.gather(*tasks, return_exceptions=True)
            
        except Exception as e:
            logger.error(f"❌ Error starting pipeline: {e}")
            await self.stop()
            raise
    
    async def stop(self):
        """Stop the pipeline gracefully"""
        if not self.is_running:
            return
        
        logger.info("🛑 Stopping real-time ingestion pipeline")
        self.is_running = False
        
        # Cancel all tasks
        tasks_to_cancel = []
        if self.collection_task:
            tasks_to_cancel.append(self.collection_task)
        if self.processing_task:
            tasks_to_cancel.append(self.processing_task)
        if self.health_check_task:
            tasks_to_cancel.append(self.health_check_task)
        if self.metrics_task:
            tasks_to_cancel.append(self.metrics_task)
        
        for task in tasks_to_cancel:
            if not task.done():
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass
        
        # Calculate final metrics
        if self.metrics.start_time:
            self.metrics.uptime_seconds = int((datetime.now() - self.metrics.start_time).total_seconds())
        
        logger.info("✅ Pipeline stopped gracefully")
    
    async def _collection_worker(self):
        """Worker for collecting rejections from Amazon APIs"""
        logger.info("📡 Collection worker started")
        
        while self.is_running and not self.shutdown_requested:
            try:
                start_time = time.time()
                
                # Collect rejections
                rejections = await self.rejection_collector.collect_rejections()
                
                # Log rejections
                for rejection in rejections:
                    try:
                        rejection_id = self.rejection_logger.log_rejection(rejection)
                        self.metrics.total_rejections_collected += 1
                    except Exception as e:
                        logger.error(f"❌ Error logging rejection {rejection.rejection_id}: {e}")
                        self.metrics.total_rejections_failed += 1
                
                # Update metrics
                collection_time = time.time() - start_time
                self.collection_times.append(collection_time)
                self.metrics.average_collection_time = sum(self.collection_times) / len(self.collection_times)
                self.metrics.collection_cycles += 1
                self.metrics.last_collection_time = datetime.now()
                
                logger.info(f"✅ Collection cycle completed: {len(rejections)} rejections in {collection_time:.2f}s")
                
                # Wait for next collection cycle
                await asyncio.sleep(self.pipeline_config.collection_interval_minutes * 60)
                
            except asyncio.CancelledError:
                logger.info("📡 Collection worker cancelled")
                break
            except Exception as e:
                logger.error(f"❌ Error in collection worker: {e}")
                self.metrics.error_count += 1
                self.metrics.last_error_time = datetime.now()
                self.error_history.append({
                    "timestamp": datetime.now().isoformat(),
                    "error": str(e),
                    "component": "collection_worker"
                })
                
                # Wait before retry
                await asyncio.sleep(self.pipeline_config.error_retry_delay)
    
    async def _processing_worker(self):
        """Worker for processing logged rejections"""
        logger.info("⚙️ Processing worker started")
        
        while self.is_running and not self.shutdown_requested:
            try:
                start_time = time.time()
                
                # Get next batch of rejections to process
                batch = self.rejection_logger.get_next_batch(self.pipeline_config.batch_size)
                
                if batch:
                    # Process each rejection
                    for processed_rejection in batch:
                        try:
                            # Simulate processing (in real implementation, this would do actual work)
                            await self._process_rejection(processed_rejection)
                            
                            # Mark as processed
                            results = {
                                "feedback_tag": processed_rejection.feedback_tag,
                                "normalized_category": processed_rejection.normalized_rejection.category if processed_rejection.normalized_rejection else None,
                                "processing_time": datetime.now().isoformat()
                            }
                            
                            self.rejection_logger.mark_rejection_processed(
                                processed_rejection.rejection_id, results
                            )
                            
                            self.metrics.total_rejections_processed += 1
                            
                        except Exception as e:
                            logger.error(f"❌ Error processing rejection {processed_rejection.rejection_id}: {e}")
                            self.rejection_logger.mark_rejection_failed(
                                processed_rejection.rejection_id, str(e)
                            )
                            self.metrics.total_rejections_failed += 1
                    
                    # Update metrics
                    processing_time = time.time() - start_time
                    self.processing_times.append(processing_time)
                    self.metrics.average_processing_time = sum(self.processing_times) / len(self.processing_times)
                    self.metrics.processing_cycles += 1
                    self.metrics.last_processing_time = datetime.now()
                    
                    logger.info(f"✅ Processing cycle completed: {len(batch)} rejections in {processing_time:.2f}s")
                
                # Wait before next processing cycle
                await asyncio.sleep(5)  # Process every 5 seconds
                
            except asyncio.CancelledError:
                logger.info("⚙️ Processing worker cancelled")
                break
            except Exception as e:
                logger.error(f"❌ Error in processing worker: {e}")
                self.metrics.error_count += 1
                self.metrics.last_error_time = datetime.now()
                self.error_history.append({
                    "timestamp": datetime.now().isoformat(),
                    "error": str(e),
                    "component": "processing_worker"
                })
                
                # Wait before retry
                await asyncio.sleep(self.pipeline_config.error_retry_delay)
    
    async def _process_rejection(self, processed_rejection):
        """Process a single rejection (placeholder for actual processing logic)"""
        # This is a placeholder - in real implementation, this would:
        # 1. Apply business rules
        # 2. Update models
        # 3. Generate recommendations
        # 4. Send notifications
        # 5. etc.
        
        # Simulate processing time
        await asyncio.sleep(0.1)
        
        # For now, just log the processing
        logger.debug(f"Processing rejection: {processed_rejection.rejection_id}")
    
    async def _health_check_worker(self):
        """Worker for monitoring pipeline health"""
        logger.info("🏥 Health check worker started")
        
        while self.is_running and not self.shutdown_requested:
            try:
                # Check pipeline health
                health_status = await self._check_pipeline_health()
                
                if health_status["status"] != "healthy":
                    logger.warning(f"⚠️ Pipeline health issue: {health_status['issues']}")
                    
                    # Take corrective action if needed
                    if health_status["status"] == "critical":
                        logger.error("🚨 Critical health issue detected, initiating recovery")
                        await self._initiate_recovery()
                
                # Wait for next health check
                await asyncio.sleep(self.pipeline_config.health_check_interval)
                
            except asyncio.CancelledError:
                logger.info("🏥 Health check worker cancelled")
                break
            except Exception as e:
                logger.error(f"❌ Error in health check worker: {e}")
                await asyncio.sleep(self.pipeline_config.error_retry_delay)
    
    async def _check_pipeline_health(self) -> Dict[str, Any]:
        """Check overall pipeline health"""
        health_status = {
            "status": "healthy",
            "timestamp": datetime.now().isoformat(),
            "issues": [],
            "metrics": {}
        }
        
        try:
            # Check collection health
            collection_stats = self.rejection_collector.get_collection_stats()
            if collection_stats["collection_errors"] > 5:
                health_status["issues"].append("High collection error rate")
                health_status["status"] = "warning"
            
            # Check processing health
            processing_status = self.rejection_logger.get_processing_status()
            if processing_status["queue_sizes"]["failed_items"] > 10:
                health_status["issues"].append("High failed items count")
                health_status["status"] = "warning"
            
            # Check error rate
            if self.metrics.error_count > 10:
                health_status["issues"].append("High error count")
                health_status["status"] = "critical"
            
            # Check uptime
            if self.metrics.start_time:
                uptime_hours = (datetime.now() - self.metrics.start_time).total_seconds() / 3600
                if uptime_hours < 1:
                    health_status["issues"].append("Pipeline recently started")
            
            # Add metrics to health status
            health_status["metrics"] = {
                "uptime_hours": uptime_hours if self.metrics.start_time else 0,
                "total_rejections": self.metrics.total_rejections_collected,
                "error_rate": self.metrics.error_count / max(self.metrics.collection_cycles, 1),
                "collection_cycles": self.metrics.collection_cycles,
                "processing_cycles": self.metrics.processing_cycles
            }
            
        except Exception as e:
            health_status["status"] = "critical"
            health_status["issues"].append(f"Health check error: {e}")
        
        return health_status
    
    async def _initiate_recovery(self):
        """Initiate pipeline recovery procedures"""
        logger.info("🔄 Initiating pipeline recovery")
        
        try:
            # Test Amazon API connection
            connection_ok = await self.rejection_collector.test_connection()
            if not connection_ok:
                logger.error("❌ Amazon API connection failed during recovery")
                return
            
            # Reset error counters
            self.metrics.error_count = 0
            self.metrics.last_error_time = None
            
            # Clear error history
            self.error_history = []
            
            logger.info("✅ Pipeline recovery completed")
            
        except Exception as e:
            logger.error(f"❌ Error during pipeline recovery: {e}")
    
    async def _metrics_worker(self):
        """Worker for exporting metrics and performance data"""
        logger.info("📊 Metrics worker started")
        
        while self.is_running and not self.shutdown_requested:
            try:
                # Export current metrics
                await self._export_metrics()
                
                # Wait for next metrics export
                await asyncio.sleep(self.pipeline_config.metrics_export_interval)
                
            except asyncio.CancelledError:
                logger.info("📊 Metrics worker cancelled")
                break
            except Exception as e:
                logger.error(f"❌ Error in metrics worker: {e}")
                await asyncio.sleep(self.pipeline_config.error_retry_delay)
    
    async def _export_metrics(self):
        """Export current pipeline metrics"""
        try:
            # Get current metrics
            current_metrics = {
                "pipeline_metrics": asdict(self.metrics),
                "collection_stats": self.rejection_collector.get_collection_stats(),
                "processing_status": self.rejection_logger.get_processing_status(),
                "health_status": await self._check_pipeline_health(),
                "error_history": self.error_history[-10:],  # Last 10 errors
                "export_timestamp": datetime.now().isoformat()
            }
            
            # Save metrics to file
            metrics_file = f"pipeline_metrics_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
            with open(metrics_file, 'w') as f:
                json.dump(current_metrics, f, indent=2, default=str)
            
            logger.info(f"✅ Metrics exported to {metrics_file}")
            
        except Exception as e:
            logger.error(f"❌ Error exporting metrics: {e}")
    
    def get_pipeline_status(self) -> Dict[str, Any]:
        """Get current pipeline status"""
        return {
            "is_running": self.is_running,
            "shutdown_requested": self.shutdown_requested,
            "metrics": asdict(self.metrics),
            "config": asdict(self.pipeline_config),
            "collection_stats": self.rejection_collector.get_collection_stats(),
            "processing_status": self.rejection_logger.get_processing_status()
        }
    
    async def run_single_collection(self) -> List[str]:
        """Run a single collection cycle (for testing/debugging)"""
        logger.info("🔄 Running single collection cycle")
        
        try:
            rejections = await self.rejection_collector.collect_rejections()
            
            rejection_ids = []
            for rejection in rejections:
                try:
                    rejection_id = self.rejection_logger.log_rejection(rejection)
                    rejection_ids.append(rejection_id)
                except Exception as e:
                    logger.error(f"❌ Error logging rejection: {e}")
            
            logger.info(f"✅ Single collection completed: {len(rejection_ids)} rejections logged")
            return rejection_ids
            
        except Exception as e:
            logger.error(f"❌ Error in single collection: {e}")
            return []
    
    async def run_single_processing(self, batch_size: Optional[int] = None) -> int:
        """Run a single processing cycle (for testing/debugging)"""
        logger.info("⚙️ Running single processing cycle")
        
        try:
            batch = self.rejection_logger.get_next_batch(batch_size or self.pipeline_config.batch_size)
            
            processed_count = 0
            for processed_rejection in batch:
                try:
                    await self._process_rejection(processed_rejection)
                    
                    results = {
                        "feedback_tag": processed_rejection.feedback_tag,
                        "normalized_category": processed_rejection.normalized_rejection.category if processed_rejection.normalized_rejection else None,
                        "processing_time": datetime.now().isoformat()
                    }
                    
                    self.rejection_logger.mark_rejection_processed(
                        processed_rejection.rejection_id, results
                    )
                    
                    processed_count += 1
                    
                except Exception as e:
                    logger.error(f"❌ Error processing rejection: {e}")
                    self.rejection_logger.mark_rejection_failed(
                        processed_rejection.rejection_id, str(e)
                    )
            
            logger.info(f"✅ Single processing completed: {processed_count} rejections processed")
            return processed_count
            
        except Exception as e:
            logger.error(f"❌ Error in single processing: {e}")
            return 0
