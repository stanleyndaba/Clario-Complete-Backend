import { getDatabase } from '../../../shared/db/connection';

export interface InventoryItemData {
  id: string;
  user_id: string;
  sku: string;
  title?: string;
  description?: string;
  category?: string;
  brand?: string;
  supplier?: string;
  cost_price?: number;
  selling_price?: number;
  quantity_available: number;
  quantity_reserved: number;
  quantity_shipped: number;
  reorder_point: number;
  reorder_quantity: number;
  weight?: number;
  dimensions?: any;
  tags?: string[];
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface InventorySyncLogData {
  id: string;
  user_id: string;
  provider: 'amazon' | 'gmail' | 'stripe' | 'manual';
  sync_type: 'full' | 'incremental' | 'discrepancy';
  status: 'pending' | 'running' | 'completed' | 'failed';
  items_processed: number;
  items_updated: number;
  items_created: number;
  items_deleted: number;
  discrepancies_found: number;
  error_message?: string;
  started_at: Date;
  completed_at?: Date;
  metadata?: any;
}

export interface DiscrepancyData {
  id: string;
  user_id: string;
  item_id?: string;
  sku?: string;
  discrepancy_type: 'quantity' | 'price' | 'status' | 'metadata';
  source_system: string;
  source_value: string;
  target_system: string;
  target_value: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  status: 'open' | 'investigating' | 'resolved' | 'ignored';
  assigned_to?: string;
  notes?: string;
  resolved_at?: Date;
  created_at: Date;
  updated_at: Date;
}

export class InventoryItem {
  id: string;
  user_id: string;
  sku: string;
  title?: string;
  description?: string;
  category?: string;
  brand?: string;
  supplier?: string;
  cost_price?: number;
  selling_price?: number;
  quantity_available: number;
  quantity_reserved: number;
  quantity_shipped: number;
  reorder_point: number;
  reorder_quantity: number;
  weight?: number;
  dimensions?: any;
  tags?: string[];
  is_active: boolean;
  created_at: Date;
  updated_at: Date;

  constructor(data: InventoryItemData) {
    this.id = data.id;
    this.user_id = data.user_id;
    this.sku = data.sku;
    this.title = data.title;
    this.description = data.description;
    this.category = data.category;
    this.brand = data.brand;
    this.supplier = data.supplier;
    this.cost_price = data.cost_price;
    this.selling_price = data.selling_price;
    this.quantity_available = data.quantity_available;
    this.quantity_reserved = data.quantity_reserved;
    this.quantity_shipped = data.quantity_shipped;
    this.reorder_point = data.reorder_point;
    this.reorder_quantity = data.reorder_quantity;
    this.weight = data.weight;
    this.dimensions = data.dimensions;
    this.tags = data.tags;
    this.is_active = data.is_active;
    this.created_at = data.created_at;
    this.updated_at = data.updated_at;
  }

  static async findById(id: string): Promise<InventoryItem | null> {
    const db = getDatabase();
    const item = await db('inventory_items').where({ id }).first();
    return item ? new InventoryItem(item) : null;
  }

  static async findBySku(sku: string, userId: string): Promise<InventoryItem | null> {
    const db = getDatabase();
    const item = await db('inventory_items')
      .where({ sku, user_id: userId })
      .first();
    return item ? new InventoryItem(item) : null;
  }

  static async findByUserId(userId: string): Promise<InventoryItem[]> {
    const db = getDatabase();
    const items = await db('inventory_items')
      .where({ user_id: userId, is_active: true })
      .orderBy('updated_at', 'desc');
    return items.map(item => new InventoryItem(item));
  }

  static async findByLocation(location: string, userId: string): Promise<InventoryItem[]> {
    const db = getDatabase();
    const items = await db('inventory_items')
      .where({ user_id: userId, is_active: true })
      .whereRaw("metadata->>'location' = ?", [location])
      .orderBy('updated_at', 'desc');
    return items.map(item => new InventoryItem(item));
  }

