import { getDatabase } from '../db/connection';

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

export class Inventory {
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

  constructor(data: InventoryData) {
    this.id = data.id;
    this.sku = data.sku;
    this.quantity = data.quantity;
    this.location = data.location;
    this.user_id = data.user_id;
    this.source = data.source;
    this.external_id = data.external_id;
    this.last_synced_at = data.last_synced_at;
    this.created_at = data.created_at;
    this.updated_at = data.updated_at;
  }

  static async findById(id: string): Promise<Inventory | null> {
    const db = getDatabase();
    const inventory = await db('inventory').where({ id }).first();
    return inventory ? new Inventory(inventory) : null;
  }

  static async findBySku(sku: string, userId?: string): Promise<Inventory[]> {
    const db = getDatabase();
    let query = db('inventory').where({ sku });
    if (userId) {
      query = query.where({ user_id: userId });
    }
    const inventory = await query.orderBy('updated_at', 'desc');
    return inventory.map(item => new Inventory(item));
  }

  static async findByUserId(userId: string): Promise<Inventory[]> {
    const db = getDatabase();
    const inventory = await db('inventory').where({ user_id: userId }).orderBy('updated_at', 'desc');
    return inventory.map(item => new Inventory(item));
  }

  static async findByLocation(location: string, userId?: string): Promise<Inventory[]> {
    const db = getDatabase();
    let query = db('inventory').where({ location });
    if (userId) {
      query = query.where({ user_id: userId });
    }
    const inventory = await query.orderBy('updated_at', 'desc');
    return inventory.map(item => new Inventory(item));
  }

  static async create(data: Omit<InventoryData, 'id' | 'created_at' | 'updated_at'>): Promise<Inventory> {
    const db = getDatabase();
    const now = new Date();
    const [inventory] = await db('inventory').insert({
      ...data,
      created_at: now,
      updated_at: now,
    }).returning('*');
    return new Inventory(inventory);
  }

  async update(data: Partial<Omit<InventoryData, 'id' | 'created_at' | 'updated_at'>>): Promise<void> {
    const db = getDatabase();
    await db('inventory').where({ id: this.id }).update({
      ...data,
      updated_at: new Date(),
    });
    
    // Update local instance
    Object.assign(this, data);
  }

  async updateQuantity(quantity: number): Promise<void> {
    const db = getDatabase();
    await db('inventory').where({ id: this.id }).update({
      quantity,
      updated_at: new Date(),
    });
    this.quantity = quantity;
  }

  async delete(): Promise<void> {
    const db = getDatabase();
    await db('inventory').where({ id: this.id }).del();
  }

  toJSON(): InventoryData {
    return {
      id: this.id,
      sku: this.sku,
      quantity: this.quantity,
      location: this.location,
      user_id: this.user_id,
      source: this.source,
      external_id: this.external_id,
      last_synced_at: this.last_synced_at,
      created_at: this.created_at,
      updated_at: this.updated_at,
    };
  }
} 