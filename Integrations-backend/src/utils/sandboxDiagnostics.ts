/**
 * Amazon SP-API Sandbox Diagnostics
 * Helps identify why sandbox connection is failing
 */

import axios from 'axios';
import logger from './logger';

export interface DiagnosticResult {
  step: string;
  success: boolean;
  error?: string;
  details?: any;
}

export async function diagnoseSandboxConnection(): Promise<DiagnosticResult[]> {
  const results: DiagnosticResult[] = [];

  // Step 1: Check Environment Variables
  results.push(await checkEnvironmentVariables());

  // Step 2: Check OAuth URL Generation
  results.push(await checkOAuthUrlGeneration());

  // Step 3: Test Token Exchange (if we have a code)
  // This would require a valid authorization code

  // Step 4: Test Token Refresh
  results.push(await testTokenRefresh());

  // Step 5: Test SP-API Endpoint Access
  results.push(await testSPAPIEndpoint());

  return results;
}

async function checkEnvironmentVariables(): Promise<DiagnosticResult> {
  const missing: string[] = [];
  const present: string[] = [];

  const required = [
    'AMAZON_CLIENT_ID',
    'AMAZON_SPAPI_CLIENT_ID',
    'AMAZON_CLIENT_SECRET',
    'AMAZON_SPAPI_CLIENT_SECRET',
    'AMAZON_REDIRECT_URI',
    'AMAZON_SPAPI_REDIRECT_URI',
    'AMAZON_SPAPI_BASE_URL',
    'AMAZON_SPAPI_REFRESH_TOKEN'
  ];

  for (const key of required) {
    if (process.env[key]) {
      present.push(key);
    } else {
      // Check if alternative name exists
      if (key === 'AMAZON_CLIENT_ID' && process.env['AMAZON_SPAPI_CLIENT_ID']) {
        present.push(`${key} (using AMAZON_SPAPI_CLIENT_ID)`);
      } else if (key === 'AMAZON_CLIENT_SECRET' && process.env['AMAZON_SPAPI_CLIENT_SECRET']) {
        present.push(`${key} (using AMAZON_SPAPI_CLIENT_SECRET)`);
      } else if (key === 'AMAZON_REDIRECT_URI' && process.env['AMAZON_SPAPI_REDIRECT_URI']) {
        present.push(`${key} (using AMAZON_SPAPI_REDIRECT_URI)`);
      } else {
        missing.push(key);
      }
    }
  }

  const clientId = process.env.AMAZON_CLIENT_ID || process.env.AMAZON_SPAPI_CLIENT_ID;
  const clientSecret = process.env.AMAZON_CLIENT_SECRET || process.env.AMAZON_SPAPI_CLIENT_SECRET;
  const redirectUri = process.env.AMAZON_REDIRECT_URI || process.env.AMAZON_SPAPI_REDIRECT_URI;
  const baseUrl = process.env.AMAZON_SPAPI_BASE_URL;
  const refreshToken = process.env.AMAZON_SPAPI_REFRESH_TOKEN;

  const isSandbox = baseUrl?.includes('sandbox');

  return {
    step: 'Environment Variables',
    success: !!(clientId && clientSecret && redirectUri && baseUrl),
    details: {
      present,
      missing,
      clientId: clientId ? '✓ Set' : '✗ Missing',
      clientSecret: clientSecret ? '✓ Set' : '✗ Missing',
      redirectUri: redirectUri || '✗ Missing',
      baseUrl: baseUrl || '✗ Missing',
      refreshToken: refreshToken ? '✓ Set' : '✗ Missing (needed after OAuth)',
      isSandbox: isSandbox ? '✓ Sandbox mode' : '✗ Production mode',
      criticalMissing: missing.filter(m => 
        !m.includes('SPAPI') || (m.includes('SPAPI') && !process.env[m.replace('SPAPI_', '')])
      )
    },
    error: missing.length > 0 ? `Missing: ${missing.join(', ')}` : undefined
  };
}

async function checkOAuthUrlGeneration(): Promise<DiagnosticResult> {
  try {
    const clientId = process.env.AMAZON_CLIENT_ID || process.env.AMAZON_SPAPI_CLIENT_ID;
    const redirectUri = process.env.AMAZON_REDIRECT_URI || process.env.AMAZON_SPAPI_REDIRECT_URI ||
      `${process.env.INTEGRATIONS_URL || 'http://localhost:3001'}/api/v1/integrations/amazon/auth/callback`;

    if (!clientId) {
      return {
        step: 'OAuth URL Generation',
        success: false,
        error: 'Client ID not configured'
      };
    }

    const state = 'test-state-123';
    const oauthUrl = `https://www.amazon.com/ap/oa?` +
      `client_id=${encodeURIComponent(clientId)}&` +
      `response_type=code&` +
      `redirect_uri=${encodeURIComponent(redirectUri)}&` +
      `state=${state}`;

    // Validate URL format
    try {
      new URL(oauthUrl);
    } catch (e) {
      return {
        step: 'OAuth URL Generation',
        success: false,
        error: 'Invalid OAuth URL format',
        details: { oauthUrl }
      };
    }

    return {
      step: 'OAuth URL Generation',
      success: true,
      details: {
        oauthUrl: oauthUrl.substring(0, 100) + '...',
        clientId: clientId.substring(0, 20) + '...',
        redirectUri,
        urlLength: oauthUrl.length
      }
    };
  } catch (error: any) {
    return {
      step: 'OAuth URL Generation',
      success: false,
      error: error.message
    };
  }
}

