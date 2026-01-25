import 'dotenv/config';
import { AmazonService } from '../src/services/amazonService';
import logger from '../src/utils/logger';

// Force Europe Production settings for South Africa marketplace
process.env.AMAZON_SPAPI_BASE_URL = 'https://sellingpartnerapi-eu.amazon.com';
process.env.AMAZON_MARKETPLACE_ID = 'ARE699S9C6Y0F';
process.env.NODE_ENV = 'production';

async function verify() {
    const userId = 'demo-user';
    console.log('🧐 Verifying LIVE SP-API connectivity for', userId);
    console.log('🌍 Target Endpoint:', process.env.AMAZON_SPAPI_BASE_URL);
    console.log('📍 Marketplace:', process.env.AMAZON_MARKETPLACE_ID);

    const amazonService = new AmazonService();

    try {
        console.log('Step 1: Fetching live claims (financial events) from EU endpoint...');
        // Fetch last 90 days to ensure we get something
        const startDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
        const result = await amazonService.fetchClaims(userId, startDate);

        if (result.success) {
            console.log(`\n✅ LIVE CONNECTION VERIFIED!`);
            console.log(`📊 Found ${result.data.length} live financial events in South Africa.`);
            console.log(`🌍 Environment: ${result.environment}`);
            console.log(`📈 Data Source: ${result.dataType}`);

            if (result.data.length > 0) {
                console.log('\nSample Live Event:');
                console.log(JSON.stringify(result.data[0], null, 2));
            } else {
                console.log('\n📝 No events found in the last 90 days, but the connection is active and authorized.');
            }
        } else {
            console.error('\n❌ Connection check returned unsuccessful status.');
        }
    } catch (error: any) {
        console.error('\n💥 LIVE CONNECTION FAILED:');
        console.error(error.message);
        if (error.response) {
            console.error('Amazon Error Details:', JSON.stringify(error.response.data, null, 2));
        }
    }
}

verify();
