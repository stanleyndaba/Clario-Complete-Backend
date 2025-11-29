/**
 * CSV Import Script for 50K Dataset
 * 
 * Imports CSV files from ZIP into database tables:
 * - orders.csv → orders table
 * - shipments.csv → shipments table  
 * - returns.csv → returns table
 * - settlements.csv → settlements table
 * - inventory_adjustments.csv → inventory table
 * - fee_events.csv → financial_events table
 * 
 * Usage:
 *   npm run import:csv -- --zip path/to/data.zip --userId user-123
 *   npm run import:csv -- --dir path/to/csv/files --userId user-123
 */

import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { parse as csvParse } from 'csv-parse/sync';
import { createReadStream } from 'fs';
import { pipeline } from 'stream/promises';
import { supabaseAdmin, supabase } from '../src/database/supabaseClient';
import logger from '../src/utils/logger';

const BATCH_SIZE = 1000; // Insert 1000 records at a time

interface ImportOptions {
  zipPath?: string;
  csvDir?: string;
  userId: string;
  verbose?: boolean;
}

interface ImportResult {
  success: boolean;
  orders: number;
  shipments: number;
  returns: number;
  settlements: number;
  inventory: number;
  feeEvents: number;
  errors: string[];
  duration: number;
}

/**
 * Extract ZIP file to temporary directory
 */
async function extractZip(zipPath: string, extractDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const AdmZip = require('adm-zip');
    const zip = new AdmZip(zipPath);
    
    try {
      zip.extractAllTo(extractDir, true);
      logger.info(`✅ Extracted ZIP to ${extractDir}`);
      resolve();
    } catch (error: any) {
      logger.error(`❌ Failed to extract ZIP: ${error.message}`);
      reject(error);
    }
  });
}

/**
 * Parse CSV file
 */
function parseCSV(filePath: string): any[] {
  try {
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    const records = csvParse(fileContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      cast: (value, context) => {
        // Handle JSON columns
        if (context.column === 'items_json' && value) {
          try {
            return JSON.parse(value);
          } catch {
            return value; // Return as string if not valid JSON
          }
        }
        return value;
      }
    });
    
    logger.info(`📄 Parsed ${records.length} records from ${path.basename(filePath)}`);
    return records;
  } catch (error: any) {
    logger.error(`❌ Failed to parse CSV ${filePath}: ${error.message}`);
    throw error;
  }
}

/**
 * Import orders into database
 */
async function importOrders(records: any[], userId: string): Promise<number> {
  const totalBatches = Math.ceil(records.length / BATCH_SIZE);
  let imported = 0;
  
  logger.info(`📦 Importing ${records.length} orders in ${totalBatches} batches...`);
  
  for (let i = 0; i < totalBatches; i++) {
    const batch = records.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE);
    
    // Transform CSV records to database format
    const dbRecords = batch.map((record: any) => ({
      order_id: record.order_id,
      seller_id: userId,
      marketplace_id: record.marketplace_id || 'US',
      order_date: record.order_date || new Date().toISOString(),
      fulfillment_channel: 'FBA',
      status: 'Shipped',
      total_amount: parseFloat(record.total_amount || '0'),
      total_fees: parseFloat(record.total_fees || '0'),
      shipping_cost: parseFloat(record.shipping_cost || '0'),
      currency: record.currency || 'USD',
      fulfillment_center: record.fulfillment_center || 'DEFAULT',
      metadata: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }));
    
    const client = supabaseAdmin || supabase;
    if (!client || typeof client.from !== 'function') {
      throw new Error('Supabase client not initialized. Check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables.');
    }
    
    const { error } = await client
      .from('orders')
      .upsert(dbRecords, { onConflict: 'order_id,seller_id' });
    
    if (error) {
      logger.error(`❌ Failed to import orders batch ${i + 1}/${totalBatches}: ${error.message}`);
      throw error;
    }
    
    imported += dbRecords.length;
    logger.info(`✅ Imported orders batch ${i + 1}/${totalBatches} (${imported}/${records.length})`);
  }
  
  return imported;
}

/**
 * Import shipments into database
 */
