#!/usr/bin/env python3
"""
CLI entrypoint for the MCDE Detection Engine.

Usage:
    python -m mcde.src.detection_engine.worker
    python -m mcde.src.detection_engine.worker --config config.yaml
    python -m mcde.src.detection_engine.worker --help
"""

import asyncio
import argparse
import logging
import os
import signal
import sys
import yaml
from pathlib import Path

from .worker import DetectionWorker


def setup_logging(log_level: str = "INFO"):
    """Setup logging configuration."""
    logging.basicConfig(
        level=getattr(logging, log_level.upper()),
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
        handlers=[
            logging.StreamHandler(sys.stdout),
            logging.FileHandler('detection_worker.log')
        ]
    )


def load_config(config_path: str = None) -> dict:
    """Load configuration from file or environment variables."""
    config = {
        'database': {
            'host': os.getenv('DB_HOST', 'localhost'),
            'port': int(os.getenv('DB_PORT', '5432')),
            'database': os.getenv('DB_NAME', 'cost_documentation_db'),
            'user': os.getenv('DB_USER', 'postgres'),
            'password': os.getenv('DB_PASSWORD', '')
        },
        's3': {
            'access_key_id': os.getenv('AWS_ACCESS_KEY_ID'),
            'secret_access_key': os.getenv('AWS_SECRET_ACCESS_KEY'),
            'region': os.getenv('AWS_REGION', 'us-east-1'),
            'bucket_name': os.getenv('S3_BUCKET_NAME', 'opside-cost-documents')
        },
        'worker': {
            'max_concurrency': int(os.getenv('DETECTION_WORKER_CONCURRENCY', '5')),
            'poll_interval_ms': int(os.getenv('DETECTION_WORKER_POLL_INTERVAL_MS', '5000')),
            'max_retries': int(os.getenv('DETECTION_WORKER_MAX_RETRIES', '3'))
        }
    }

    # Override with config file if provided
    if config_path and os.path.exists(config_path):
        with open(config_path, 'r') as f:
            file_config = yaml.safe_load(f)
            if file_config:
                # Deep merge config
                for section in ['database', 's3', 'worker']:
                    if section in file_config:
                        config[section].update(file_config[section])

    return config


def validate_config(config: dict) -> bool:
    """Validate configuration values."""
    required_env_vars = [
        'AWS_ACCESS_KEY_ID',
        'AWS_SECRET_ACCESS_KEY',
        'DB_PASSWORD'
    ]

    missing_vars = []
    for var in required_env_vars:
        if not os.getenv(var):
            missing_vars.append(var)

    if missing_vars:
        print(f"Error: Missing required environment variables: {', '.join(missing_vars)}")
        print("Please set these environment variables or provide them in a config file.")
        return False

    return True


async def main():
    """Main entry point for the detection worker."""
    parser = argparse.ArgumentParser(
        description='MCDE Detection Engine Worker',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python -m mcde.src.detection_engine.worker
  python -m mcde.src.detection_engine.worker --config config.yaml
  python -m mcde.src.detection_engine.worker --log-level DEBUG
        """
    )
    
    parser.add_argument(
        '--config', '-c',
        help='Path to configuration file (YAML)'
    )
    
    parser.add_argument(
        '--log-level', '-l',
        choices=['DEBUG', 'INFO', 'WARNING', 'ERROR'],
        default='INFO',
        help='Logging level (default: INFO)'
    )
    
    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='Validate configuration without starting the worker'
    )

    args = parser.parse_args()

    # Setup logging
    setup_logging(args.log_level)
    logger = logging.getLogger(__name__)

    try:
        # Load configuration
        config = load_config(args.config)
        
        if not validate_config(config):
            sys.exit(1)

        if args.dry_run:
            logger.info("Configuration validation successful!")
            logger.info("Database config: %s", config['database'])
            logger.info("S3 config: %s", config['s3'])
            logger.info("Worker config: %s", config['worker'])
            return

        # Create and start worker
        worker = DetectionWorker(
            db_config=config['database'],
            s3_config=config['s3'],
            worker_config=config['worker']
        )

        # Setup signal handlers for graceful shutdown
        def signal_handler(signum, frame):
            logger.info(f"Received signal {signum}, shutting down gracefully...")
            asyncio.create_task(worker.stop())

        signal.signal(signal.SIGINT, signal_handler)
        signal.signal(signal.SIGTERM, signal_handler)

        logger.info("Starting MCDE Detection Engine Worker...")
        logger.info("Configuration loaded successfully")
        logger.info("Press Ctrl+C to stop")

        # Start the worker
        await worker.start()

    except KeyboardInterrupt:
        logger.info("Received interrupt signal, shutting down...")
    except Exception as e:
        logger.error(f"Fatal error: {e}")
        sys.exit(1)
    finally:
        logger.info("Detection worker shutdown complete")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nShutdown complete.")
    except Exception as e:
        print(f"Fatal error: {e}")
        sys.exit(1)

