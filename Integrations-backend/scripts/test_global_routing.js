
const marketplaces = [
    { id: 'ATVPDKIKX0DER', name: 'USA (NA)' },
    { id: 'ARE699S9C6Y0F', name: 'South Africa (EU/ZA)' },
    { id: 'A1PA6795UKMFR9', name: 'Germany (EU)' },
    { id: 'A1VC38T7YXB528', name: 'Japan (FE)' }
];

const MARKETPLACE_TO_REGION = {
    'ATVPDKIKX0DER': 'https://sellingpartnerapi-na.amazon.com',
    'ARE699S9C6Y0F': 'https://sellingpartnerapi-eu.amazon.com',
    'A1PA6795UKMFR9': 'https://sellingpartnerapi-eu.amazon.com',
    'A1VC38T7YXB528': 'https://sellingpartnerapi-fe.amazon.com',
};

function simulateOAuthUrl(marketplaceId) {
    let oauthBase = 'https://sellercentral.amazon.com/apps/authorize/consent';
    const region = MARKETPLACE_TO_REGION[marketplaceId];

    if (marketplaceId === 'ARE699S9C6Y0F') {
        oauthBase = 'https://sellercentral.amazon.co.za/apps/authorize/consent';
    } else if (region?.includes('eu')) {
        oauthBase = 'https://sellercentral-europe.amazon.com/apps/authorize/consent';
    } else if (region?.includes('fe')) {
        oauthBase = 'https://sellercentral-japan.amazon.co.jp/apps/authorize/consent';
    }

    return oauthBase;
}

console.log('--- GLOBAL OAUTH ROUTING TEST ---');
marketplaces.forEach(m => {
    console.log(`Marketplace: ${m.name} [ID: ${m.id}]`);
    console.log(`Endpoint:    ${simulateOAuthUrl(m.id)}`);
    console.log('---------------------------------');
});
