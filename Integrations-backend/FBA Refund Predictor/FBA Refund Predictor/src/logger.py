"""
Logging setup using Loguru.
"""
from loguru import logger
import yaml

def setup_logging(config_path: str = "config.yaml"):
    """Set up Loguru logging from config file."""
    with open(config_path, 'r') as f:
        config = yaml.safe_load(f)
    log_file = config['logging']['log_file']
    log_level = config['logging']['log_level']
    logger.add(log_file, level=log_level)
    logger.info("Logging is set up.") 