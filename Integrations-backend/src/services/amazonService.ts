// Simplified amazonService for development

export interface AmazonClaim {
  id: string;
  orderId: string;
  amount: number;
  status: string;
}

export interface AmazonInventory {
  sku: string;
  quantity: number;
  status: string;
}

export interface AmazonFee {
  type: string;
  amount: number;
}

export class AmazonService {
  async startOAuth() {
    return {
      authUrl: "https://sandbox.sellingpartnerapi-na.amazon.com/authorization?mock=true"
    };
  }

  async handleCallback(_code: string) {
    return {
      success: true,
      message: "Sandbox authentication successful",
      mockData: true
    };
  }

  async syncData(_userId: string) {
    return {
      status: "completed",
      message: "Mock data sync successful",
      recoveredAmount: 1250.75,
      claimsFound: 8
    };
  }

  private async getCredentials(_accountId: string): Promise<any> {
    return {};
  }

  async fetchClaims(accountId: string, _startDate?: Date, _endDate?: Date): Promise<any> {
    try {
      await this.getCredentials(accountId);
      console.log(`[AmazonService] Fetching claims for account ${accountId}`);
      return { success: true, data: [], message: "Claims fetch method called" };
    } catch (error: any) {
      console.error("Error fetching Amazon claims:", error);
      throw new Error(`Failed to fetch claims: ${error.message}`);
    }
  }

  async fetchInventory(accountId: string): Promise<any> {
    try {
      await this.getCredentials(accountId);
      console.log(`[AmazonService] Fetching inventory for account ${accountId}`);
      return { success: true, data: [], message: "Inventory fetch method called" };
    } catch (error: any) {
      console.error("Error fetching Amazon inventory:", error);
      throw new Error(`Failed to fetch inventory: ${error.message}`);
    }
  }

  async fetchFees(accountId: string, _startDate?: Date, _endDate?: Date): Promise<any> {
    try {
      await this.getCredentials(accountId);
      console.log(`[AmazonService] Fetching fees for account ${accountId}`);
      return { success: true, data: [], message: "Fees fetch method called" };
    } catch (error: any) {
      console.error("Error fetching Amazon fees:", error);
      throw new Error(`Failed to fetch fees: ${error.message}`);
    }
  }
}

export default new AmazonService();
