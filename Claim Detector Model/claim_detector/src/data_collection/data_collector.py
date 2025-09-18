#!/usr/bin/env python3
"""
Data Collection Layer for FBA Claims System
Handles pulling data from Amazon APIs, Seller Central exports, and other sources
"""

import pandas as pd
import numpy as np
import requests
import json
import logging
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List, Optional, Any
import asyncio
import aiohttp
from dataclasses import dataclass
import csv
import io

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')
logger = logging.getLogger(__name__)

@dataclass
class AmazonAPIConfig:
    """Configuration for Amazon API access"""
    marketplace_id: str
    seller_id: str
    access_key: str
    secret_key: str
    role_arn: str
    refresh_token: str
    region: str = 'us-east-1'

@dataclass
class DataSource:
    """Represents a data source configuration"""
    name: str
    type: str  # 'api', 'csv', 'excel', 'database'
    config: Dict[str, Any]
    schedule: str  # cron-like schedule
    last_run: Optional[datetime] = None
    is_active: bool = True

class AmazonAPICollector:
    """Collects data from Amazon APIs"""
    
    def __init__(self, config: AmazonAPIConfig):
        self.config = config
        self.base_url = "https://sellingpartnerapi-na.amazon.com"
        self.session = requests.Session()
        self.access_token = None
        self.token_expiry = None
        
    def _get_access_token(self) -> str:
        """Get OAuth access token for Amazon API"""
        if self.access_token and self.token_expiry and datetime.now() < self.token_expiry:
            return self.access_token
            
        # In production, implement proper OAuth flow
        # For now, using refresh token approach
        token_url = f"{self.base_url}/oauth/token"
        payload = {
            "grant_type": "refresh_token",
            "refresh_token": self.config.refresh_token
        }
        
        try:
            response = self.session.post(token_url, json=payload)
            response.raise_for_status()
            token_data = response.json()
            
            self.access_token = token_data['access_token']
            self.token_expiry = datetime.now() + timedelta(hours=1)
            
            logger.info("✅ Amazon API access token refreshed")
            return self.access_token
            
        except Exception as e:
            logger.error(f"❌ Failed to get Amazon API token: {e}")
            raise
    
    def get_inventory_ledger(self, start_date: str, end_date: str) -> pd.DataFrame:
        """Get inventory ledger data from Amazon API"""
        try:
            token = self._get_access_token()
            headers = {
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json"
            }
            
            # Inventory Ledger API endpoint
            url = f"{self.base_url}/fba/inventory/v1/inventoryLedger"
            params = {
                "marketplaceIds": self.config.marketplace_id,
                "startDate": start_date,
                "endDate": end_date
            }
            
            response = self.session.get(url, headers=headers, params=params)
            response.raise_for_status()
            
            data = response.json()
            
            # Transform to DataFrame
            if 'payload' in data and 'inventoryLedger' in data['payload']:
                ledger_data = data['payload']['inventoryLedger']
                df = pd.DataFrame(ledger_data)
                
                # Standardize column names
                column_mapping = {
                    'sellerSku': 'sku',
                    'asin': 'asin',
                    'fnSku': 'fn_sku',
                    'quantity': 'quantity',
                    'fulfillmentCenter': 'warehouse_location',
                    'detailedDisposition': 'transaction_type',
                    'date': 'transaction_date'
                }
                
                df = df.rename(columns=column_mapping)
                df['transaction_date'] = pd.to_datetime(df['transaction_date'])
                
                logger.info(f"✅ Collected {len(df)} inventory ledger records")
                return df
            else:
                logger.warning("⚠️ No inventory ledger data found in API response")
                return pd.DataFrame()
                
        except Exception as e:
            logger.error(f"❌ Failed to collect inventory ledger: {e}")
            return pd.DataFrame()
    
    def get_reimbursements(self, start_date: str, end_date: str) -> pd.DataFrame:
        """Get reimbursement data from Amazon API"""
        try:
            token = self._get_access_token()
            headers = {
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json"
            }
            
            # Reimbursements API endpoint
            url = f"{self.base_url}/fba/inventory/v1/reimbursements"
            params = {
                "marketplaceIds": self.config.marketplace_id,
                "beginDate": start_date,
                "endDate": end_date
            }
            
            response = self.session.get(url, headers=headers, params=params)
            response.raise_for_status()
            
            data = response.json()
            
            # Transform to DataFrame
            if 'payload' in data and 'reimbursements' in data['payload']:
                reimb_data = data['payload']['reimbursements']
                df = pd.DataFrame(reimb_data)
                
                # Standardize column names
                column_mapping = {
                    'sellerSku': 'sku',
                    'asin': 'asin',
                    'reimbursementType': 'reimbursement_type',
                    'amount': 'amount_approved',
                    'quantity': 'quantity_lost',
                    'reason': 'reason',
                    'decisionDate': 'decision_date'
                }
                
                df = df.rename(columns=column_mapping)
                df['decision_date'] = pd.to_datetime(df['decision_date'])
                
                logger.info(f"✅ Collected {len(df)} reimbursement records")
                return df
            else:
                logger.warning("⚠️ No reimbursement data found in API response")
                return pd.DataFrame()
                
        except Exception as e:
            logger.error(f"❌ Failed to collect reimbursements: {e}")
            return pd.DataFrame()
    
    def get_fba_inbound_shipments(self, start_date: str, end_date: str) -> pd.DataFrame:
        """Get FBA inbound shipment data from Amazon API"""
        try:
            token = self._get_access_token()
            headers = {
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json"
            }
            
            # FBA Inbound API endpoint
            url = f"{self.base_url}/fba/inbound/v0/shipments"
            params = {
                "marketplaceIds": self.config.marketplace_id,
                "lastUpdatedAfter": start_date,
                "lastUpdatedBefore": end_date
            }
            
            response = self.session.get(url, headers=headers, params=params)
            response.raise_for_status()
            
            data = response.json()
            
            # Transform to DataFrame
            if 'payload' in data and 'shipments' in data['payload']:
                shipment_data = data['payload']['shipments']
                df = pd.DataFrame(shipment_data)
                
                # Standardize column names
                column_mapping = {
                    'shipmentId': 'shipment_id',
                    'shipmentName': 'shipment_name',
                    'shipmentStatus': 'status',
                    'lastUpdatedDate': 'last_updated',
                    'createdDate': 'created_date'
                }
                
                df = df.rename(columns=column_mapping)
                df['created_date'] = pd.to_datetime(df['created_date'])
                df['last_updated'] = pd.to_datetime(df['last_updated'])
                
                logger.info(f"✅ Collected {len(df)} FBA inbound shipment records")
                return df
            else:
                logger.warning("⚠️ No FBA inbound shipment data found in API response")
                return pd.DataFrame()
                
        except Exception as e:
            logger.error(f"❌ Failed to collect FBA inbound shipments: {e}")
            return pd.DataFrame()