async function testTokenRefresh(): Promise<DiagnosticResult> {
  try {
    const clientId = process.env.AMAZON_CLIENT_ID || process.env.AMAZON_SPAPI_CLIENT_ID;
    const clientSecret = process.env.AMAZON_CLIENT_SECRET || process.env.AMAZON_SPAPI_CLIENT_SECRET;
    const refreshToken = process.env.AMAZON_SPAPI_REFRESH_TOKEN;

    if (!clientId || !clientSecret || !refreshToken) {
      return {
        step: 'Token Refresh Test',
        success: false,
        error: 'Missing credentials for token refresh',
        details: {
          hasClientId: !!clientId,
          hasClientSecret: !!clientSecret,
          hasRefreshToken: !!refreshToken
        }
      };
    }

    // Try to refresh token
    try {
      const response = await axios.post(
        'https://api.amazon.com/auth/o2/token',
        {
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: clientId,
          client_secret: clientSecret,
        },
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: 10000
        }
      );

      if (response.data.access_token) {
        return {
          step: 'Token Refresh Test',
          success: true,
          details: {
            tokenReceived: true,
            expiresIn: response.data.expires_in
          }
        };
      } else {
        return {
          step: 'Token Refresh Test',
          success: false,
          error: 'No access token in response',
          details: response.data
        };
      }
    } catch (error: any) {
      const errorDetails = error.response?.data || {};
      return {
        step: 'Token Refresh Test',
        success: false,
        error: errorDetails.error_description || errorDetails.error || error.message,
        details: {
          status: error.response?.status,
          errorCode: errorDetails.error,
          errorDescription: errorDetails.error_description,
          fullResponse: errorDetails
        }
      };
    }
  } catch (error: any) {
    return {
      step: 'Token Refresh Test',
      success: false,
      error: error.message
    };
  }
}

async function testSPAPIEndpoint(): Promise<DiagnosticResult> {
  try {
    const baseUrl = process.env.AMAZON_SPAPI_BASE_URL;
    if (!baseUrl) {
      return {
        step: 'SP-API Endpoint Test',
        success: false,
        error: 'AMAZON_SPAPI_BASE_URL not configured'
      };
    }

    // Try to get access token first
    const clientId = process.env.AMAZON_CLIENT_ID || process.env.AMAZON_SPAPI_CLIENT_ID;
    const clientSecret = process.env.AMAZON_CLIENT_SECRET || process.env.AMAZON_SPAPI_CLIENT_SECRET;
    const refreshToken = process.env.AMAZON_SPAPI_REFRESH_TOKEN;

    if (!clientId || !clientSecret || !refreshToken) {
      return {
        step: 'SP-API Endpoint Test',
        success: false,
        error: 'Cannot test SP-API endpoint without valid credentials',
        details: {
          baseUrl,
          hasCredentials: !!(clientId && clientSecret && refreshToken)
        }
      };
    }

    // Get access token
    let accessToken: string;
    try {
      const tokenResponse = await axios.post(
        'https://api.amazon.com/auth/o2/token',
        {
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: clientId,
          client_secret: clientSecret,
        },
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: 10000
        }
      );
      accessToken = tokenResponse.data.access_token;

      if (!accessToken) {
        return {
          step: 'SP-API Endpoint Test',
          success: false,
          error: 'Failed to get access token',
          details: tokenResponse.data
        };
      }
    } catch (error: any) {
      return {
        step: 'SP-API Endpoint Test',
        success: false,
        error: 'Token refresh failed - cannot test SP-API endpoint',
        details: {
          error: error.response?.data?.error_description || error.message
        }
      };
    }

    // Test a simple SP-API endpoint (sellers info)
    try {
      const sellersUrl = `${baseUrl}/sellers/v1/marketplaceParticipations`;
      const response = await axios.get(sellersUrl, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'x-amz-access-token': accessToken,
          'Content-Type': 'application/json'
        },
        timeout: 10000,
        validateStatus: (status) => status < 500 // Don't throw on 4xx
      });

      if (response.status === 200) {
        return {
          step: 'SP-API Endpoint Test',
          success: true,
          details: {
            endpoint: sellersUrl,
            status: response.status,
            hasData: !!response.data
          }
        };
      } else {
        return {
          step: 'SP-API Endpoint Test',
          success: false,
          error: `SP-API endpoint returned ${response.status}`,
          details: {
            endpoint: sellersUrl,
            status: response.status,
            data: response.data
          }
        };
      }
    } catch (error: any) {
      return {
        step: 'SP-API Endpoint Test',
        success: false,
        error: error.message,
        details: {
          status: error.response?.status,
          data: error.response?.data
        }
      };
    }
  } catch (error: any) {
    return {
      step: 'SP-API Endpoint Test',
      success: false,
      error: error.message
    };
  }
}

