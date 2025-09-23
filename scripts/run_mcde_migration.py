#!/usr/bin/env python3
"""
MCDE migration runner

Safely applies MCDE detection tables migration to a target Postgres database.
 - Ensures UUID generation function availability (prefers gen_random_uuid from pgcrypto)
 - Falls back to uuid_generate_v4 (uuid-ossp) or no default if extensions are unavailable
 - Verifies created types and tables after applying

Usage:
  python scripts/run_mcde_migration.py "<POSTGRES_URL>"
"""

import os
import sys
import subprocess
from pathlib import Path


def ensure_psycopg2():
    try:
        import psycopg2  # noqa: F401
        return
    except Exception:
        print("Installing psycopg2-binary ...", flush=True)
        # Prefer system install with break-system-packages to bypass PEP 668 in managed envs
        try:
            subprocess.check_call([sys.executable, "-m", "pip", "install", "psycopg2-binary==2.9.9", "--break-system-packages"])  # noqa: S603,S607
        except Exception:
            # Fallback to --user
            subprocess.check_call([sys.executable, "-m", "pip", "install", "--user", "psycopg2-binary==2.9.9", "--break-system-packages"])  # noqa: S603,S607
        import importlib
        importlib.invalidate_caches()
        import psycopg2  # noqa: F401


def open_connection(db_url: str):
    import psycopg2
    conn = psycopg2.connect(db_url)
    conn.autocommit = True
    return conn


def function_exists(cur, fn_name: str) -> bool:
    cur.execute("SELECT EXISTS (SELECT 1 FROM pg_proc WHERE proname = %s);", (fn_name,))
    return bool(cur.fetchone()[0])


def try_create_extension(cur, ext_name: str) -> bool:
    try:
        cur.execute(f'CREATE EXTENSION IF NOT EXISTS "{ext_name}";')
        return True
    except Exception as e:
        print(f"Warning: failed to create extension {ext_name}: {e}")
        return False


def apply_sql(cur, sql_text: str):
    cur.execute(sql_text)


def main():
    if len(sys.argv) < 2:
        print("Usage: python scripts/run_mcde_migration.py <POSTGRES_URL>")
        sys.exit(2)

    db_url = sys.argv[1]
    ensure_psycopg2()

    # Resolve migration file path
    repo_root = Path(__file__).resolve().parents[1]
    migration_file = repo_root / "FBA Refund Predictor" / "mcde" / "migrations" / "001_create_detection_tables.sql"
    if not migration_file.exists():
        print(f"Migration file not found: {migration_file}")
        sys.exit(1)

    print("Connecting to Postgres ...", flush=True)
    conn = open_connection(db_url)
    cur = conn.cursor()

    # Detect UUID generation capability
    has_gen_random = function_exists(cur, "gen_random_uuid")
    has_uuid_v4 = function_exists(cur, "uuid_generate_v4")

    if not has_gen_random:
        # Attempt to enable pgcrypto
        try_create_extension(cur, "pgcrypto")
        has_gen_random = function_exists(cur, "gen_random_uuid")

    if not has_uuid_v4 and not has_gen_random:
        # Attempt to enable uuid-ossp
        try_create_extension(cur, "uuid-ossp")
        has_uuid_v4 = function_exists(cur, "uuid_generate_v4")

    # Load migration SQL
    sql_text = migration_file.read_text(encoding="utf-8")

    # Adjust defaults if needed
    if not has_gen_random:
        if has_uuid_v4:
            print("gen_random_uuid() not available; using uuid_generate_v4() fallback for defaults.")
            sql_text = sql_text.replace("gen_random_uuid()", "uuid_generate_v4()")
        else:
            print("Neither gen_random_uuid() nor uuid_generate_v4() available; removing DEFAULT uuid expressions.")
            sql_text = sql_text.replace("DEFAULT gen_random_uuid()", "")

    print("Applying MCDE migration ...", flush=True)
    try:
        apply_sql(cur, sql_text)
    except Exception as e:
        print(f"Migration failed: {e}")
        cur.close()
        conn.close()
        sys.exit(1)

    # Verify schema artifacts
    print("Verifying created types and tables ...", flush=True)
    cur.execute("SELECT to_regtype('anomaly_type')::text, to_regtype('detection_job_status')::text;")
    types_row = cur.fetchone()
    print({"anomaly_type": types_row[0], "detection_job_status": types_row[1]})

    cur.execute(
        """
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN ('detection_jobs','detection_results','detection_thresholds','detection_whitelists')
        ORDER BY table_name;
        """
    )
    tables = [r[0] for r in cur.fetchall()]
    print({"tables_present": tables})

    cur.close()
    conn.close()
    print("MCDE migration completed successfully.")


if __name__ == "__main__":
    main()

