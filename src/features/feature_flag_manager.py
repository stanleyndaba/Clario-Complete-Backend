"""
Feature Flag Manager
Handles canary rollout and feature flag management for zero-effort evidence loop
"""

import uuid
import json
from typing import Dict, Any, List, Optional, Tuple
from datetime import datetime
import logging
import hashlib

from src.common.db_postgresql import DatabaseManager
from src.common.config import settings

logger = logging.getLogger(__name__)

class FeatureFlagManager:
    """Manages feature flags and canary rollout"""
    
    def __init__(self):
        self.db = DatabaseManager()
        self.cache = {}
        self.cache_ttl = 300  # 5 minutes
    
    async def is_feature_enabled(self, flag_name: str, user_id: str) -> bool:
        """Check if a feature is enabled for a user"""
        try:
            # Check cache first
            cache_key = f"{flag_name}:{user_id}"
            if cache_key in self.cache:
                cached_result, timestamp = self.cache[cache_key]
                if (datetime.utcnow() - timestamp).seconds < self.cache_ttl:
                    return cached_result
            
            # Check user-specific override
            user_override = await self._get_user_feature_flag(flag_name, user_id)
            if user_override is not None:
                result = user_override
            else:
                # Check global feature flag
                result = await self._get_global_feature_flag(flag_name, user_id)
            
            # Cache the result
            self.cache[cache_key] = (result, datetime.utcnow())
            
            return result
            
        except Exception as e:
            logger.error(f"Failed to check feature flag {flag_name} for user {user_id}: {e}")
            return False
    
    async def _get_user_feature_flag(self, flag_name: str, user_id: str) -> Optional[bool]:
        """Get user-specific feature flag override"""
        with self.db._get_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute("""
                    SELECT is_enabled 
                    FROM user_feature_flags 
                    WHERE user_id = %s AND flag_name = %s
                """, (user_id, flag_name))
                
                result = cursor.fetchone()
                return result[0] if result else None
    
    async def _get_global_feature_flag(self, flag_name: str, user_id: str) -> bool:
        """Get global feature flag with rollout percentage"""
        with self.db._get_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute("""
                    SELECT is_enabled, rollout_percentage, canary_users
                    FROM feature_flags 
                    WHERE flag_name = %s
                """, (flag_name,))
                
                result = cursor.fetchone()
                if not result:
                    return False
                
                is_enabled, rollout_percentage, canary_users = result
                
                if not is_enabled:
                    return False
                
                # Check if user is in canary list
                canary_list = json.loads(canary_users) if canary_users else []
                if user_id in canary_list:
                    return True
                
                # Check rollout percentage
                if rollout_percentage >= 100:
                    return True
                
                # Use consistent hashing for rollout
                return self._is_user_in_rollout(user_id, rollout_percentage)
    
    def _is_user_in_rollout(self, user_id: str, rollout_percentage: int) -> bool:
        """Determine if user should be included in rollout using consistent hashing"""
        # Create a hash of user_id + flag_name for consistent assignment
        hash_input = f"{user_id}:{rollout_percentage}"
        hash_value = int(hashlib.md5(hash_input.encode()).hexdigest(), 16)
        
        # Use modulo to determine if user is in rollout
        return (hash_value % 100) < rollout_percentage
    
    async def set_user_feature_flag(self, user_id: str, flag_name: str, enabled: bool) -> bool:
        """Set a user-specific feature flag override"""
        try:
            with self.db._get_connection() as conn:
                with conn.cursor() as cursor:
                    cursor.execute("""
                        INSERT INTO user_feature_flags (id, user_id, flag_name, is_enabled)
                        VALUES (%s, %s, %s, %s)
                        ON CONFLICT (user_id, flag_name) 
                        DO UPDATE SET is_enabled = %s, granted_at = NOW()
                    """, (
                        str(uuid.uuid4()), user_id, flag_name, enabled, enabled
                    ))
            
            # Clear cache for this user
            self._clear_user_cache(user_id)
            
            logger.info(f"Set feature flag {flag_name} to {enabled} for user {user_id}")
            return True
            
        except Exception as e:
            logger.error(f"Failed to set feature flag {flag_name} for user {user_id}: {e}")
            return False
    
    async def add_canary_user(self, flag_name: str, user_id: str) -> bool:
        """Add a user to the canary list for a feature flag"""
        try:
            with self.db._get_connection() as conn:
                with conn.cursor() as cursor:
                    # Get current canary users
                    cursor.execute("""
                        SELECT canary_users FROM feature_flags WHERE flag_name = %s
                    """, (flag_name,))
                    
                    result = cursor.fetchone()
                    if not result:
                        return False
                    
                    canary_users = json.loads(result[0]) if result[0] else []
                    
                    # Add user if not already present
                    if user_id not in canary_users:
                        canary_users.append(user_id)
                        
                        cursor.execute("""
                            UPDATE feature_flags 
                            SET canary_users = %s, updated_at = NOW()
                            WHERE flag_name = %s
                        """, (json.dumps(canary_users), flag_name))
            
            # Clear cache for this user
            self._clear_user_cache(user_id)
            
            logger.info(f"Added user {user_id} to canary list for {flag_name}")
            return True
            
        except Exception as e:
            logger.error(f"Failed to add canary user {user_id} for {flag_name}: {e}")
            return False
    
    async def remove_canary_user(self, flag_name: str, user_id: str) -> bool:
        """Remove a user from the canary list for a feature flag"""
        try:
            with self.db._get_connection() as conn:
                with conn.cursor() as cursor:
                    # Get current canary users
                    cursor.execute("""
                        SELECT canary_users FROM feature_flags WHERE flag_name = %s
                    """, (flag_name,))
                    
                    result = cursor.fetchone()
                    if not result:
                        return False
                    
                    canary_users = json.loads(result[0]) if result[0] else []
                    
                    # Remove user if present
                    if user_id in canary_users:
                        canary_users.remove(user_id)
                        
                        cursor.execute("""
                            UPDATE feature_flags 
                            SET canary_users = %s, updated_at = NOW()
                            WHERE flag_name = %s
                        """, (json.dumps(canary_users), flag_name))
            
            # Clear cache for this user
            self._clear_user_cache(user_id)
            
            logger.info(f"Removed user {user_id} from canary list for {flag_name}")
            return True
            
        except Exception as e:
            logger.error(f"Failed to remove canary user {user_id} for {flag_name}: {e}")
            return False
    
    async def update_rollout_percentage(self, flag_name: str, percentage: int) -> bool:
        """Update rollout percentage for a feature flag"""
        try:
            if not 0 <= percentage <= 100:
                return False
            
            with self.db._get_connection() as conn:
                with conn.cursor() as cursor:
                    cursor.execute("""
                        UPDATE feature_flags 
                        SET rollout_percentage = %s, updated_at = NOW()
                        WHERE flag_name = %s
                    """, (percentage, flag_name))
            
            # Clear all cache
            self.cache.clear()
            
            logger.info(f"Updated rollout percentage for {flag_name} to {percentage}%")
            return True
            
        except Exception as e:
            logger.error(f"Failed to update rollout percentage for {flag_name}: {e}")
            return False
    
    async def get_feature_flags_for_user(self, user_id: str) -> Dict[str, bool]:
        """Get all feature flags for a user"""
        try:
            flags = {}
            
            # Get all global feature flags
            with self.db._get_connection() as conn:
                with conn.cursor() as cursor:
                    cursor.execute("""
                        SELECT flag_name, is_enabled, rollout_percentage, canary_users
                        FROM feature_flags
                        ORDER BY flag_name
                    """)
                    
                    global_flags = cursor.fetchall()
                    
                    for flag_name, is_enabled, rollout_percentage, canary_users in global_flags:
                        # Check user-specific override first
                        user_override = await self._get_user_feature_flag(flag_name, user_id)
                        if user_override is not None:
                            flags[flag_name] = user_override
                        else:
                            # Use global flag with rollout
                            if not is_enabled:
                                flags[flag_name] = False
                            else:
                                canary_list = json.loads(canary_users) if canary_users else []
                                if user_id in canary_list:
                                    flags[flag_name] = True
                                elif rollout_percentage >= 100:
                                    flags[flag_name] = True
                                else:
                                    flags[flag_name] = self._is_user_in_rollout(user_id, rollout_percentage)
            
            return flags
            
        except Exception as e:
            logger.error(f"Failed to get feature flags for user {user_id}: {e}")
            return {}
    
    async def get_feature_flag_stats(self, flag_name: str) -> Dict[str, Any]:
        """Get statistics for a feature flag"""
        try:
            with self.db._get_connection() as conn:
                with conn.cursor() as cursor:
                    # Get global flag info
                    cursor.execute("""
                        SELECT is_enabled, rollout_percentage, canary_users, created_at, updated_at
                        FROM feature_flags 
                        WHERE flag_name = %s
                    """, (flag_name,))
                    
                    result = cursor.fetchone()
                    if not result:
                        return {}
                    
                    is_enabled, rollout_percentage, canary_users, created_at, updated_at = result
                    canary_list = json.loads(canary_users) if canary_users else []
                    
                    # Get user override count
                    cursor.execute("""
                        SELECT COUNT(*) FROM user_feature_flags WHERE flag_name = %s
                    """, (flag_name,))
                    user_override_count = cursor.fetchone()[0]
                    
                    # Get enabled user count
                    cursor.execute("""
                        SELECT COUNT(*) FROM user_feature_flags 
                        WHERE flag_name = %s AND is_enabled = true
                    """, (flag_name,))
                    enabled_user_count = cursor.fetchone()[0]
                    
                    return {
                        "flag_name": flag_name,
                        "is_enabled": is_enabled,
                        "rollout_percentage": rollout_percentage,
                        "canary_users": canary_list,
                        "canary_user_count": len(canary_list),
                        "user_override_count": user_override_count,
                        "enabled_user_count": enabled_user_count,
                        "created_at": created_at.isoformat() + "Z" if created_at else None,
                        "updated_at": updated_at.isoformat() + "Z" if updated_at else None
                    }
                    
        except Exception as e:
            logger.error(f"Failed to get feature flag stats for {flag_name}: {e}")
            return {}
    
    def _clear_user_cache(self, user_id: str):
        """Clear cache entries for a specific user"""
        keys_to_remove = [key for key in self.cache.keys() if key.endswith(f":{user_id}")]
        for key in keys_to_remove:
            del self.cache[key]
    
    def clear_cache(self):
        """Clear all cached feature flag data"""
        self.cache.clear()

# Global feature flag manager instance
feature_flag_manager = FeatureFlagManager()

# Zero-effort evidence loop feature flags
ZERO_EFFORT_FEATURES = {
    "EV_AUTO_SUBMIT": "Auto-submit high-confidence evidence matches",
    "EV_SMART_PROMPTS": "Smart prompts for ambiguous evidence matches", 
    "EV_PROOF_PACKETS": "Proof packet generation after payout",
    "EV_CANARY_ROLLOUT": "Canary rollout for beta users",
    "EV_REAL_TIME_EVENTS": "Real-time WebSocket/SSE events",
    "EV_AUDIT_LOGGING": "Comprehensive audit logging"
}