class SellerCentralCollector:
    """Collects data from Seller Central exports"""
    
    def __init__(self, export_directory: str):
        self.export_directory = Path(export_directory)
        self.export_directory.mkdir(exist_ok=True)
    
    def parse_inventory_ledger_export(self, file_path: str) -> pd.DataFrame:
        """Parse Seller Central inventory ledger export"""
        try:
            df = pd.read_csv(file_path)
            
            # Standardize column names (Seller Central exports vary)
            column_mapping = {
                'Seller SKU': 'sku',
                'ASIN': 'asin',
                'FNSKU': 'fn_sku',
                'Quantity': 'quantity',
                'Fulfillment Center': 'warehouse_location',
                'Detailed Disposition': 'transaction_type',
                'Date': 'transaction_date'
            }
            
            # Try to map columns, fall back to original if not found
            for old_col, new_col in column_mapping.items():
                if old_col in df.columns:
                    df = df.rename(columns={old_col: new_col})
            
            # Ensure required columns exist
            required_cols = ['sku', 'quantity', 'transaction_type', 'transaction_date']
            missing_cols = [col for col in required_cols if col not in df.columns]
            
            if missing_cols:
                logger.warning(f"⚠️ Missing required columns: {missing_cols}")
                return pd.DataFrame()
            
            # Convert date column
            df['transaction_date'] = pd.to_datetime(df['transaction_date'], errors='coerce')
            
            # Filter out rows with invalid dates
            df = df.dropna(subset=['transaction_date'])
            
            logger.info(f"✅ Parsed {len(df)} inventory ledger records from {file_path}")
            return df
            
        except Exception as e:
            logger.error(f"❌ Failed to parse inventory ledger export: {e}")
            return pd.DataFrame()
    
    def parse_reimbursements_export(self, file_path: str) -> pd.DataFrame:
        """Parse Seller Central reimbursements export"""
        try:
            df = pd.read_csv(file_path)
            
            # Standardize column names
            column_mapping = {
                'Seller SKU': 'sku',
                'ASIN': 'asin',
                'Reimbursement Type': 'reimbursement_type',
                'Amount': 'amount_approved',
                'Quantity': 'quantity_lost',
                'Reason': 'reason',
                'Decision Date': 'decision_date'
            }
            
            # Try to map columns
            for old_col, new_col in column_mapping.items():
                if old_col in df.columns:
                    df = df.rename(columns={old_col: new_col})
            
            # Ensure required columns exist
            required_cols = ['sku', 'amount_approved', 'decision_date']
            missing_cols = [col for col in required_cols if col not in df.columns]
            
            if missing_cols:
                logger.warning(f"⚠️ Missing required columns: {missing_cols}")
                return pd.DataFrame()
            
            # Convert date and amount columns
            df['decision_date'] = pd.to_datetime(df['decision_date'], errors='coerce')
            df['amount_approved'] = pd.to_numeric(df['amount_approved'], errors='coerce')
            
            # Filter out rows with invalid data
            df = df.dropna(subset=['decision_date', 'amount_approved'])
            
            logger.info(f"✅ Parsed {len(df)} reimbursement records from {file_path}")
            return df
            
        except Exception as e:
            logger.error(f"❌ Failed to parse reimbursements export: {e}")
            return pd.DataFrame()
    
    def parse_shipments_export(self, file_path: str) -> pd.DataFrame:
        """Parse Seller Central shipments export"""
        try:
            df = pd.read_csv(file_path)
            
            # Standardize column names
            column_mapping = {
                'Seller SKU': 'sku',
                'ASIN': 'asin',
                'Quantity Shipped': 'qty_sent',
                'Quantity Received': 'qty_received',
                'Shipment Date': 'shipment_date',
                'Received Date': 'received_date',
                'Fulfillment Center': 'warehouse_location',
                'Carrier': 'carrier',
                'Tracking Number': 'tracking_number'
            }
            
            # Try to map columns
            for old_col, new_col in column_mapping.items():
                if old_col in df.columns:
                    df = df.rename(columns={old_col: new_col})
            
            # Ensure required columns exist
            required_cols = ['sku', 'qty_sent', 'shipment_date']
            missing_cols = [col for col in required_cols if col not in df.columns]
            
            if missing_cols:
                logger.warning(f"⚠️ Missing required columns: {missing_cols}")
                return pd.DataFrame()
            
            # Convert date columns
            df['shipment_date'] = pd.to_datetime(df['shipment_date'], errors='coerce')
            if 'received_date' in df.columns:
                df['received_date'] = pd.to_datetime(df['received_date'], errors='coerce')
            
            # Filter out rows with invalid dates
            df = df.dropna(subset=['shipment_date'])
            
            logger.info(f"✅ Parsed {len(df)} shipment records from {file_path}")
            return df
            
        except Exception as e:
            logger.error(f"❌ Failed to parse shipments export: {e}")
            return pd.DataFrame()

