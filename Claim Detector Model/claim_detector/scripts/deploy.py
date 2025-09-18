#!/usr/bin/env python3
"""
Comprehensive deployment script for the Claim Detector Model
"""
import os
import sys
import logging
import argparse
import subprocess
from pathlib import Path
import shutil

# Add project root to path
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

from src.database.session import create_tables, drop_tables
from src.security.ssl_config import ssl_config

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

class DeploymentManager:
    """Manages the complete deployment process"""
    
    def __init__(self, project_root: Path):
        self.project_root = project_root
        self.directories = [
            'models',
            'data/raw',
            'data/processed',
            'logs',
            'ssl',
            'tests/output'
        ]
    
    def create_directories(self):
        """Create necessary directories"""
        logger.info("Creating project directories...")
        
        for directory in self.directories:
            dir_path = self.project_root / directory
            dir_path.mkdir(parents=True, exist_ok=True)
            logger.info(f"Created directory: {directory}")
    
    def setup_environment(self, env_file: str = None):
        """Setup environment configuration"""
        logger.info("Setting up environment configuration...")
        
        env_example = self.project_root / "env.example"
        env_file_path = self.project_root / ".env"
        
        if env_file and Path(env_file).exists():
            # Copy custom env file
            shutil.copy(env_file, env_file_path)
            logger.info(f"Copied custom environment file: {env_file}")
        elif env_example.exists() and not env_file_path.exists():
            # Copy example env file
            shutil.copy(env_example, env_file_path)
            logger.info("Copied environment example file to .env")
            logger.warning("Please edit .env file with your configuration")
        else:
            logger.info("Environment file already exists")
    
    def setup_database(self, reset: bool = False):
        """Setup database tables"""
        logger.info("Setting up database...")
        
        try:
            if reset:
                logger.info("Dropping existing tables...")
                drop_tables()
            
            logger.info("Creating database tables...")
            create_tables()
            logger.info("Database setup completed successfully")
            
        except Exception as e:
            logger.error(f"Database setup failed: {e}")
            raise
    
    def setup_ssl(self, generate_cert: bool = False):
        """Setup SSL configuration"""
        logger.info("Setting up SSL configuration...")
        
        if generate_cert:
            try:
                ssl_config.create_self_signed_cert()
                logger.info("Self-signed SSL certificate generated")
            except Exception as e:
                logger.warning(f"SSL certificate generation failed: {e}")
                logger.info("HTTPS will be disabled")
        else:
            logger.info("SSL setup skipped - using HTTP only")
    
    def install_dependencies(self, upgrade: bool = False):
        """Install Python dependencies"""
        logger.info("Installing Python dependencies...")
        
        try:
            cmd = [sys.executable, "-m", "pip", "install"]
            if upgrade:
                cmd.append("--upgrade")
            cmd.extend(["-r", str(self.project_root / "requirements.txt")])
            
            result = subprocess.run(cmd, capture_output=True, text=True, check=True)
            logger.info("Dependencies installed successfully")
            
        except subprocess.CalledProcessError as e:
            logger.error(f"Dependency installation failed: {e}")
            logger.error(f"Error output: {e.stderr}")
            raise
    
    def run_tests(self, verbose: bool = False):
        """Run the test suite"""
        logger.info("Running test suite...")
        
        try:
            cmd = [sys.executable, "-m", "pytest", "tests/"]
            if verbose:
                cmd.append("-v")
            
            result = subprocess.run(cmd, capture_output=True, text=True, check=True)
            logger.info("All tests passed successfully")
            
            if verbose:
                print(result.stdout)
            
        except subprocess.CalledProcessError as e:
            logger.error(f"Tests failed: {e}")
            logger.error(f"Test output: {e.stdout}")
            logger.error(f"Test errors: {e.stderr}")
            raise
    
    def train_model(self, synthetic_data: bool = True, evaluate: bool = True):
        """Train the model"""
        logger.info("Training the model...")
        
        try:
            cmd = [sys.executable, "scripts/train_unified_model.py"]
            
            if synthetic_data:
                cmd.extend(["--synthetic-samples", "5000"])  # Smaller for deployment
            
            if evaluate:
                cmd.append("--evaluate")
            
            result = subprocess.run(cmd, capture_output=True, text=True, check=True)
            logger.info("Model training completed successfully")
            
        except subprocess.CalledProcessError as e:
            logger.error(f"Model training failed: {e}")
            logger.error(f"Training output: {e.stdout}")
            logger.error(f"Training errors: {e.stderr}")
            raise
    
    def validate_deployment(self):
        """Validate the deployment"""
        logger.info("Validating deployment...")
        
        # Check critical files
        critical_files = [
            "models/claim_detector_model.pkl",
            "models/preprocessing_pipeline.pkl",
            ".env"
        ]
        
        missing_files = []
        for file_path in critical_files:
            if not (self.project_root / file_path).exists():
                missing_files.append(file_path)
        
        if missing_files:
            logger.error(f"Missing critical files: {missing_files}")
            return False
        
        # Check database connection
        try:
            from src.database.session import engine
            with engine.connect() as conn:
                conn.execute("SELECT 1")
            logger.info("Database connection validated")
        except Exception as e:
            logger.error(f"Database validation failed: {e}")
            return False
        
        logger.info("Deployment validation completed successfully")
        return True
    
    def start_api(self, host: str = "0.0.0.0", port: int = 8000, ssl: bool = False):
        """Start the API server"""
        logger.info(f"Starting API server on {host}:{port}")
        
        try:
            cmd = [sys.executable, "api/main.py"]
            
            # Set environment variables
            env = os.environ.copy()
            env["API_HOST"] = host
            env["API_PORT"] = str(port)
            
            if ssl:
                env["HTTPS_ENABLED"] = "true"
            
            # Start server
            result = subprocess.run(cmd, env=env, check=True)
            
        except subprocess.CalledProcessError as e:
            logger.error(f"API server failed: {e}")
            raise
        except KeyboardInterrupt:
            logger.info("API server stopped by user")
    
    def deploy(self, options: dict):
        """Execute complete deployment"""
        logger.info("Starting deployment process...")
        
        try:
            # 1. Create directories
            self.create_directories()
            
            # 2. Setup environment
            self.setup_environment(options.get('env_file'))
            
            # 3. Install dependencies
            self.install_dependencies(options.get('upgrade_deps', False))
            
            # 4. Setup database
            self.setup_database(options.get('reset_db', False))
            
            # 5. Setup SSL
            self.setup_ssl(options.get('generate_ssl', False))
            
            # 6. Run tests
            if options.get('run_tests', True):
                self.run_tests(options.get('verbose_tests', False))
            
            # 7. Train model
            if options.get('train_model', True):
                self.train_model(
                    synthetic_data=options.get('synthetic_data', True),
                    evaluate=options.get('evaluate_model', True)
                )
            
            # 8. Validate deployment
            if not self.validate_deployment():
                raise RuntimeError("Deployment validation failed")
            
            logger.info("Deployment completed successfully!")
            
            # 9. Start API if requested
            if options.get('start_api', False):
                self.start_api(
                    host=options.get('host', '0.0.0.0'),
                    port=options.get('port', 8000),
                    ssl=options.get('ssl', False)
                )
            
        except Exception as e:
            logger.error(f"Deployment failed: {e}")
            raise