async function importShipments(records: any[], userId: string): Promise<number> {
  const totalBatches = Math.ceil(records.length / BATCH_SIZE);
  let imported = 0;
  
  logger.info(`🚚 Importing ${records.length} shipments in ${totalBatches} batches...`);
  
  for (let i = 0; i < totalBatches; i++) {
    const batch = records.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE);
    
    const dbRecords = batch.map((record: any) => {
      // Parse items_json if it's a string
      let items = [];
      if (record.items_json) {
        try {
          items = typeof record.items_json === 'string' 
            ? JSON.parse(record.items_json) 
            : record.items_json;
        } catch {
          items = [];
        }
      }
      
      return {
        shipment_id: record.shipment_id,
        seller_id: userId,
        order_id: record.order_id || record.shipment_id,
        shipped_date: record.shipped_date || new Date().toISOString(),
        status: record.status || 'UNKNOWN',
        missing_quantity: parseInt(record.missing_quantity || '0'),
        expected_quantity: parseInt(record.expected_quantity || '0'),
        received_quantity: parseInt(record.received_quantity || '0'),
        fulfillment_center: record.fulfillment_center || 'DEFAULT',
        shipping_cost: parseFloat(record.shipping_cost || '0'),
        items: items,
        metadata: {},
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
    });
    
    const client = supabaseAdmin || supabase;
    const { error } = await client
      .from('shipments')
      .upsert(dbRecords, { onConflict: 'shipment_id,seller_id' });
    
    if (error) {
      logger.error(`❌ Failed to import shipments batch ${i + 1}/${totalBatches}: ${error.message}`);
      throw error;
    }
    
    imported += dbRecords.length;
    logger.info(`✅ Imported shipments batch ${i + 1}/${totalBatches} (${imported}/${records.length})`);
  }
  
  return imported;
}

/**
 * Import returns into database
 */
async function importReturns(records: any[], userId: string): Promise<number> {
  const totalBatches = Math.ceil(records.length / BATCH_SIZE);
  let imported = 0;
  
  logger.info(`↩️ Importing ${records.length} returns in ${totalBatches} batches...`);
  
  for (let i = 0; i < totalBatches; i++) {
    const batch = records.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE);
    
    const dbRecords = batch.map((record: any) => {
      // Parse items_json if it's a string
      let items = [];
      if (record.items_json) {
        try {
          items = typeof record.items_json === 'string' 
            ? JSON.parse(record.items_json) 
            : record.items_json;
        } catch {
          items = [];
        }
      }
      
      return {
        return_id: record.return_id,
        seller_id: userId,
        order_id: record.order_id || record.return_id,
        returned_date: record.returned_date || new Date().toISOString(),
        refund_amount: parseFloat(record.refund_amount || '0'),
        fulfillment_center: record.fulfillment_center || 'DEFAULT',
        currency: record.currency || 'USD',
        items: items,
        metadata: {},
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
    });
    
    const client = supabaseAdmin || supabase;
    const { error } = await client
      .from('returns')
      .upsert(dbRecords, { onConflict: 'return_id,seller_id' });
    
    if (error) {
      logger.error(`❌ Failed to import returns batch ${i + 1}/${totalBatches}: ${error.message}`);
      throw error;
    }
    
    imported += dbRecords.length;
    logger.info(`✅ Imported returns batch ${i + 1}/${totalBatches} (${imported}/${records.length})`);
  }
  
  return imported;
}

/**
 * Import settlements into database
 */
async function importSettlements(records: any[], userId: string): Promise<number> {
  const totalBatches = Math.ceil(records.length / BATCH_SIZE);
  let imported = 0;
  
  logger.info(`💰 Importing ${records.length} settlements in ${totalBatches} batches...`);
  
  for (let i = 0; i < totalBatches; i++) {
    const batch = records.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE);
    
    const dbRecords = batch.map((record: any) => ({
      settlement_id: record.settlement_id,
      seller_id: userId,
      order_id: record.order_id || record.settlement_id,
      settlement_date: record.settlement_date || new Date().toISOString(),
      amount: parseFloat(record.amount || '0'),
      fees: parseFloat(record.fees || '0'),
      currency: record.currency || 'USD',
      metadata: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }));
    
    const client = supabaseAdmin || supabase;
    const { error } = await client
      .from('settlements')
      .upsert(dbRecords, { onConflict: 'settlement_id,seller_id' });
    
    if (error) {
      logger.error(`❌ Failed to import settlements batch ${i + 1}/${totalBatches}: ${error.message}`);
      throw error;
    }
    
    imported += dbRecords.length;
    logger.info(`✅ Imported settlements batch ${i + 1}/${totalBatches} (${imported}/${records.length})`);
  }
  
  return imported;
}

/**
 * Import inventory into database
 */
