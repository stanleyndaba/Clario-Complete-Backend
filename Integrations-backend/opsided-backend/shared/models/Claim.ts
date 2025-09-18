import { getDatabase } from '../db/connection';

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

export class Claim {
  id: string;
  user_id: string;
  status: 'pending' | 'approved' | 'rejected' | 'processing';
  amount: number;
  description: string;
  source: 'amazon' | 'stripe' | 'manual';
  external_id?: string;
  created_at: Date;
  updated_at: Date;

  constructor(data: ClaimData) {
    this.id = data.id;
    this.user_id = data.user_id;
    this.status = data.status;
    this.amount = data.amount;
    this.description = data.description;
    this.source = data.source;
    this.external_id = data.external_id;
    this.created_at = data.created_at;
    this.updated_at = data.updated_at;
  }

  static async findById(id: string): Promise<Claim | null> {
    const db = getDatabase();
    const claim = await db('claims').where({ id }).first();
    return claim ? new Claim(claim) : null;
  }

  static async findByUserId(userId: string): Promise<Claim[]> {
    const db = getDatabase();
    const claims = await db('claims').where({ user_id: userId }).orderBy('created_at', 'desc');
    return claims.map(claim => new Claim(claim));
  }

  static async findByStatus(status: ClaimData['status']): Promise<Claim[]> {
    const db = getDatabase();
    const claims = await db('claims').where({ status }).orderBy('created_at', 'desc');
    return claims.map(claim => new Claim(claim));
  }

  static async create(data: Omit<ClaimData, 'id' | 'created_at' | 'updated_at'>): Promise<Claim> {
    const db = getDatabase();
    const now = new Date();
    const [claim] = await db('claims').insert({
      ...data,
      created_at: now,
      updated_at: now,
    }).returning('*');
    return new Claim(claim);
  }

  async update(data: Partial<Omit<ClaimData, 'id' | 'created_at' | 'updated_at'>>): Promise<void> {
    const db = getDatabase();
    await db('claims').where({ id: this.id }).update({
      ...data,
      updated_at: new Date(),
    });
    
    // Update local instance
    Object.assign(this, data);
  }

  async delete(): Promise<void> {
    const db = getDatabase();
    await db('claims').where({ id: this.id }).del();
  }

  toJSON(): ClaimData {
    return {
      id: this.id,
      user_id: this.user_id,
      status: this.status,
      amount: this.amount,
      description: this.description,
      source: this.source,
      external_id: this.external_id,
      created_at: this.created_at,
      updated_at: this.updated_at,
    };
  }
} 