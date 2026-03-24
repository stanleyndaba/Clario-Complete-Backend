import 'dotenv/config';
import { fetchTransferRecords } from './src/services/detection/core/detectors/warehouseTransferLossAlgorithm';

async function main() {
  const userId = process.env.CSV_TEST_USER_ID || 'cf6d8078-e83a-472a-baf5-d241eb7ab36e';
  const short = await fetchTransferRecords(userId);
  const wide = await fetchTransferRecords(userId, { lookbackDays: 1000 });
  console.log(JSON.stringify({ shortCount: short.length, wideCount: wide.length, sample: wide.slice(0,2) }, null, 2));
}
main().catch(err => { console.error(err); process.exit(1); });
