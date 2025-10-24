export interface InventoryData {
    id: string;
    sku: string;
    quantity: number;
    location: string;
    user_id: string;
    source: 'amazon' | 'manual' | 'sync';
    external_id?: string;
    last_synced_at?: Date;
    created_at: Date;
    updated_at: Date;
}
export declare class Inventory {
    id: string;
    sku: string;
    quantity: number;
    location: string;
    user_id: string;
    source: 'amazon' | 'manual' | 'sync';
    external_id?: string;
    last_synced_at?: Date;
    created_at: Date;
    updated_at: Date;
    constructor(data: InventoryData);
    static findById(id: string): Promise<Inventory | null>;
    static findBySku(sku: string, userId?: string): Promise<Inventory[]>;
    static findByUserId(userId: string): Promise<Inventory[]>;
    static findByLocation(location: string, userId?: string): Promise<Inventory[]>;
    static create(data: Omit<InventoryData, 'id' | 'created_at' | 'updated_at'>): Promise<Inventory>;
    update(data: Partial<Omit<InventoryData, 'id' | 'created_at' | 'updated_at'>>): Promise<void>;
    updateQuantity(quantity: number): Promise<void>;
    delete(): Promise<void>;
    toJSON(): InventoryData;
}
//# sourceMappingURL=Inventory.d.ts.map