  static async create(data: Omit<InventoryItemData, 'id' | 'created_at' | 'updated_at'>): Promise<InventoryItem> {
    const db = getDatabase();
    const now = new Date();
    const [item] = await db('inventory_items').insert({
      ...data,
      created_at: now,
      updated_at: now,
    }).returning('*');
    return new InventoryItem(item);
  }

  async update(data: Partial<Omit<InventoryItemData, 'id' | 'created_at' | 'updated_at'>>): Promise<void> {
    const db = getDatabase();
    await db('inventory_items').where({ id: this.id }).update({
      ...data,
      updated_at: new Date(),
    });
    
    // Update local instance
    Object.assign(this, data);
  }

  async updateQuantity(quantity: number, type: 'available' | 'reserved' | 'shipped' = 'available'): Promise<void> {
    const db = getDatabase();
    const updateData: any = { updated_at: new Date() };
    
    switch (type) {
      case 'available':
        updateData.quantity_available = quantity;
        this.quantity_available = quantity;
        break;
      case 'reserved':
        updateData.quantity_reserved = quantity;
        this.quantity_reserved = quantity;
        break;
      case 'shipped':
        updateData.quantity_shipped = quantity;
        this.quantity_shipped = quantity;
        break;
    }
    
    await db('inventory_items').where({ id: this.id }).update(updateData);
  }

  async delete(): Promise<void> {
    const db = getDatabase();
    await db('inventory_items').where({ id: this.id }).del();
  }

  toJSON(): InventoryItemData {
    return {
      id: this.id,
      user_id: this.user_id,
      sku: this.sku,
      title: this.title,
      description: this.description,
      category: this.category,
      brand: this.brand,
      supplier: this.supplier,
      cost_price: this.cost_price,
      selling_price: this.selling_price,
      quantity_available: this.quantity_available,
      quantity_reserved: this.quantity_reserved,
      quantity_shipped: this.quantity_shipped,
      reorder_point: this.reorder_point,
      reorder_quantity: this.reorder_quantity,
      weight: this.weight,
      dimensions: this.dimensions,
      tags: this.tags,
      is_active: this.is_active,
      created_at: this.created_at,
      updated_at: this.updated_at,
    };
  }
}

export class InventorySyncLog {
  id: string;
  user_id: string;
  provider: 'amazon' | 'gmail' | 'stripe' | 'manual';
  sync_type: 'full' | 'incremental' | 'discrepancy';
  status: 'pending' | 'running' | 'completed' | 'failed';
  items_processed: number;
  items_updated: number;
  items_created: number;
  items_deleted: number;
  discrepancies_found: number;
  error_message?: string;
  started_at: Date;
  completed_at?: Date;
  metadata?: any;

  constructor(data: InventorySyncLogData) {
    this.id = data.id;
    this.user_id = data.user_id;
    this.provider = data.provider;
    this.sync_type = data.sync_type;
    this.status = data.status;
    this.items_processed = data.items_processed;
    this.items_updated = data.items_updated;
    this.items_created = data.items_created;
    this.items_deleted = data.items_deleted;
    this.discrepancies_found = data.discrepancies_found;
    this.error_message = data.error_message;
    this.started_at = data.started_at;
    this.completed_at = data.completed_at;
    this.metadata = data.metadata;
  }

  static async create(data: Omit<InventorySyncLogData, 'id' | 'created_at' | 'updated_at'>): Promise<InventorySyncLog> {
    const db = getDatabase();
    const now = new Date();
    const [log] = await db('inventory_sync_logs').insert({
      ...data,
      started_at: data.started_at || now,
    }).returning('*');
    return new InventorySyncLog(log);
  }

  async complete(status: 'completed' | 'failed', metadata?: any): Promise<void> {
    const db = getDatabase();
    await db('inventory_sync_logs').where({ id: this.id }).update({
      status,
      completed_at: new Date(),
      metadata: metadata ? { ...this.metadata, ...metadata } : this.metadata,
    });
    
    this.status = status;
    this.completed_at = new Date();
    if (metadata) {
      this.metadata = { ...this.metadata, ...metadata };
    }
  }

