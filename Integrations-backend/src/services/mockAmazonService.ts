import { v4 as uuidv4 } from 'uuid';

export interface MockOrder {
    AmazonOrderId: string;
    PurchaseDate: string;
    OrderStatus: string;
    OrderTotal: { Amount: string; CurrencyCode: string };
}

export interface MockShipment {
    ShipmentId: string;
    ShipmentName: string;
    ShipmentStatus: string;
    DestinationFulfillmentCenterId: string;
    ShipmentCreateDate: string;
    ShipmentItems: MockShipmentItem[];
}

export interface MockShipmentItem {
    SellerSKU: string;
    QuantityShipped: number;
    QuantityReceived: number;
}

export class MockAmazonService {

    /**
     * Helper to subtract days from a date
     */
    private subDays(date: Date, days: number): Date {
        const result = new Date(date);
        result.setDate(result.getDate() - days);
        return result;
    }

    /**
     * Helper to format date as M/d/yy
     */
    private formatDate(date: Date): string {
        const month = date.getMonth() + 1;
        const day = date.getDate();
        const year = date.getFullYear().toString().substr(-2);
        return `${month}/${day}/${year}`;
    }

    /**
     * Simulate fetching orders from SP-API
     */
    async getOrders(createdAfter: Date): Promise<MockOrder[]> {
        // Generate 5-10 random orders
        const count = Math.floor(Math.random() * 5) + 5;
        const orders: MockOrder[] = [];

        for (let i = 0; i < count; i++) {
            orders.push({
                AmazonOrderId: `114-${Math.floor(Math.random() * 10000000)}-${Math.floor(Math.random() * 1000000)}`,
                PurchaseDate: this.subDays(new Date(), Math.floor(Math.random() * 10)).toISOString(),
                OrderStatus: 'Shipped',
                OrderTotal: {
                    Amount: (Math.random() * 100 + 10).toFixed(2),
                    CurrencyCode: 'USD'
                }
            });
        }
        return orders;
    }

    /**
     * Simulate fetching inbound shipments
     */
    async getShipments(status: string[] = ['CLOSED']): Promise<MockShipment[]> {
        // Generate a shipment with a potential discrepancy
        const shipmentId = `FBA${Math.floor(Math.random() * 1000000000)}`;

        return [{
            ShipmentId: shipmentId,
            ShipmentName: `FBA (${this.formatDate(new Date())} 10:00 AM) - 1`,
            ShipmentStatus: 'CLOSED',
            DestinationFulfillmentCenterId: 'ORD1',
            ShipmentCreateDate: this.subDays(new Date(), 14).toISOString(),
            ShipmentItems: [
                {
                    SellerSKU: 'TEST-SKU-1001', // Perfect match
                    QuantityShipped: 100,
                    QuantityReceived: 100
                },
                {
                    SellerSKU: 'TEST-SKU-1002', // Shortage!
                    QuantityShipped: 50,
                    QuantityReceived: 45 // 5 missing
                }
            ]
        }];
    }

    /**
     * Simulate fetching financial events (reimbursements)
     */
    async getFinancialEvents(postedAfter: Date): Promise<any[]> {
        return []; // No reimbursements yet
    }
}

export const mockAmazonService = new MockAmazonService();