def main():
    """Main deployment function"""
    parser = argparse.ArgumentParser(description="Deploy the Claim Detector Model")
    
    parser.add_argument("--env-file", type=str, help="Custom environment file path")
    parser.add_argument("--reset-db", action="store_true", help="Reset database tables")
    parser.add_argument("--generate-ssl", action="store_true", help="Generate SSL certificates")
    parser.add_argument("--upgrade-deps", action="store_true", help="Upgrade dependencies")
    parser.add_argument("--no-tests", action="store_true", help="Skip running tests")
    parser.add_argument("--verbose-tests", action="store_true", help="Verbose test output")
    parser.add_argument("--no-train", action="store_true", help="Skip model training")
    parser.add_argument("--no-synthetic", action="store_true", help="Use real data instead of synthetic")
    parser.add_argument("--no-evaluate", action="store_true", help="Skip model evaluation")
    parser.add_argument("--start-api", action="store_true", help="Start API server after deployment")
    parser.add_argument("--host", type=str, default="0.0.0.0", help="API host address")
    parser.add_argument("--port", type=int, default=8000, help="API port")
    parser.add_argument("--ssl", action="store_true", help="Enable HTTPS for API")
    
    args = parser.parse_args()
    
    # Create deployment manager
    manager = DeploymentManager(project_root)
    
    # Prepare deployment options
    options = {
        'env_file': args.env_file,
        'reset_db': args.reset_db,
        'generate_ssl': args.generate_ssl,
        'upgrade_deps': args.upgrade_deps,
        'run_tests': not args.no_tests,
        'verbose_tests': args.verbose_tests,
        'train_model': not args.no_train,
        'synthetic_data': not args.no_synthetic,
        'evaluate_model': not args.no_evaluate,
        'start_api': args.start_api,
        'host': args.host,
        'port': args.port,
        'ssl': args.ssl
    }
    
    try:
        # Execute deployment
        manager.deploy(options)
        
    except Exception as e:
        logger.error(f"Deployment failed: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