  toJSON(): InventorySyncLogData {
    return {
      id: this.id,
      user_id: this.user_id,
      provider: this.provider,
      sync_type: this.sync_type,
      status: this.status,
      items_processed: this.items_processed,
      items_updated: this.items_updated,
      items_created: this.items_created,
      items_deleted: this.items_deleted,
      discrepancies_found: this.discrepancies_found,
      error_message: this.error_message,
      started_at: this.started_at,
      completed_at: this.completed_at,
      metadata: this.metadata,
    };
  }
}

export class Discrepancy {
  id: string;
  user_id: string;
  item_id?: string;
  sku?: string;
  discrepancy_type: 'quantity' | 'price' | 'status' | 'metadata';
  source_system: string;
  source_value: string;
  target_system: string;
  target_value: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  status: 'open' | 'investigating' | 'resolved' | 'ignored';
  assigned_to?: string;
  notes?: string;
  resolved_at?: Date;
  created_at: Date;
  updated_at: Date;

  constructor(data: DiscrepancyData) {
    this.id = data.id;
    this.user_id = data.user_id;
    this.item_id = data.item_id;
    this.sku = data.sku;
    this.discrepancy_type = data.discrepancy_type;
    this.source_system = data.source_system;
    this.source_value = data.source_value;
    this.target_system = data.target_system;
    this.target_value = data.target_value;
    this.severity = data.severity;
    this.status = data.status;
    this.assigned_to = data.assigned_to;
    this.notes = data.notes;
    this.resolved_at = data.resolved_at;
    this.created_at = data.created_at;
    this.updated_at = data.updated_at;
  }

  static async create(data: Omit<DiscrepancyData, 'id' | 'created_at' | 'updated_at'>): Promise<Discrepancy> {
    const db = getDatabase();
    const now = new Date();
    const [discrepancy] = await db('discrepancies').insert({
      ...data,
      created_at: now,
      updated_at: now,
    }).returning('*');
    return new Discrepancy(discrepancy);
  }

  static async findByUserId(userId: string, status?: string): Promise<Discrepancy[]> {
    const db = getDatabase();
    let query = db('discrepancies').where({ user_id: userId });
    
    if (status) {
      query = query.where({ status });
    }
    
    const discrepancies = await query.orderBy('created_at', 'desc');
    return discrepancies.map(d => new Discrepancy(d));
  }

  static async findBySku(sku: string, userId: string): Promise<Discrepancy[]> {
    const db = getDatabase();
    const discrepancies = await db('discrepancies')
      .where({ sku, user_id: userId })
      .orderBy('created_at', 'desc');
    return discrepancies.map(d => new Discrepancy(d));
  }

  async update(data: Partial<Omit<DiscrepancyData, 'id' | 'created_at' | 'updated_at'>>): Promise<void> {
    const db = getDatabase();
    await db('discrepancies').where({ id: this.id }).update({
      ...data,
      updated_at: new Date(),
    });
    
    // Update local instance
    Object.assign(this, data);
  }

  async resolve(notes?: string): Promise<void> {
    await this.update({
      status: 'resolved',
      resolved_at: new Date(),
      notes: notes || this.notes,
    });
  }

  toJSON(): DiscrepancyData {
    return {
      id: this.id,
      user_id: this.user_id,
      item_id: this.item_id,
      sku: this.sku,
      discrepancy_type: this.discrepancy_type,
      source_system: this.source_system,
      source_value: this.source_value,
      target_system: this.target_system,
      target_value: this.target_value,
      severity: this.severity,
      status: this.status,
      assigned_to: this.assigned_to,
      notes: this.notes,
      resolved_at: this.resolved_at,
      created_at: this.created_at,
      updated_at: this.updated_at,
    };
  }
}

