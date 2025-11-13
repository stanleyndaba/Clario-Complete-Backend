"""
Monitoring Setup Script
Sets up monitoring infrastructure for production model
"""

import json
import logging
from pathlib import Path
from datetime import datetime
import sys

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Get project root
script_dir = Path(__file__).parent
project_root = script_dir.parent.parent
monitoring_dir = project_root / 'monitoring'

def setup_monitoring():
    """Set up monitoring infrastructure"""
    logger.info("="*80)
    logger.info("MONITORING SETUP")
    logger.info("="*80)
    
    # Create monitoring directory
    monitoring_dir.mkdir(exist_ok=True)
    
    # Step 1: Create monitoring configuration
    logger.info("\n[1/4] Creating monitoring configuration...")
    config = {
        'monitoring_enabled': True,
        'setup_date': datetime.now().isoformat(),
        'alert_thresholds': {
            'critical': {
                'accuracy_drop_below': 0.95,
                'latency_p95_exceeds_ms': 2000,
                'error_rate_exceeds': 0.01,
                'data_drift_exceeds': 0.10
            },
            'warning': {
                'accuracy_drop_below': 0.97,
                'latency_increase_percent': 50,
                'prediction_shift_percent': 20
            }
        },
        'monitoring_schedule': {
            'daily': ['volume', 'latency', 'errors'],
            'weekly': ['accuracy', 'distribution', 'data_drift'],
            'monthly': ['full_review', 'feature_importance', 'concept_drift']
        },
        'metrics_to_track': [
            'prediction_volume',
            'prediction_accuracy',
            'inference_latency_p50',
            'inference_latency_p95',
            'inference_latency_p99',
            'error_rate',
            'prediction_distribution',
            'feature_distributions',
            'data_drift_score'
        ]
    }
    
    config_path = monitoring_dir / 'monitoring_config.json'
    with open(config_path, 'w') as f:
        json.dump(config, f, indent=2)
    
    logger.info(f"  [OK] Configuration saved to: {config_path}")
    
    # Step 2: Create metrics storage
    logger.info("\n[2/4] Creating metrics storage...")
    metrics_structure = {
        'daily_metrics': [],
        'weekly_metrics': [],
        'monthly_metrics': [],
        'alerts': [],
        'last_updated': datetime.now().isoformat()
    }
    
    metrics_path = monitoring_dir / 'metrics.json'
    with open(metrics_path, 'w') as f:
        json.dump(metrics_structure, f, indent=2)
    
    logger.info(f"  [OK] Metrics storage created: {metrics_path}")
    
    # Step 3: Create monitoring dashboard template
    logger.info("\n[3/4] Creating monitoring dashboard template...")
    dashboard_template = {
        'dashboard_name': 'Claim Detector Model Monitoring',
        'created_date': datetime.now().isoformat(),
        'widgets': [
            {
                'name': 'Prediction Volume',
                'type': 'line_chart',
                'metric': 'prediction_volume',
                'time_range': '7d'
            },
            {
                'name': 'Accuracy Trend',
                'type': 'line_chart',
                'metric': 'prediction_accuracy',
                'time_range': '30d',
                'threshold': 0.98
            },
            {
                'name': 'Latency Distribution',
                'type': 'histogram',
                'metric': 'inference_latency_p95',
                'time_range': '7d',
                'threshold': 2000
            },
            {
                'name': 'Error Rate',
                'type': 'gauge',
                'metric': 'error_rate',
                'threshold': 0.01
            },
            {
                'name': 'Data Drift Score',
                'type': 'line_chart',
                'metric': 'data_drift_score',
                'time_range': '30d',
                'threshold': 0.10
            }
        ]
    }
    
    dashboard_path = monitoring_dir / 'dashboard_template.json'
    with open(dashboard_path, 'w') as f:
        json.dump(dashboard_template, f, indent=2)
    
    logger.info(f"  [OK] Dashboard template created: {dashboard_path}")
    
    # Step 4: Create alert rules
    logger.info("\n[4/4] Creating alert rules...")
    alert_rules = {
        'rules': [
            {
                'name': 'Critical Accuracy Drop',
                'condition': 'accuracy < 0.95',
                'severity': 'critical',
                'action': 'notify_team',
                'enabled': True
            },
            {
                'name': 'Critical Latency Spike',
                'condition': 'latency_p95 > 2000',
                'severity': 'critical',
                'action': 'notify_team',
                'enabled': True
            },
            {
                'name': 'High Error Rate',
                'condition': 'error_rate > 0.01',
                'severity': 'critical',
                'action': 'notify_team',
                'enabled': True
            },
            {
                'name': 'Warning Accuracy Drop',
                'condition': 'accuracy < 0.97',
                'severity': 'warning',
                'action': 'log_warning',
                'enabled': True
            },
            {
                'name': 'Data Drift Detected',
                'condition': 'data_drift > 0.10',
                'severity': 'warning',
                'action': 'log_warning',
                'enabled': True
            }
        ],
        'notification_channels': {
            'email': [],
            'slack': [],
            'pagerduty': []
        }
    }
    
    alerts_path = monitoring_dir / 'alert_rules.json'
    with open(alerts_path, 'w') as f:
        json.dump(alert_rules, f, indent=2)
    
    logger.info(f"  [OK] Alert rules created: {alerts_path}")
    
    # Summary
    logger.info("\n" + "="*80)
    logger.info("MONITORING SETUP SUMMARY")
    logger.info("="*80)
    logger.info(f"Monitoring Directory: {monitoring_dir}")
    logger.info(f"Configuration: {config_path}")
    logger.info(f"Metrics Storage: {metrics_path}")
    logger.info(f"Dashboard Template: {dashboard_path}")
    logger.info(f"Alert Rules: {alerts_path}")
    logger.info("\n[SUCCESS] Monitoring infrastructure set up!")
    logger.info("\n[INFO] Next steps:")
    logger.info("  1. Configure notification channels in alert_rules.json")
    logger.info("  2. Set up metrics collection (integrate with your logging system)")
    logger.info("  3. Create dashboard using dashboard_template.json")
    logger.info("  4. Test alert rules")
    
    return True

if __name__ == '__main__':
    success = setup_monitoring()
    sys.exit(0 if success else 1)