async function importInventory(records: any[], userId: string): Promise<number> {
  const totalBatches = Math.ceil(records.length / BATCH_SIZE);
  let imported = 0;
  
  logger.info(`📦 Importing ${records.length} inventory records in ${totalBatches} batches...`);
  
  for (let i = 0; i < totalBatches; i++) {
    const batch = records.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE);
    
    const dbRecords = batch.map((record: any) => ({
      sku: record.sku,
      seller_id: userId,
      asin: record.asin,
      quantity: parseInt(record.quantity || '0'),
      fulfillment_center: record.fulfillment_center || 'DEFAULT',
      last_updated: record.last_updated || new Date().toISOString(),
      adjustment_type: record.adjustment_type || null,
      adjustment_amount: record.adjustment_amount ? parseFloat(record.adjustment_amount) : null,
      metadata: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }));
    
    const client = supabaseAdmin || supabase;
    const { error } = await client
      .from('inventory')
      .upsert(dbRecords, { onConflict: 'sku,seller_id,fulfillment_center' });
    
    if (error) {
      logger.error(`❌ Failed to import inventory batch ${i + 1}/${totalBatches}: ${error.message}`);
      throw error;
    }
    
    imported += dbRecords.length;
    logger.info(`✅ Imported inventory batch ${i + 1}/${totalBatches} (${imported}/${records.length})`);
  }
  
  return imported;
}

/**
 * Import fee events into financial_events table
 */
async function importFeeEvents(records: any[], userId: string): Promise<number> {
  const totalBatches = Math.ceil(records.length / BATCH_SIZE);
  let imported = 0;
  
  logger.info(`💳 Importing ${records.length} fee events in ${totalBatches} batches...`);
  
  for (let i = 0; i < totalBatches; i++) {
    const batch = records.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE);
    
    const dbRecords = batch.map((record: any) => ({
      seller_id: userId,
      event_type: 'fee',
      amount: parseFloat(record.fee_amount || '0'),
      currency: record.currency || 'USD',
      amazon_event_id: record.event_id,
      amazon_order_id: record.order_id,
      event_date: record.event_date || new Date().toISOString(),
      raw_payload: {
        fee_type: record.fee_type,
        description: record.description,
        event_type: record.event_type
      },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }));
    
    const client = supabaseAdmin || supabase;
    const { error } = await client
      .from('financial_events')
      .insert(dbRecords);
    
    if (error) {
      logger.error(`❌ Failed to import fee events batch ${i + 1}/${totalBatches}: ${error.message}`);
      throw error;
    }
    
    imported += dbRecords.length;
    logger.info(`✅ Imported fee events batch ${i + 1}/${totalBatches} (${imported}/${records.length})`);
  }
  
  return imported;
}

/**
 * Main import function
 */
