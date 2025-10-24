"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Inventory = void 0;
const connection_1 = require("../db/connection");
class Inventory {
    constructor(data) {
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
    static async findById(id) {
        const db = (0, connection_1.getDatabase)();
        const inventory = await db('inventory').where({ id }).first();
        return inventory ? new Inventory(inventory) : null;
    }
    static async findBySku(sku, userId) {
        const db = (0, connection_1.getDatabase)();
        let query = db('inventory').where({ sku });
        if (userId) {
            query = query.where({ user_id: userId });
        }
        const inventory = await query.orderBy('updated_at', 'desc');
        return inventory.map(item => new Inventory(item));
    }
    static async findByUserId(userId) {
        const db = (0, connection_1.getDatabase)();
        const inventory = await db('inventory').where({ user_id: userId }).orderBy('updated_at', 'desc');
        return inventory.map(item => new Inventory(item));
    }
    static async findByLocation(location, userId) {
        const db = (0, connection_1.getDatabase)();
        let query = db('inventory').where({ location });
        if (userId) {
            query = query.where({ user_id: userId });
        }
        const inventory = await query.orderBy('updated_at', 'desc');
        return inventory.map(item => new Inventory(item));
    }
    static async create(data) {
        const db = (0, connection_1.getDatabase)();
        const now = new Date();
        const [inventory] = await db('inventory').insert({
            ...data,
            created_at: now,
            updated_at: now,
        }).returning('*');
        return new Inventory(inventory);
    }
    async update(data) {
        const db = (0, connection_1.getDatabase)();
        await db('inventory').where({ id: this.id }).update({
            ...data,
            updated_at: new Date(),
        });
        // Update local instance
        Object.assign(this, data);
    }
    async updateQuantity(quantity) {
        const db = (0, connection_1.getDatabase)();
        await db('inventory').where({ id: this.id }).update({
            quantity,
            updated_at: new Date(),
        });
        this.quantity = quantity;
    }
    async delete() {
        const db = (0, connection_1.getDatabase)();
        await db('inventory').where({ id: this.id }).del();
    }
    toJSON() {
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
exports.Inventory = Inventory;
//# sourceMappingURL=Inventory.js.map