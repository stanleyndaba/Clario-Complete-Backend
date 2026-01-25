import 'dotenv/config';
import { AmazonService } from '../src/services/amazonService';
import logger from '../src/utils/logger';

// Force Europe Production settings for South Africa marketplace check
process.env.AMAZON_SPAPI_BASE_URL = 'https://sellingpartnerapi-eu.amazon.com';
process.env.AMAZON_MARKETPLACE_ID = 'ARE699S9C6Y0F'; // South Africa (ZA) / Germany (DE) in EU region
process.env.NODE_ENV = 'production';

async function verifyLiveFlow() {
    const userId = 'demo-user';
    console.log('\n🚀 INITIATING LIVE SP-API DATA FLOW CHECK...');
    console.log('🌍 Regional Endpoint: https://sellingpartnerapi-eu.amazon.com');
    console.log('📍 Starting context: South African Marketplace\n');

    const amazonService = new AmazonService();

    try {
        console.log('Step 1: Authenticating with Regional OAuth Authority...');
        const accessToken = await amazonService.getAccessTokenForService(userId);

        if (accessToken) {
            console.log('✅ Handshake Successful! Access Token obtained.');

            console.log('\nStep 2: Pulling Global Marketplace Participations...');
            const sellersInfo = await amazonService.getSellersInfo(userId);

            if (sellersInfo.success) {
                console.log('\n📊 LIVE CONNECTION VERIFIED!');
                console.log(`🌍 Environment: PRODUCTION`);
                console.log(`📈 Data Source: LIVE_PRODUCTION_DATA`);
                console.log(`👤 Seller ID: ${sellersInfo.seller_info.seller_id}`);
                console.log(`🏪 Store Name: ${sellersInfo.seller_info.seller_name}`);

                console.log(`\n🌎 Connected Marketplaces (${sellersInfo.total_marketplaces}):`);
                sellersInfo.marketplaces.forEach((mp: any) => {
                    const icon = mp.id === 'ARE699S9C6Y0F' ? '🇿🇦' : mp.country_code === 'US' ? '🇺🇸' : mp.country_code === 'GB' ? '🇬🇧' : '🌐';
                    console.log(`   ${icon} ${mp.name} (${mp.country_code}) - ${mp.domain}`);
                });

                console.log('\n🎉 Your system is now "unlocked." Data is flowing through the regional handshake.');
            } else {
                console.error('❌ Failed to pull marketplace data:', sellersInfo.error);
            }
        }
    } catch (error: any) {
        console.error('\n💥 LIVE CONNECTION FAILED:');
        console.error(error.message);
    }
}

verifyLiveFlow();
