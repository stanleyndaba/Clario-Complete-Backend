#!/usr/bin/env python
"""
Utility script to mint short-lived JWTs for internal service-to-service calls.

Usage:
    python scripts/generate_service_jwt.py --user-id <uuid> [--email user@example.com]
"""

import argparse
import datetime as dt
import os
from pathlib import Path
from typing import Any, Dict

import jwt
from dotenv import load_dotenv

# Ensure we pick up variables from the repo-level .env when run locally
load_dotenv(dotenv_path=Path(__file__).resolve().parents[1] / '.env')

DEFAULT_TTL_MINUTES = int(os.getenv('SERVICE_JWT_TTL_MINUTES', '60'))
DEFAULT_ALGORITHM = os.getenv('JWT_ALGORITHM', 'HS256')


def build_token_payload(args: argparse.Namespace) -> Dict[str, Any]:
    expires_at = dt.datetime.utcnow() + dt.timedelta(minutes=args.ttl_minutes)
    payload: Dict[str, Any] = {
        'user_id': args.user_id,
        'email': args.email or os.getenv('PYTHON_API_SERVICE_EMAIL') or 'internal-service@clario.local',
        'name': args.name or os.getenv('PYTHON_API_SERVICE_NAME') or 'Integrations Service Worker',
        'amazon_seller_id': args.amazon_seller_id,
        'role': 'service_worker',
        'service': args.service or os.getenv('PYTHON_API_SERVICE_NAME') or 'integrations-service-worker',
        'exp': expires_at,
        'metadata': {
            'source': args.metadata_source or 'service-jwt-script',
            'notes': args.notes
        }
    }

    # Remove None values to keep payload compact
    return {k: v for k, v in payload.items() if v is not None}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description='Generate a signed JWT for internal Python API calls.')
    parser.add_argument('--user-id', required=True, help='User ID to impersonate (UUID from Supabase users table).')
    parser.add_argument('--email', help='Email to embed in the token (optional).')
    parser.add_argument('--name', help='Display name to embed (defaults to service worker).')
    parser.add_argument('--amazon-seller-id', help='Amazon seller ID associated with the user (optional).')
    parser.add_argument('--service', help='Service name claim; defaults to PYTHON_API_SERVICE_NAME.')
    parser.add_argument('--metadata-source', help='Override metadata.source claim (default: service-jwt-script).')
    parser.add_argument('--notes', help='Optional notes stored under metadata.notes.')
    parser.add_argument('--ttl-minutes', type=int, default=DEFAULT_TTL_MINUTES, help='Token lifetime in minutes (default: %(default)s).')
    parser.add_argument('--algorithm', default=DEFAULT_ALGORITHM, help='Signing algorithm (default: %(default)s).')
    parser.add_argument('--secret', default=os.getenv('JWT_SECRET'), help='Signing secret (defaults to JWT_SECRET env var).')
    parser.add_argument('--output', '-o', help='Optional path to write the token instead of printing.')
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    if not args.secret:
        raise SystemExit('JWT_SECRET (or --secret) must be set to generate a service token.')

    payload = build_token_payload(args)
    token = jwt.encode(payload, args.secret, algorithm=args.algorithm)

    if args.output:
        Path(args.output).write_text(token)
        print(f'✅ Service JWT written to {args.output}')
    else:
        print(token)


if __name__ == '__main__':
    main()


