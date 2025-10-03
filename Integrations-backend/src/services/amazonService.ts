// Simplified amazonService for development
export class AmazonService {
  
  async startOAuth() {
    // Simple mock for now - just return a sandbox URL
    return {
      authUrl: 'https://sandbox.sellingpartnerapi-na.amazon.com/authorization?mock=true'
    };
  }

  async handleCallback(_code: string) {
    // Mock successful auth
    return {
      success: true,
      message: 'Sandbox authentication successful',
      mockData: true
    };
  }

  async syncData(_userId: string) {
    // Return mock sync data
    return {
      status: 'completed',
      message: 'Mock data sync successful',
      recoveredAmount: 1250.75,
      claimsFound: 8
    };
  }
}

export default new AmazonService();
