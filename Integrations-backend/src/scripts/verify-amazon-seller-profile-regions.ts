import path from 'path';
import dotenv from 'dotenv';
import axios from 'axios';
import amazonService from '../services/amazonService';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const REGION_ENDPOINTS = [
  { key: 'na', baseUrl: 'https://sellingpartnerapi-na.amazon.com' },
  { key: 'eu', baseUrl: 'https://sellingpartnerapi-eu.amazon.com' },
  { key: 'fe', baseUrl: 'https://sellingpartnerapi-fe.amazon.com' },
];

const preferredMarketplaceId = process.argv[2] || 'AE08WJ6YKNBMC';

async function main(): Promise<void> {
  console.log(`VERIFY_MARKETPLACE=${preferredMarketplaceId}`);

  let accessToken: string;
  try {
    accessToken = await amazonService.getAccessTokenForService();
    console.log('ACCESS_TOKEN_REFRESH=OK');
  } catch (error: any) {
    console.log(`ACCESS_TOKEN_REFRESH=ERR reason=${error?.message || String(error)}`);
    process.exit(1);
    return;
  }

  for (const region of REGION_ENDPOINTS) {
    const sellersUrl = `${region.baseUrl}/sellers/v1/marketplaceParticipations`;
    try {
      const response = await axios.get(sellersUrl, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'x-amz-access-token': accessToken,
          'Content-Type': 'application/json',
        },
        timeout: 20000,
      });

      const payload = response.data?.payload || response.data;
      const participations = Array.isArray(payload)
        ? payload
        : payload?.marketplaceParticipations || [];
      const marketplaces = participations
        .map((entry: any) => entry?.marketplace?.id || entry?.marketplaceId || entry?.id)
        .filter(Boolean);
      const sellerId =
        participations?.[0]?.participation?.sellerId ||
        participations?.[0]?.sellerId ||
        'unknown';

      console.log(
        `REGION_RESULT region=${region.key} status=${response.status} sellerId=${sellerId} marketplaces=${marketplaces.join(',') || 'none'}`,
      );
    } catch (error: any) {
      const status = error?.response?.status || 'ERR';
      const message =
        error?.response?.data?.errors?.[0]?.message ||
        error?.response?.data?.message ||
        error?.message ||
        'unknown';
      console.log(`REGION_RESULT region=${region.key} status=${status} message=${JSON.stringify(message)}`);
    }
  }

  try {
    const profile = await amazonService.getSellerProfile(accessToken, preferredMarketplaceId);
    console.log(
      `PATCHED_LOOKUP=OK sellerId=${profile.sellerId} marketplaces=${profile.marketplaces.join(',') || 'none'} company=${JSON.stringify(profile.companyName || '')}`,
    );
  } catch (error: any) {
    console.log(`PATCHED_LOOKUP=ERR reason=${error?.message || String(error)}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`FATAL ${error?.message || String(error)}`);
  process.exit(1);
});
