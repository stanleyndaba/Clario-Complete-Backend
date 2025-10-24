export interface ClaimData {
    id: string;
    user_id: string;
    status: 'pending' | 'approved' | 'rejected' | 'processing';
    amount: number;
    description: string;
    source: 'amazon' | 'stripe' | 'manual';
    external_id?: string;
    created_at: Date;
    updated_at: Date;
}
export declare class Claim {
    id: string;
    user_id: string;
    status: 'pending' | 'approved' | 'rejected' | 'processing';
    amount: number;
    description: string;
    source: 'amazon' | 'stripe' | 'manual';
    external_id?: string;
    created_at: Date;
    updated_at: Date;
    constructor(data: ClaimData);
    static findById(id: string): Promise<Claim | null>;
    static findByUserId(userId: string): Promise<Claim[]>;
    static findByStatus(status: ClaimData['status']): Promise<Claim[]>;
    static create(data: Omit<ClaimData, 'id' | 'created_at' | 'updated_at'>): Promise<Claim>;
    update(data: Partial<Omit<ClaimData, 'id' | 'created_at' | 'updated_at'>>): Promise<void>;
    delete(): Promise<void>;
    toJSON(): ClaimData;
}
//# sourceMappingURL=Claim.d.ts.map