"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Claim = void 0;
const connection_1 = require("../db/connection");
class Claim {
    constructor(data) {
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
    static async findById(id) {
        const db = (0, connection_1.getDatabase)();
        const claim = await db('claims').where({ id }).first();
        return claim ? new Claim(claim) : null;
    }
    static async findByUserId(userId) {
        const db = (0, connection_1.getDatabase)();
        const claims = await db('claims').where({ user_id: userId }).orderBy('created_at', 'desc');
        return claims.map(claim => new Claim(claim));
    }
    static async findByStatus(status) {
        const db = (0, connection_1.getDatabase)();
        const claims = await db('claims').where({ status }).orderBy('created_at', 'desc');
        return claims.map(claim => new Claim(claim));
    }
    static async create(data) {
        const db = (0, connection_1.getDatabase)();
        const now = new Date();
        const [claim] = await db('claims').insert({
            ...data,
            created_at: now,
            updated_at: now,
        }).returning('*');
        return new Claim(claim);
    }
    async update(data) {
        const db = (0, connection_1.getDatabase)();
        await db('claims').where({ id: this.id }).update({
            ...data,
            updated_at: new Date(),
        });
        // Update local instance
        Object.assign(this, data);
    }
    async delete() {
        const db = (0, connection_1.getDatabase)();
        await db('claims').where({ id: this.id }).del();
    }
    toJSON() {
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
exports.Claim = Claim;
//# sourceMappingURL=Claim.js.map