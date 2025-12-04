const fs = require('fs');
const path = require('path');

// Try to load dependencies, install if missing
let FormData, axios;
try {
  FormData = require('form-data');
  axios = require('axios');
} catch (error) {
  console.error('❌ Missing dependencies. Installing...');
  console.error('   Run: npm install form-data axios');
  process.exit(1);
}

// Configuration
const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';
const USER_ID = process.env.USER_ID || 'demo-user';

// PDF files to upload
const PDF_FILES = [
  'invoice-001.pdf',
  'invoice-002.pdf',
  'pod-001.pdf'
];

async function uploadPDF(filePath, fileName) {
  try {
    console.log(`\n📤 Uploading ${fileName}...`);
    
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      console.error(`❌ File not found: ${filePath}`);
      return { success: false, error: 'File not found' };
    }

    // Create FormData
    const formData = new FormData();
    const fileStream = fs.createReadStream(filePath);
    
    formData.append('file', fileStream, {
      filename: fileName,
      contentType: 'application/pdf'
    });

    // Upload to evidence endpoint
    const uploadUrl = `${API_BASE_URL}/api/evidence/upload`;
    
    console.log(`   → POST ${uploadUrl}`);
    const fileSize = (fs.statSync(filePath).size / 1024).toFixed(2);
    console.log(`   → File: ${fileName} (${fileSize} KB)`);

    const response = await axios.post(uploadUrl, formData, {
      headers: {
        ...formData.getHeaders(),
        'X-User-Id': USER_ID,
      },
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      timeout: 60000, // 60 seconds
    });

    if (response.data.success) {
      console.log(`✅ Successfully uploaded ${fileName}`);
      const docId = response.data.documentId || response.data.document?.id || 'N/A';
      console.log(`   → Document ID: ${docId}`);
      return { success: true, data: response.data };
    } else {
      console.error(`❌ Upload failed for ${fileName}:`, response.data.error || 'Unknown error');
      return { success: false, error: response.data.error };
    }
  } catch (error) {
    const errorMsg = error.response?.data || error.message;
    console.error(`❌ Error uploading ${fileName}:`, errorMsg);
    return { 
      success: false, 
      error: error.response?.data?.error || error.message 
    };
  }
}

async function main() {
  console.log('🚀 Starting PDF upload test...');
  console.log(`📁 API Base URL: ${API_BASE_URL}`);
  console.log(`👤 User ID: ${USER_ID}`);
  console.log(`📄 Files to upload: ${PDF_FILES.length}`);

  const testDocsDir = __dirname;
  const results = [];

  for (const fileName of PDF_FILES) {
    const filePath = path.join(testDocsDir, fileName);
    const result = await uploadPDF(filePath, fileName);
    results.push({ fileName, ...result });
    
    // Small delay between uploads
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  // Summary
  console.log('\n📊 Upload Summary:');
  console.log('='.repeat(50));
  const successful = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  
  results.forEach(result => {
    const status = result.success ? '✅' : '❌';
    console.log(`${status} ${result.fileName}`);
    if (result.error) {
      console.log(`   Error: ${result.error}`);
    }
  });

  console.log('\n' + '='.repeat(50));
  console.log(`✅ Successful: ${successful}/${PDF_FILES.length}`);
  console.log(`❌ Failed: ${failed}/${PDF_FILES.length}`);
  
  if (successful > 0) {
    console.log('\n💡 Next steps:');
    console.log('   1. Check the Evidence Locker page to see uploaded documents');
    console.log('   2. Watch the Document Activity log for parsing events');
    console.log('   3. Wait for the matching worker (runs every 3 minutes)');
    console.log('   4. Check the Recoveries page to see if documents matched to claims');
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(error => {
  console.error('💥 Fatal error:', error);
  process.exit(1);
});
