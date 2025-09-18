#!/usr/bin/env python3
"""
Migration script to transfer data from SQLite to PostgreSQL
"""

import os
import sys
import json
import sqlite3
import psycopg2
from datetime import datetime
from urllib.parse import urlparse

# Add src to path
sys.path.append(os.path.join(os.path.dirname(__file__), '..', 'src'))

from common.config import settings

def get_sqlite_connection():
    """Get SQLite connection"""
    sqlite_db = "claims.db"
    if not os.path.exists(sqlite_db):
        raise FileNotFoundError(f"SQLite database {sqlite_db} not found")
    return sqlite3.connect(sqlite_db)

def get_postgresql_connection():
    """Get PostgreSQL connection"""
    config = settings.get_database_config()
    return psycopg2.connect(**config)

def migrate_table_data(table_name, sqlite_conn, pg_conn):
    """Migrate data from SQLite table to PostgreSQL"""
    print(f"Migrating {table_name}...")
    
    # Get SQLite data
    sqlite_cursor = sqlite_conn.cursor()
    sqlite_cursor.execute(f"SELECT * FROM {table_name}")
    rows = sqlite_cursor.fetchall()
    
    if not rows:
        print(f"  No data in {table_name}")
        return
    
    # Get column names
    columns = [description[0] for description in sqlite_cursor.description]
    print(f"  Found {len(rows)} rows")
    
    # Get PostgreSQL cursor
    pg_cursor = pg_conn.cursor()
    
    try:
        # Clear existing data
        pg_cursor.execute(f"TRUNCATE TABLE {table_name} RESTART IDENTITY CASCADE")
        
        # Insert data
        placeholders = ', '.join(['%s'] * len(columns))
        insert_query = f"INSERT INTO {table_name} ({', '.join(columns)}) VALUES ({placeholders})"
        
        for row in rows:
            # Convert data types for PostgreSQL
            converted_row = []
            for i, value in enumerate(row):
                if value is None:
                    converted_row.append(None)
                elif columns[i] in ['metadata', 'missing_evidence', 'reasons', 'packet', 'linked_marketplaces']:
                    # JSON fields
                    if isinstance(value, str):
                        converted_row.append(value)
                    else:
                        converted_row.append(json.dumps(value))
                elif columns[i] in ['compliant', 'auto_file_ready']:
                    # Boolean fields
                    converted_row.append(bool(value))
                elif columns[i] in ['created_at', 'updated_at', 'last_login', 'last_sync_attempt_at', 'last_sync_completed_at']:
                    # Timestamp fields
                    if isinstance(value, str):
                        converted_row.append(value)
                    else:
                        converted_row.append(datetime.fromisoformat(value).isoformat() + "Z")
                else:
                    converted_row.append(value)
            
            pg_cursor.execute(insert_query, converted_row)
        
        pg_conn.commit()
        print(f"  Successfully migrated {len(rows)} rows")
        
    except Exception as e:
        print(f"  Error migrating {table_name}: {e}")
        pg_conn.rollback()
        raise

def migrate_users_table(sqlite_conn, pg_conn):
    """Special migration for users table with UUID conversion"""
    print("Migrating users table...")
    
    sqlite_cursor = sqlite_conn.cursor()
    sqlite_cursor.execute("SELECT * FROM users")
    rows = sqlite_cursor.fetchall()
    
    if not rows:
        print("  No data in users table")
        return
    
    columns = [description[0] for description in sqlite_cursor.description]
    print(f"  Found {len(rows)} rows")
    
    pg_cursor = pg_conn.cursor()
    
    try:
        # Clear existing data
        pg_cursor.execute("TRUNCATE TABLE users RESTART IDENTITY CASCADE")
        
        for row in rows:
            # Convert row to dict
            user_data = dict(zip(columns, row))
            
            # Convert linked_marketplaces from JSON string to list
            if user_data.get('linked_marketplaces'):
                if isinstance(user_data['linked_marketplaces'], str):
                    user_data['linked_marketplaces'] = json.loads(user_data['linked_marketplaces'])
            
            # Insert with proper UUID handling
            insert_query = """
                INSERT INTO users (id, amazon_seller_id, company_name, linked_marketplaces, 
                                 stripe_customer_id, stripe_account_id, last_sync_attempt_at, 
                                 last_sync_completed_at, last_sync_job_id, created_at, last_login)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """
            
            pg_cursor.execute(insert_query, (
                user_data.get('id'),
                user_data.get('amazon_seller_id'),
                user_data.get('company_name'),
                json.dumps(user_data.get('linked_marketplaces', [])),
                user_data.get('stripe_customer_id'),
                user_data.get('stripe_account_id'),
                user_data.get('last_sync_attempt_at'),
                user_data.get('last_sync_completed_at'),
                user_data.get('last_sync_job_id'),
                user_data.get('created_at'),
                user_data.get('last_login')
            ))
        
        pg_conn.commit()
        print(f"  Successfully migrated {len(rows)} users")
        
    except Exception as e:
        print(f"  Error migrating users: {e}")
        pg_conn.rollback()
        raise