async function importCSVData(options: ImportOptions): Promise<ImportResult> {
  const startTime = Date.now();
  const errors: string[] = [];
  const result: ImportResult = {
    success: false,
    orders: 0,
    shipments: 0,
    returns: 0,
    settlements: 0,
    inventory: 0,
    feeEvents: 0,
    errors: [],
    duration: 0
  };
  
  let csvDir = options.csvDir;
  const tempDir = path.join(__dirname, '../temp_csv_extract');
  
  try {
    // Extract ZIP if provided
    if (options.zipPath) {
      logger.info(`📦 Extracting ZIP file: ${options.zipPath}`);
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }
      await extractZip(options.zipPath, tempDir);
      csvDir = tempDir;
    }
    
    if (!csvDir || !fs.existsSync(csvDir)) {
      throw new Error(`CSV directory not found: ${csvDir}`);
    }
    
    logger.info(`📂 Reading CSV files from: ${csvDir}`);
    
    // Import each CSV file
    const csvFiles = {
      orders: path.join(csvDir, 'orders.csv'),
      shipments: path.join(csvDir, 'shipments.csv'),
      returns: path.join(csvDir, 'returns.csv'),
      settlements: path.join(csvDir, 'settlements.csv'),
      inventory: path.join(csvDir, 'inventory_adjustments.csv'),
      feeEvents: path.join(csvDir, 'fee_events.csv')
    };
    
    // Import orders
    if (fs.existsSync(csvFiles.orders)) {
      try {
        const records = parseCSV(csvFiles.orders);
        result.orders = await importOrders(records, options.userId);
      } catch (error: any) {
        errors.push(`Orders: ${error.message}`);
        logger.error(`❌ Failed to import orders: ${error.message}`);
      }
    } else {
      logger.warn(`⚠️ orders.csv not found, skipping...`);
    }
    
    // Import shipments
    if (fs.existsSync(csvFiles.shipments)) {
      try {
        const records = parseCSV(csvFiles.shipments);
        result.shipments = await importShipments(records, options.userId);
      } catch (error: any) {
        errors.push(`Shipments: ${error.message}`);
        logger.error(`❌ Failed to import shipments: ${error.message}`);
      }
    } else {
      logger.warn(`⚠️ shipments.csv not found, skipping...`);
    }
    
    // Import returns
    if (fs.existsSync(csvFiles.returns)) {
      try {
        const records = parseCSV(csvFiles.returns);
        result.returns = await importReturns(records, options.userId);
      } catch (error: any) {
        errors.push(`Returns: ${error.message}`);
        logger.error(`❌ Failed to import returns: ${error.message}`);
      }
    } else {
      logger.warn(`⚠️ returns.csv not found, skipping...`);
    }
    
    // Import settlements
    if (fs.existsSync(csvFiles.settlements)) {
      try {
        const records = parseCSV(csvFiles.settlements);
        result.settlements = await importSettlements(records, options.userId);
      } catch (error: any) {
        errors.push(`Settlements: ${error.message}`);
        logger.error(`❌ Failed to import settlements: ${error.message}`);
      }
    } else {
      logger.warn(`⚠️ settlements.csv not found, skipping...`);
    }
    
    // Import inventory
    if (fs.existsSync(csvFiles.inventory)) {
      try {
        const records = parseCSV(csvFiles.inventory);
        result.inventory = await importInventory(records, options.userId);
      } catch (error: any) {
        errors.push(`Inventory: ${error.message}`);
        logger.error(`❌ Failed to import inventory: ${error.message}`);
      }
    } else {
      logger.warn(`⚠️ inventory_adjustments.csv not found, skipping...`);
    }
    
    // Import fee events
    if (fs.existsSync(csvFiles.feeEvents)) {
      try {
        const records = parseCSV(csvFiles.feeEvents);
        result.feeEvents = await importFeeEvents(records, options.userId);
      } catch (error: any) {
        errors.push(`Fee Events: ${error.message}`);
        logger.error(`❌ Failed to import fee events: ${error.message}`);
      }
    } else {
      logger.warn(`⚠️ fee_events.csv not found, skipping...`);
    }
    
    // Clean up temp directory
    if (options.zipPath && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
      logger.info(`🧹 Cleaned up temporary directory`);
    }
    
    result.success = errors.length === 0;
    result.errors = errors;
    result.duration = Date.now() - startTime;
    
    const totalImported = result.orders + result.shipments + result.returns + 
                         result.settlements + result.inventory + result.feeEvents;
    
    logger.info(`\n✅ Import Complete!`);
    logger.info(`📊 Summary:`);
    logger.info(`   Orders: ${result.orders.toLocaleString()}`);
    logger.info(`   Shipments: ${result.shipments.toLocaleString()}`);
    logger.info(`   Returns: ${result.returns.toLocaleString()}`);
    logger.info(`   Settlements: ${result.settlements.toLocaleString()}`);
    logger.info(`   Inventory: ${result.inventory.toLocaleString()}`);
    logger.info(`   Fee Events: ${result.feeEvents.toLocaleString()}`);
    logger.info(`   Total: ${totalImported.toLocaleString()} records`);
    logger.info(`   Duration: ${(result.duration / 1000).toFixed(2)}s`);
    
    if (errors.length > 0) {
      logger.warn(`⚠️ ${errors.length} errors occurred during import`);
    }
    
    return result;
    
  } catch (error: any) {
    logger.error(`❌ Import failed: ${error.message}`);
    result.errors.push(error.message);
    result.success = false;
    result.duration = Date.now() - startTime;
    return result;
  }
}

// CLI execution
if (require.main === module) {
  const args = process.argv.slice(2);
  const options: ImportOptions = {
    userId: 'demo-user' // Default, should be overridden
  };
  
  // Debug: log all arguments
  if (process.env.DEBUG) {
    console.log('All process.argv:', process.argv);
    console.log('Args after slice(2):', args);
  }
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];
    
    if (arg === '--zip' && nextArg) {
      options.zipPath = nextArg;
      i++;
    } else if (arg === '--dir' && nextArg) {
      options.csvDir = nextArg;
      i++;
    } else if (arg === '--userId' && nextArg) {
      options.userId = nextArg;
      i++;
    } else if (arg === '--verbose') {
      options.verbose = true;
    } else if (!arg.startsWith('--') && !options.zipPath && !options.csvDir) {
      // If first non-flag argument and no zip/dir set, assume it's the zip path
      options.zipPath = arg;
    }
  }
  
  if (!options.userId) {
    console.error('❌ Error: --userId is required');
    process.exit(1);
  }
  
  if (!options.zipPath && !options.csvDir) {
    console.error('❌ Error: Either --zip or --dir must be provided');
    console.error('Usage: npm run import:csv -- --zip path/to/file.zip --userId user-id');
    process.exit(1);
  }
  
  importCSVData(options)
    .then((result) => {
      if (result.success) {
        console.log('\n✅ Import successful!');
        process.exit(0);
      } else {
        console.log('\n⚠️ Import completed with errors');
        process.exit(1);
      }
    })
    .catch((error) => {
      console.error(`\n❌ Import failed: ${error.message}`);
      process.exit(1);
    });
}

export { importCSVData };

