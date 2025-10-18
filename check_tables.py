import sqlite3
import os

db_path = os.path.join(os.getcwd(), 'claims.db')
print(f'📊 Database: {db_path}')

try:
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    # Get all tables
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
    tables = cursor.fetchall()
    
    print('📋 Tables in database:')
    for table in tables:
        table_name = table[0]
        print(f'   - {table_name}')
        
        # Get columns for this table
        cursor.execute(f"PRAGMA table_info({table_name})")
        columns = cursor.fetchall()
        for col in columns:
            print(f'     • {col[1]} ({col[2]})')
    
    conn.close()
    print('✅ Database structure checked')
    
except Exception as e:
    print(f'❌ Error: {e}')
