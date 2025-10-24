"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.User = void 0;
const connection_1 = require("../db/connection");
class User {
    constructor(data) {
        this.id = data.id;
        this.email = data.email;
        this.role = data.role;
        this.created_at = data.created_at;
        this.updated_at = data.updated_at;
    }
    static async findById(id) {
        const db = (0, connection_1.getDatabase)();
        const user = await db('users').where({ id }).first();
        return user ? new User(user) : null;
    }
    static async findByEmail(email) {
        const db = (0, connection_1.getDatabase)();
        const user = await db('users').where({ email }).first();
        return user ? new User(user) : null;
    }
    static async create(data) {
        const db = (0, connection_1.getDatabase)();
        const now = new Date();
        const [user] = await db('users').insert({
            ...data,
            created_at: now,
            updated_at: now,
        }).returning('*');
        return new User(user);
    }
    async update(data) {
        const db = (0, connection_1.getDatabase)();
        await db('users').where({ id: this.id }).update({
            ...data,
            updated_at: new Date(),
        });
        // Update local instance
        Object.assign(this, data);
    }
    async delete() {
        const db = (0, connection_1.getDatabase)();
        await db('users').where({ id: this.id }).del();
    }
    toJSON() {
        return {
            id: this.id,
            email: this.email,
            role: this.role,
            created_at: this.created_at,
            updated_at: this.updated_at,
        };
    }
}
exports.User = User;
//# sourceMappingURL=User.js.map