"""
DATABASE FIX FOR STEP 7
Fixes the SQLite database path issue
"""

import sys
import os
import sqlite3
from pathlib import Path

# Set the correct database path
current_dir = os.path.dirname(os.path.abspath(__file__))
db_path = os.path.join(current_dir, "claims.db")

print(f"🔧 FIXING DATABASE PATH: {db_path}")

# Ensure the database file exists and is accessible
try:
    # Create the database file if it doesn't exist
    conn = sqlite3.connect(db_path)
    conn.close()
    print("✅ Database file created/verified")
    
    # Test basic database operations
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    # Create the basic claims table if it doesn't exist
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS claim_detections (
            claim_id TEXT PRIMARY KEY,
            order_id TEXT,
            claim_type TEXT,
            amount_claimed REAL,
            currency TEXT,
            status TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    # Insert a test claim
    cursor.execute('''
        INSERT OR IGNORE INTO claim_detections 
        (claim_id, order_id, claim_type, amount_claimed, currency, status)
        VALUES (?, ?, ?, ?, ?, ?)
    ''', ('step7_test_001', '123-4567890-1234567', 'lost_inventory', 150.00, 'USD', 'detected'))
    
    conn.commit()
    conn.close()
    print("✅ Test claim inserted into database")
    
except Exception as e:
    print(f"❌ Database setup failed: {e}")

print("\\n🎯 Now testing Step 7 with fixed database...")
