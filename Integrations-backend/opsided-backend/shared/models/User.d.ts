export interface UserData {
    id: string;
    email: string;
    role: 'admin' | 'user' | 'viewer';
    created_at: Date;
    updated_at: Date;
}
export declare class User {
    id: string;
    email: string;
    role: 'admin' | 'user' | 'viewer';
    created_at: Date;
    updated_at: Date;
    constructor(data: UserData);
    static findById(id: string): Promise<User | null>;
    static findByEmail(email: string): Promise<User | null>;
    static create(data: Omit<UserData, 'id' | 'created_at' | 'updated_at'>): Promise<User>;
    update(data: Partial<Omit<UserData, 'id' | 'created_at' | 'updated_at'>>): Promise<void>;
    delete(): Promise<void>;
    toJSON(): UserData;
}
//# sourceMappingURL=User.d.ts.map