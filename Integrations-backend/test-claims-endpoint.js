#!/usr/bin/env node

/**
 * Test script to verify the Amazon claims endpoint fix
 * 
 * This script tests the /api/v1/integrations/amazon/claims endpoint
 * to verify it returns the safe fallback response (success: true)
 * instead of the old error response.
 * 
 * Usage:
 *   node test-claims-endpoint.js [url]
 * 
 * Examples:
 *   node test-claims-endpoint.js                          # Test localhost
 *   node test-claims-endpoint.js http://localhost:3001   # Test localhost with port
 *   node test-claims-endpoint.js https://opside-node-api-new.onrender.com  # Test deployed service
 */

const http = require('http');
const https = require('https');

// Get URL from command line or use default
const baseUrl = process.argv[2] || 'http://localhost:3001';
const endpoint = '/api/v1/integrations/amazon/claims';
const fullUrl = `${baseUrl}${endpoint}`;

console.log('🧪 Testing Amazon Claims Endpoint Fix');
console.log('═'.repeat(60));
console.log(`📍 URL: ${fullUrl}`);
console.log('');

// Determine if URL is HTTPS or HTTP
const isHttps = fullUrl.startsWith('https://');
const client = isHttps ? https : http;

// Parse URL
const urlObj = new URL(fullUrl);

const options = {
  hostname: urlObj.hostname,
  port: urlObj.port || (isHttps ? 443 : 80),
  path: urlObj.pathname + urlObj.search,
  method: 'GET',
  headers: {
    'Content-Type': 'application/json',
    'User-Agent': 'Claims-Endpoint-Test-Script/1.0'
  },
  timeout: 10000 // 10 second timeout
};

console.log('📡 Sending request...');
console.log('');

const startTime = Date.now();

const req = client.request(options, (res) => {
  const elapsed = Date.now() - startTime;
  
  console.log(`📊 Response Status: ${res.statusCode} ${res.statusMessage}`);
  console.log(`⏱️  Response Time: ${elapsed}ms`);
  console.log('');
  
  let data = '';
  
  res.on('data', (chunk) => {
    data += chunk;
  });
  
  res.on('end', () => {
    console.log('📦 Response Body:');
    console.log('─'.repeat(60));
    
    try {
      const json = JSON.parse(data);
      console.log(JSON.stringify(json, null, 2));
      console.log('');
      console.log('─'.repeat(60));
      console.log('');
      
      // Verify the response
      console.log('✅ Verification Results:');
      console.log('');
      
      // Check 1: Status code should be 200
      if (res.statusCode === 200) {
        console.log('✅ Status Code: 200 OK');
      } else {
        console.log(`❌ Status Code: ${res.statusCode} (expected 200)`);
      }
      
      // Check 2: Response should have success: true
      if (json.success === true) {
        console.log('✅ success: true (fix is working!)');
      } else {
        console.log(`❌ success: ${json.success} (expected true)`);
        console.log('   ⚠️  Old broken code is still running!');
      }
      
      // Check 3: Should not have "Failed to fetch claims" error
      if (json.error && json.error.includes('Failed to fetch claims')) {
        console.log('❌ Error message: "Failed to fetch claims" (old broken code)');
        console.log('   ⚠️  The fix has NOT been deployed!');
      } else if (json.error) {
        console.log(`⚠️  Error message: ${json.error}`);
      } else {
        console.log('✅ No error message (good!)');
      }
      
      // Check 4: Should have claims array
      if (Array.isArray(json.claims)) {
        console.log(`✅ claims: [] (array present, length: ${json.claims.length})`);
      } else {
        console.log(`❌ claims: ${typeof json.claims} (expected array)`);
      }
      
      // Check 5: Should have source field indicating isolated route
      if (json.source === 'isolated_route' || json.source === 'safe_fallback') {
        console.log(`✅ source: "${json.source}" (fix is deployed!)`);
      } else if (json.source) {
        console.log(`⚠️  source: "${json.source}" (different implementation)`);
      } else {
        console.log('⚠️  source: not present (may be old code)');
      }
      
      // Check 6: Should have isSandbox field
      if (json.isSandbox === true) {
        console.log('✅ isSandbox: true');
      } else {
        console.log(`⚠️  isSandbox: ${json.isSandbox}`);
      }
      
      console.log('');
      console.log('═'.repeat(60));
      
      // Final verdict
      if (res.statusCode === 200 && json.success === true && !json.error) {
        console.log('🎉 SUCCESS: The fix is working correctly!');
        console.log('');
        console.log('✅ The endpoint returns success: true');
        console.log('✅ No errors are thrown');
        console.log('✅ Safe fallback is working');
        process.exit(0);
      } else {
        console.log('❌ FAILURE: The fix may not be deployed or working correctly');
        console.log('');
        if (res.statusCode !== 200) {
          console.log(`   Issue: Status code is ${res.statusCode}, expected 200`);
        }
        if (json.success !== true) {
          console.log(`   Issue: success is ${json.success}, expected true`);
        }
        if (json.error) {
          console.log(`   Issue: Error message: ${json.error}`);
        }
        console.log('');
        console.log('💡 Next steps:');
        console.log('   1. Verify the latest commit is deployed');
        console.log('   2. Check Render deployment logs');
        console.log('   3. Verify the route handler code matches the fix');
        process.exit(1);
      }
      
    } catch (error) {
      console.log('❌ Failed to parse JSON response:');
      console.log(data);
      console.log('');
      console.log('Error:', error.message);
      process.exit(1);
    }
  });
});

req.on('error', (error) => {
  console.log('❌ Request Error:');
  console.log('');
  console.log(`   ${error.message}`);
  console.log('');
  console.log('💡 Troubleshooting:');
  console.log('   1. Is the server running?');
  console.log('   2. Is the URL correct?');
  console.log('   3. Is the server accessible?');
  console.log('');
  process.exit(1);
});

req.on('timeout', () => {
  console.log('❌ Request Timeout:');
  console.log('');
  console.log('   The server did not respond within 10 seconds');
  console.log('');
  console.log('💡 Troubleshooting:');
  console.log('   1. Is the server running?');
  console.log('   2. Is the server accessible?');
  console.log('   3. Check server logs for errors');
  console.log('');
  req.destroy();
  process.exit(1);
});

req.end();

