"""
Data Retention Service
Phase 6: Automatic data retention and cleanup policies with GDPR/CCPA compliance
"""

import asyncio
import json
from typing import Dict, Any, List, Optional
from datetime import datetime, timedelta
import logging

from src.common.db_postgresql import DatabaseManager
from src.security.audit_service import audit_service, AuditAction, AuditSeverity

logger = logging.getLogger(__name__)

class DataRetentionService:
    """Service for managing data retention and cleanup policies"""
    
    def __init__(self):
        self.db = DatabaseManager()
        self.cleanup_running = False
        
    async def run_cleanup_job(self) -> Dict[str, Any]:
        """Run the data cleanup job"""
        if self.cleanup_running:
            logger.warning("Cleanup job already running")
            return {"status": "already_running"}
        
        self.cleanup_running = True
        start_time = datetime.utcnow()
        
        try:
            logger.info("Starting data retention cleanup job")
            
            # Get all active retention policies
            policies = await self._get_retention_policies()
            
            cleanup_results = {
                "started_at": start_time.isoformat() + "Z",
                "policies_processed": 0,
                "records_deleted": 0,
                "errors": [],
                "tables_cleaned": []
            }
            
            for policy in policies:
                try:
                    result = await self._cleanup_table(policy)
                    cleanup_results["policies_processed"] += 1
                    cleanup_results["records_deleted"] += result["deleted_count"]
                    cleanup_results["tables_cleaned"].append({
                        "table": policy["table_name"],
                        "deleted_count": result["deleted_count"],
                        "retention_days": policy["retention_days"]
                    })
                    
                    # Update last cleanup time
                    await self._update_cleanup_timestamp(policy["table_name"])
                    
                except Exception as e:
                    error_msg = f"Failed to cleanup table {policy['table_name']}: {str(e)}"
                    cleanup_results["errors"].append(error_msg)
                    logger.error(error_msg)
            
            cleanup_results["completed_at"] = datetime.utcnow().isoformat() + "Z"
            cleanup_results["duration_seconds"] = (datetime.utcnow() - start_time).total_seconds()
            
            # Log cleanup completion
            await audit_service.log_event(
                action=AuditAction.SYSTEM_START,  # Reuse for cleanup
                severity=AuditSeverity.LOW,
                resource_type="data_cleanup",
                security_context={
                    "cleanup_results": cleanup_results,
                    "policies_processed": cleanup_results["policies_processed"],
                    "records_deleted": cleanup_results["records_deleted"]
                }
            )
            
            logger.info(f"Data retention cleanup completed: {cleanup_results}")
            return cleanup_results
            
        except Exception as e:
            logger.error(f"Data retention cleanup failed: {e}")
            return {
                "status": "failed",
                "error": str(e),
                "started_at": start_time.isoformat() + "Z",
                "completed_at": datetime.utcnow().isoformat() + "Z"
            }
        finally:
            self.cleanup_running = False
    
    async def cleanup_expired_prompts(self) -> int:
        """Clean up expired evidence prompts"""
        try:
            with self.db._get_connection() as conn:
                with conn.cursor() as cursor:
                    # Get expired prompts
                    cursor.execute("""
                        SELECT id, user_id, claim_id FROM evidence_prompts 
                        WHERE status = 'pending' AND expires_at < NOW()
                    """)
                    expired_prompts = cursor.fetchall()
                    
                    # Update status to expired
                    cursor.execute("""
                        UPDATE evidence_prompts 
                        SET status = 'expired', updated_at = NOW()
                        WHERE status = 'pending' AND expires_at < NOW()
                    """)
                    
                    expired_count = cursor.rowcount
                    
                    # Log cleanup for each expired prompt
                    for prompt_id, user_id, claim_id in expired_prompts:
                        await audit_service.log_event(
                            action=AuditAction.PROMPT_EXPIRE,
                            user_id=user_id,
                            resource_type="evidence_prompt",
                            resource_id=prompt_id,
                            security_context={
                                "claim_id": claim_id,
                                "expired_at": datetime.utcnow().isoformat() + "Z"
                            }
                        )
                    
                    return expired_count
                    
        except Exception as e:
            logger.error(f"Failed to cleanup expired prompts: {e}")
            return 0
    
    async def cleanup_old_audit_logs(self, retention_days: int = 2555) -> int:
        """Clean up old audit logs (7 years default)"""
        try:
            cutoff_date = datetime.utcnow() - timedelta(days=retention_days)
            
            with self.db._get_connection() as conn:
                with conn.cursor() as cursor:
                    # Count records to be deleted
                    cursor.execute("""
                        SELECT COUNT(*) FROM security_audit_log 
                        WHERE created_at < %s
                    """, (cutoff_date,))
                    count_before = cursor.fetchone()[0]
                    
                    # Delete old records
                    cursor.execute("""
                        DELETE FROM security_audit_log 
                        WHERE created_at < %s
                    """, (cutoff_date,))
                    
                    deleted_count = cursor.rowcount
                    
                    # Log the cleanup
                    await audit_service.log_event(
                        action=AuditAction.DATA_DELETE,
                        severity=AuditSeverity.LOW,
                        resource_type="security_audit_log",
                        security_context={
                            "retention_days": retention_days,
                            "cutoff_date": cutoff_date.isoformat() + "Z",
                            "deleted_count": deleted_count,
                            "count_before": count_before
                        }
                    )
                    
                    return deleted_count
                    
        except Exception as e:
            logger.error(f"Failed to cleanup old audit logs: {e}")
            return 0
    
    async def cleanup_old_parser_jobs(self, retention_days: int = 30) -> int:
        """Clean up old parser jobs"""
        try:
            cutoff_date = datetime.utcnow() - timedelta(days=retention_days)
            
            with self.db._get_connection() as conn:
                with conn.cursor() as cursor:
                    # Delete old parser jobs
                    cursor.execute("""
                        DELETE FROM parser_jobs 
                        WHERE created_at < %s AND status IN ('completed', 'failed')
                    """, (cutoff_date,))
                    
                    deleted_count = cursor.rowcount
                    
                    # Log the cleanup
                    await audit_service.log_event(
                        action=AuditAction.DATA_DELETE,
                        severity=AuditSeverity.LOW,
                        resource_type="parser_jobs",
                        security_context={
                            "retention_days": retention_days,
                            "cutoff_date": cutoff_date.isoformat() + "Z",
                            "deleted_count": deleted_count
                        }
                    )
                    
                    return deleted_count
                    
        except Exception as e:
            logger.error(f"Failed to cleanup old parser jobs: {e}")
            return 0
    
    async def anonymize_user_data(self, user_id: str) -> Dict[str, Any]:
        """Anonymize user data for GDPR compliance"""
        try:
            anonymization_results = {
                "user_id": user_id,
                "anonymized_at": datetime.utcnow().isoformat() + "Z",
                "tables_processed": [],
                "records_anonymized": 0
            }
            
            # Anonymize evidence documents
            with self.db._get_connection() as conn:
                with conn.cursor() as cursor:
                    # Anonymize evidence documents
                    cursor.execute("""
                        UPDATE evidence_documents 
                        SET filename = 'anonymized_' || id,
                            sender = 'anonymized@example.com',
                            subject = 'anonymized',
                            metadata = jsonb_set(metadata, '{anonymized}', 'true')
                        WHERE user_id = %s
                    """, (user_id,))
                    evidence_count = cursor.rowcount
                    
                    if evidence_count > 0:
                        anonymization_results["tables_processed"].append("evidence_documents")
                        anonymization_results["records_anonymized"] += evidence_count
                    
                    # Anonymize dispute cases
                    cursor.execute("""
                        UPDATE dispute_cases 
                        SET order_id = 'anonymized_' || id,
                            metadata = jsonb_set(metadata, '{anonymized}', 'true')
                        WHERE user_id = %s
                    """, (user_id,))
                    dispute_count = cursor.rowcount
                    
                    if dispute_count > 0:
                        anonymization_results["tables_processed"].append("dispute_cases")
                        anonymization_results["records_anonymized"] += dispute_count
                    
                    # Anonymize audit logs
                    cursor.execute("""
                        UPDATE security_audit_log 
                        SET ip_address = '0.0.0.0',
                            user_agent = 'anonymized',
                            security_context = jsonb_set(security_context, '{anonymized}', 'true')
                        WHERE user_id = %s
                    """, (user_id,))
                    audit_count = cursor.rowcount
                    
                    if audit_count > 0:
                        anonymization_results["tables_processed"].append("security_audit_log")
                        anonymization_results["records_anonymized"] += audit_count
            
            # Log anonymization
            await audit_service.log_event(
                action=AuditAction.DATA_ANONYMIZE,
                user_id=user_id,
                resource_type="user_data",
                resource_id=user_id,
                security_context={
                    "anonymization_results": anonymization_results,
                    "gdpr_compliance": True
                }
            )
            
            return anonymization_results
            
        except Exception as e:
            logger.error(f"Failed to anonymize user data for {user_id}: {e}")
            raise
    
    async def start_cleanup_scheduler(self):
        """Start the cleanup scheduler"""
        logger.info("Starting data retention cleanup scheduler")
        
        while True:
            try:
                # Run cleanup job
                await self.run_cleanup_job()
                
                # Wait for next cleanup cycle (24 hours)
                await asyncio.sleep(24 * 60 * 60)
                
            except Exception as e:
                logger.error(f"Cleanup scheduler error: {e}")
                # Wait 1 hour on error
                await asyncio.sleep(60 * 60)
    
    async def _get_retention_policies(self) -> List[Dict[str, Any]]:
        """Get all active retention policies"""
        try:
            with self.db._get_connection() as conn:
                with conn.cursor() as cursor:
                    cursor.execute("""
                        SELECT table_name, retention_days, cleanup_frequency_days,
                               last_cleanup_at, next_cleanup_at
                        FROM data_retention_policies 
                        WHERE is_active = TRUE
                        ORDER BY table_name
                    """)
                    
                    policies = []
                    for row in cursor.fetchall():
                        policies.append({
                            "table_name": row[0],
                            "retention_days": row[1],
                            "cleanup_frequency_days": row[2],
                            "last_cleanup_at": row[3].isoformat() + "Z" if row[3] else None,
                            "next_cleanup_at": row[4].isoformat() + "Z" if row[4] else None
                        })
                    
                    return policies
                    
        except Exception as e:
            logger.error(f"Failed to get retention policies: {e}")
            return []
    
    async def _cleanup_table(self, policy: Dict[str, Any]) -> Dict[str, Any]:
        """Clean up a specific table based on retention policy"""
        try:
            table_name = policy["table_name"]
            retention_days = policy["retention_days"]
            cutoff_date = datetime.utcnow() - timedelta(days=retention_days)
            
            with self.db._get_connection() as conn:
                with conn.cursor() as cursor:
                    # Count records to be deleted
                    cursor.execute(f"""
                        SELECT COUNT(*) FROM {table_name} 
                        WHERE created_at < %s
                    """, (cutoff_date,))
                    count_before = cursor.fetchone()[0]
                    
                    # Delete old records
                    cursor.execute(f"""
                        DELETE FROM {table_name} 
                        WHERE created_at < %s
                    """, (cutoff_date,))
                    
                    deleted_count = cursor.rowcount
                    
                    return {
                        "table_name": table_name,
                        "deleted_count": deleted_count,
                        "count_before": count_before,
                        "cutoff_date": cutoff_date.isoformat() + "Z"
                    }
                    
        except Exception as e:
            logger.error(f"Failed to cleanup table {policy['table_name']}: {e}")
            return {
                "table_name": policy["table_name"],
                "deleted_count": 0,
                "error": str(e)
            }
    
    async def _update_cleanup_timestamp(self, table_name: str):
        """Update the last cleanup timestamp for a table"""
        try:
            with self.db._get_connection() as conn:
                with conn.cursor() as cursor:
                    cursor.execute("""
                        SELECT schedule_next_cleanup(%s)
                    """, (table_name,))
                    
        except Exception as e:
            logger.error(f"Failed to update cleanup timestamp for {table_name}: {e}")
    
    async def get_retention_status(self) -> Dict[str, Any]:
        """Get current retention status"""
        try:
            with self.db._get_connection() as conn:
                with conn.cursor() as cursor:
                    # Get policy status
                    cursor.execute("""
                        SELECT table_name, retention_days, last_cleanup_at, 
                               next_cleanup_at, is_active
                        FROM data_retention_policies 
                        ORDER BY table_name
                    """)
                    
                    policies = []
                    for row in cursor.fetchall():
                        policies.append({
                            "table_name": row[0],
                            "retention_days": row[1],
                            "last_cleanup_at": row[2].isoformat() + "Z" if row[2] else None,
                            "next_cleanup_at": row[3].isoformat() + "Z" if row[3] else None,
                            "is_active": row[4]
                        })
                    
                    # Get table sizes
                    cursor.execute("""
                        SELECT 
                            schemaname,
                            tablename,
                            attname,
                            n_distinct,
                            correlation
                        FROM pg_stats 
                        WHERE schemaname = 'public' 
                        AND tablename IN (
                            SELECT table_name FROM data_retention_policies
                        )
                        ORDER BY tablename
                    """)
                    
                    table_stats = {}
                    for row in cursor.fetchall():
                        table_name = row[1]
                        if table_name not in table_stats:
                            table_stats[table_name] = {"columns": []}
                        table_stats[table_name]["columns"].append({
                            "column": row[2],
                            "distinct_values": row[3],
                            "correlation": row[4]
                        })
                    
                    return {
                        "policies": policies,
                        "table_stats": table_stats,
                        "cleanup_running": self.cleanup_running,
                        "status_checked_at": datetime.utcnow().isoformat() + "Z"
                    }
                    
        except Exception as e:
            logger.error(f"Failed to get retention status: {e}")
            return {}

# Global instance
data_retention_service = DataRetentionService()
