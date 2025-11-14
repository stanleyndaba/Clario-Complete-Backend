/**
 * Test script to verify that claims and inventory endpoints return mock data
 * when credentials are missing in sandbox mode
 */

import axios from 'axios';
import logger from '../utils/logger';

const BASE_URL = process.env.INTEGRATIONS_URL || 'http://localhost:3001';
const USER_ID = 'demo-user';

async function testClaimsEndpoint() {
  try {
    logger.info('🧪 Testing Claims Endpoint...');
    const response = await axios.get(`${BASE_URL}/api/v1/integrations/amazon/claims`, {
      headers: {
        'x-user-id': USER_ID,
        'Authorization': 'Bearer test-token'
      }
    });

    logger.info('✅ Claims Endpoint Response:', {
      success: response.data.success,
      claimCount: response.data.claims?.length || 0,
      isMock: response.data.isMock,
      mockScenario: response.data.mockScenario,
      message: response.data.message,
      dataType: response.data.dataType
    });

    if (response.data.claims && response.data.claims.length > 0) {
      logger.info('✅ Claims endpoint returned data!', {
        firstClaim: response.data.claims[0],
        hasIsMock: response.data.claims[0]?.isMock !== undefined,
        hasMockScenario: response.data.claims[0]?.mockScenario !== undefined
      });
    } else {
      logger.warn('⚠️ Claims endpoint returned empty array');
    }

    return response.data;
  } catch (error: any) {
    logger.error('❌ Claims Endpoint Error:', {
      message: error.message,
      response: error.response?.data
    });
    throw error;
  }
}

async function testInventoryEndpoint() {
  try {
    logger.info('🧪 Testing Inventory Endpoint...');
    const response = await axios.get(`${BASE_URL}/api/v1/integrations/amazon/inventory`, {
      headers: {
        'x-user-id': USER_ID,
        'Authorization': 'Bearer test-token'
      }
    });

    logger.info('✅ Inventory Endpoint Response:', {
      success: response.data.success,
      inventoryCount: response.data.inventory?.length || 0,
      isMock: response.data.isMock,
      mockScenario: response.data.mockScenario,
      message: response.data.message,
      dataType: response.data.dataType
    });

    if (response.data.inventory && response.data.inventory.length > 0) {
      logger.info('✅ Inventory endpoint returned data!', {
        firstItem: response.data.inventory[0],
        hasIsMock: response.data.inventory[0]?.isMock !== undefined,
        hasMockScenario: response.data.inventory[0]?.mockScenario !== undefined
      });
    } else {
      logger.warn('⚠️ Inventory endpoint returned empty array');
    }

    return response.data;
  } catch (error: any) {
    logger.error('❌ Inventory Endpoint Error:', {
      message: error.message,
      response: error.response?.data
    });
    throw error;
  }
}

async function main() {
  logger.info('🚀 Starting Endpoint Mock Data Test...');
  logger.info('Environment:', {
    USE_MOCK_DATA_GENERATOR: process.env.USE_MOCK_DATA_GENERATOR,
    MOCK_SCENARIO: process.env.MOCK_SCENARIO,
    MOCK_RECORD_COUNT: process.env.MOCK_RECORD_COUNT,
    BASE_URL
  });

  try {
    const claimsResult = await testClaimsEndpoint();
    const inventoryResult = await testInventoryEndpoint();

    logger.info('📊 Test Summary:', {
      claims: {
        returned: claimsResult.claims?.length || 0,
        isMock: claimsResult.isMock,
        mockScenario: claimsResult.mockScenario
      },
      inventory: {
        returned: inventoryResult.inventory?.length || 0,
        isMock: inventoryResult.isMock,
        mockScenario: inventoryResult.mockScenario
      }
    });

    if ((claimsResult.claims?.length || 0) > 0 && (inventoryResult.inventory?.length || 0) > 0) {
      logger.info('✅ SUCCESS: Both endpoints returned mock data!');
    } else {
      logger.warn('⚠️ WARNING: One or both endpoints returned empty arrays');
      logger.info('💡 Check that USE_MOCK_DATA_GENERATOR is not set to "false"');
    }
  } catch (error: any) {
    logger.error('❌ Test failed:', error.message);
    process.exit(1);
  }
}

main().catch(console.error);