class DataCollectionOrchestrator:
    """Orchestrates data collection from multiple sources"""
    
    def __init__(self, db_connection, amazon_config: Optional[AmazonAPIConfig] = None):
        self.db_connection = db_connection
        self.amazon_collector = AmazonAPICollector(amazon_config) if amazon_config else None
        self.seller_central_collector = SellerCentralCollector("exports/")
        self.data_sources = self._initialize_data_sources()
    
    def _initialize_data_sources(self) -> List[DataSource]:
        """Initialize configured data sources"""
        return [
            DataSource(
                name="amazon_inventory_ledger",
                type="api",
                config={"endpoint": "inventory_ledger", "schedule": "0 */6 * * *"},  # Every 6 hours
                schedule="0 */6 * * *"
            ),
            DataSource(
                name="amazon_reimbursements",
                type="api",
                config={"endpoint": "reimbursements", "schedule": "0 2 * * *"},  # Daily at 2 AM
                schedule="0 2 * * *"
            ),
            DataSource(
                name="amazon_shipments",
                type="api",
                config={"endpoint": "shipments", "schedule": "0 */12 * * *"},  # Every 12 hours
                schedule="0 */12 * * *"
            ),
            DataSource(
                name="seller_central_exports",
                type="file",
                config={"directory": "exports/", "schedule": "0 1 * * *"},  # Daily at 1 AM
                schedule="0 1 * * *"
            )
        ]
    
    async def collect_all_data(self) -> Dict[str, pd.DataFrame]:
        """Collect data from all active sources"""
        logger.info("🚀 Starting data collection from all sources...")
        
        collected_data = {}
        
        # Collect from Amazon APIs
        if self.amazon_collector:
            try:
                # Get date range (last 30 days)
                end_date = datetime.now().strftime("%Y-%m-%d")
                start_date = (datetime.now() - timedelta(days=30)).strftime("%Y-%m-%d")
                
                # Collect inventory ledger
                inventory_df = self.amazon_collector.get_inventory_ledger(start_date, end_date)
                if not inventory_df.empty:
                    collected_data['inventory_ledger'] = inventory_df
                
                # Collect reimbursements
                reimbursements_df = self.amazon_collector.get_reimbursements(start_date, end_date)
                if not reimbursements_df.empty:
                    collected_data['reimbursements'] = reimbursements_df
                
                # Collect shipments
                shipments_df = self.amazon_collector.get_fba_inbound_shipments(start_date, end_date)
                if not shipments_df.empty:
                    collected_data['shipments'] = shipments_df
                    
            except Exception as e:
                logger.error(f"❌ Amazon API collection failed: {e}")
        
        # Collect from Seller Central exports
        try:
            export_files = list(self.seller_central_collector.export_directory.glob("*.csv"))
            
            for file_path in export_files:
                file_name = file_path.name.lower()
                
                if 'inventory' in file_name or 'ledger' in file_name:
                    df = self.seller_central_collector.parse_inventory_ledger_export(str(file_path))
                    if not df.empty:
                        collected_data[f'inventory_ledger_export_{file_path.stem}'] = df
                
                elif 'reimbursement' in file_name:
                    df = self.seller_central_collector.parse_reimbursements_export(str(file_path))
                    if not df.empty:
                        collected_data[f'reimbursements_export_{file_path.stem}'] = df
                
                elif 'shipment' in file_name:
                    df = self.seller_central_collector.parse_shipments_export(str(file_path))
                    if not df.empty:
                        collected_data[f'shipments_export_{file_path.stem}'] = df
                        
        except Exception as e:
            logger.error(f"❌ Seller Central export collection failed: {e}")
        
        logger.info(f"✅ Data collection completed. Collected {len(collected_data)} datasets")
        return collected_data
    
    def store_collected_data(self, collected_data: Dict[str, pd.DataFrame]) -> bool:
        """Store collected data to database"""
        try:
            logger.info("💾 Storing collected data to database...")
            
            for source_name, df in collected_data.items():
                if df.empty:
                    continue
                
                # Store to appropriate table based on data type
                if 'inventory_ledger' in source_name:
                    self._store_inventory_ledger(df)
                elif 'reimbursements' in source_name:
                    self._store_reimbursements(df)
                elif 'shipments' in source_name:
                    self._store_shipments(df)
            
            logger.info("✅ Data storage completed successfully")
            return True
            
        except Exception as e:
            logger.error(f"❌ Data storage failed: {e}")
            return False
    
    def _store_inventory_ledger(self, df: pd.DataFrame):
        """Store inventory ledger data to database"""
        # Implementation would use SQLAlchemy or similar ORM
        # For now, just log the action
        logger.info(f"📊 Storing {len(df)} inventory ledger records")
    
    def _store_reimbursements(self, df: pd.DataFrame):
        """Store reimbursements data to database"""
        logger.info(f"📊 Storing {len(df)} reimbursement records")
    
    def _store_shipments(self, df: pd.DataFrame):
        """Store shipments data to database"""
        logger.info(f"📊 Storing {len(df)} shipment records")
    
    def run_collection_pipeline(self) -> bool:
        """Run the complete data collection pipeline"""
        try:
            logger.info("🔄 Starting data collection pipeline...")
            
            # Collect data from all sources
            collected_data = asyncio.run(self.collect_all_data())
            
            if not collected_data:
                logger.warning("⚠️ No data collected from any source")
                return False
            
            # Store collected data
            storage_success = self.store_collected_data(collected_data)
            
            if storage_success:
                logger.info("🎉 Data collection pipeline completed successfully")
                return True
            else:
                logger.error("❌ Data collection pipeline failed at storage step")
                return False
                
        except Exception as e:
            logger.error(f"❌ Data collection pipeline failed: {e}")
            return False

# Example usage and testing
if __name__ == "__main__":
    # Example configuration (replace with actual values)
    amazon_config = AmazonAPIConfig(
        marketplace_id="ATVPDKIKX0DER",  # US marketplace
        seller_id="YOUR_SELLER_ID",
        access_key="YOUR_ACCESS_KEY",
        secret_key="YOUR_SECRET_KEY",
        role_arn="YOUR_ROLE_ARN",
        refresh_token="YOUR_REFRESH_TOKEN"
    )
    
    # Initialize orchestrator
    orchestrator = DataCollectionOrchestrator(
        db_connection=None,  # Replace with actual DB connection
        amazon_config=amazon_config
    )
    
    # Run collection pipeline
    success = orchestrator.run_collection_pipeline()
    
    if success:
        print("✅ Data collection completed successfully!")
    else:
        print("❌ Data collection failed!")

