const fs = require('fs');

const orderIds = [
    '112-4199824-318218',
    '112-4461734-5576',
    '112-8624972-785835',
    '112-3827267-0612096',
    '112-5337136-0931119'
];

orderIds.forEach((orderId, i) => {
    const content = `Amazon Invoice
Date: December 26, 2024
Order ID: ${orderId}

This is a test invoice document for Amazon order ${orderId}.
Amount: $${(100 + i * 50).toFixed(2)}
SKU: TEST-SKU-00${i + 1}
ASIN: B0TEST${String(i + 1).padStart(5, '0')}

Thank you for your purchase.
`;
    fs.writeFileSync(`test_claim_doc_${i + 1}.txt`, content);
    console.log(`Created: test_claim_doc_${i + 1}.txt with Order ID: ${orderId}`);
});

console.log('\n5 test documents created. Upload these to the Evidence Locker.');
