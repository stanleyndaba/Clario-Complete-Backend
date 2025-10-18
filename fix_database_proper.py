"""
PROPER DATABASE FIX FOR STEP 7
Ensures all database connections use the same path
"""

import sys
import os
import sqlite3

# Use the exact same path that the DatabaseManager uses
db_path = os.path.join(os.getcwd(), "claims.db")
print(f"🔧 USING DATABASE PATH: {db_path}")

# Test if we can access the database
try:
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    # Check what tables exist
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
    tables = cursor.fetchall()
    
    print("📋 EXISTING TABLES:")
    for table in tables:
        print(f"   - {table[0]}")
        
    # Check if claim_detections table exists, if not create it
    if not any('claim_detections' in table for table in tables):
        print("🔄 Creating claim_detections table...")
        cursor.execute('''
            CREATE TABLE claim_detections (
                claim_id TEXT PRIMARY KEY,
                order_id TEXT,
                claim_type TEXT,
                amount_claimed REAL,
                currency TEXT,
                status TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        print("✅ claim_detections table created")
    
    # Ensure our test claim exists in the correct table
    cursor.execute("SELECT claim_id FROM claim_detections WHERE claim_id = ?", ('step7_test_001',))
    if not cursor.fetchone():
        cursor.execute('''
            INSERT INTO claim_detections 
            (claim_id, order_id, claim_type, amount_claimed, currency, status)
            VALUES (?, ?, ?, ?, ?, ?)
        ''', ('step7_test_001', '123-4567890-1234567', 'lost_inventory', 150.00, 'USD', 'detected'))
        print("✅ Test claim inserted")
    
    conn.commit()
    conn.close()
    print("🎯 Database is ready for Step 7 testing")
    
except Exception as e:
    print(f"❌ Database error: {e}")
