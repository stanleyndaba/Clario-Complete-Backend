import path from 'path';
import dotenv from 'dotenv';
import { csvIngestionService } from '../services/csvIngestionService';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

async function run(): Promise<void> {
  const userId = process.argv[2];
  if (!userId) {
    throw new Error('Usage: ts-node src/scripts/forensic-test-csv-ingestion.ts <userId>');
  }

  const orderId = `FORENSIC_ORDER_${Date.now()}`;
  const csv = [
    'AmazonOrderId,PurchaseDate,OrderStatus,OrderTotal,CurrencyCode,FulfillmentChannel',
    `${orderId},2026-03-18T00:00:00Z,Shipped,19.99,USD,FBA`,
  ].join('\n');

  const result = await csvIngestionService.ingestFiles(
    userId,
    [
      {
        buffer: Buffer.from(csv, 'utf-8'),
        originalname: 'forensic_orders.csv',
        mimetype: 'text/csv',
      },
    ],
    {
      explicitType: 'orders',
      triggerDetection: false,
    }
  );

  console.log(JSON.stringify({ testOrderId: orderId, result }, null, 2));
}

run().catch((error) => {
  console.error(`ERROR: ${error.message}`);
  process.exit(1);
});
