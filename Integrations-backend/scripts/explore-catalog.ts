import axios from 'axios';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env') });

const endpoint = process.env.SP_API_ENDPOINT || 'https://sellingpartnerapi-na.amazon.com';
const marketplaceId = process.env.AMAZON_MARKETPLACE_ID || 'ATVPDKIKX0DER';

async function getLwaAccessToken() {
    const clientId = process.env.AMAZON_CLIENT_ID || process.env.AMAZON_SPAPI_CLIENT_ID;
    const clientSecret = process.env.AMAZON_CLIENT_SECRET || process.env.AMAZON_SPAPI_CLIENT_SECRET;
    const refreshToken = process.env.AMAZON_SPAPI_REFRESH_TOKEN || process.env.AMAZON_REFRESH_TOKEN;

    const response = await axios.post('https://api.amazon.com/auth/o2/token',
        new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: refreshToken!,
            client_id: clientId!,
            client_secret: clientSecret!
        }),
        { headers: { 'content-type': 'application/x-www-form-urlencoded' } }
    );
    return response.data.access_token;
}

async function searchCatalog(token: string, keyword: string) {
    console.log(`\n==================================================`);
    console.log(`🔍 Searching Amazon Catalog for: "${keyword}"`);
    console.log(`==================================================`);
    
    const qs = new URLSearchParams({
        marketplaceIds: marketplaceId,
        keywords: keyword,
        pageSize: '1', // We only need the top result to show an example
        includedData: 'summaries,attributes,dimensions' // Ask for rich data
    });
    
    const response = await axios.get(`${endpoint}/catalog/2022-04-01/items?${qs.toString()}`, {
        headers: {
            'Authorization': `Bearer ${token}`,
            'x-amz-access-token': token,
        }
    });
    
    console.log(`✅ Total matching products on Amazon: ${response.data.numberOfResults.toLocaleString()}`);
    
    if (response.data.items && response.data.items.length > 0) {
        const topItem = response.data.items[0];
        console.log(`\n📦 #1 Top Result Snapshot:`);
        console.log(`- ASIN (Amazon ID): ${topItem.asin}`);
        
        if (topItem.summaries && topItem.summaries[0]) {
            console.log(`- Product Name:   ${topItem.summaries[0].itemName}`);
            console.log(`- Brand:          ${topItem.summaries[0].brand}`);
            console.log(`- Category:       ${topItem.summaries[0].browseClassification?.displayName || 'N/A'}`);
        }
    }
}

async function main() {
    try {
        const token = await getLwaAccessToken();
        
        // Let's search for a few different things
        await searchCatalog(token, 'iphone case');
        await searchCatalog(token, 'coffee maker');
        await searchCatalog(token, 'shoes');
        
    } catch (error: any) {
        console.error("Error:", error.response?.data || error.message);
    }
}

main();