def migrate_oauth_tokens_table(sqlite_conn, pg_conn):
    """Special migration for oauth_tokens table"""
    print("Migrating oauth_tokens table...")
    
    sqlite_cursor = sqlite_conn.cursor()
    sqlite_cursor.execute("SELECT * FROM oauth_tokens")
    rows = sqlite_cursor.fetchall()
    
    if not rows:
        print("  No data in oauth_tokens table")
        return
    
    columns = [description[0] for description in sqlite_cursor.description]
    print(f"  Found {len(rows)} rows")
    
    pg_cursor = pg_conn.cursor()
    
    try:
        # Clear existing data
        pg_cursor.execute("TRUNCATE TABLE oauth_tokens RESTART IDENTITY CASCADE")
        
        for row in rows:
            insert_query = """
                INSERT INTO oauth_tokens (user_id, provider, encrypted_refresh_token, 
                                        expires_at, created_at, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s)
            """
            
            pg_cursor.execute(insert_query, (
                row[1],  # user_id
                row[2],  # provider
                row[3],  # encrypted_refresh_token
                None,    # expires_at (not in SQLite schema)
                row[4],  # created_at
                row[5]   # updated_at
            ))
        
        pg_conn.commit()
        print(f"  Successfully migrated {len(rows)} oauth tokens")
        
    except Exception as e:
        print(f"  Error migrating oauth_tokens: {e}")
        pg_conn.rollback()
        raise

def verify_migration(sqlite_conn, pg_conn):
    """Verify that migration was successful"""
    print("\nVerifying migration...")
    
    tables = ['claims', 'validations', 'filings', 'idempotency_keys', 'users', 'oauth_tokens']
    
    for table in tables:
        # Count SQLite rows
        sqlite_cursor = sqlite_conn.cursor()
        sqlite_cursor.execute(f"SELECT COUNT(*) FROM {table}")
        sqlite_count = sqlite_cursor.fetchone()[0]
        
        # Count PostgreSQL rows
        pg_cursor = pg_conn.cursor()
        pg_cursor.execute(f"SELECT COUNT(*) FROM {table}")
        pg_count = pg_cursor.fetchone()[0]
        
        if sqlite_count == pg_count:
            print(f"  ✅ {table}: {pg_count} rows migrated successfully")
        else:
            print(f"  ❌ {table}: SQLite={sqlite_count}, PostgreSQL={pg_count}")

def main():
    """Main migration function"""
    print("Starting SQLite to PostgreSQL migration...")
    print(f"SQLite DB: claims.db")
    print(f"PostgreSQL URL: {settings.DB_URL}")
    
    # Check if PostgreSQL is available
    if not settings.is_postgresql:
        print("Error: Database is not configured for PostgreSQL")
        return 1
    
    try:
        # Connect to databases
        sqlite_conn = get_sqlite_connection()
        pg_conn = get_postgresql_connection()
        
        print("Connected to both databases successfully")
        
        # Migrate data
        migrate_table_data('claims', sqlite_conn, pg_conn)
        migrate_table_data('validations', sqlite_conn, pg_conn)
        migrate_table_data('filings', sqlite_conn, pg_conn)
        migrate_table_data('idempotency_keys', sqlite_conn, pg_conn)
        migrate_users_table(sqlite_conn, pg_conn)
        migrate_oauth_tokens_table(sqlite_conn, pg_conn)
        
        # Verify migration
        verify_migration(sqlite_conn, pg_conn)
        
        print("\n✅ Migration completed successfully!")
        
    except Exception as e:
        print(f"\n❌ Migration failed: {e}")
        return 1
    
    finally:
        # Close connections
        if 'sqlite_conn' in locals():
            sqlite_conn.close()
        if 'pg_conn' in locals():
            pg_conn.close()
    
    return 0

if __name__ == "__main__":
    exit(main())

