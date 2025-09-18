import { getDatabase } from '../db/connection';

export interface UserData {
  id: string;
  email: string;
  role: 'admin' | 'user' | 'viewer';
  created_at: Date;
  updated_at: Date;
}

export class User {
  id: string;
  email: string;
  role: 'admin' | 'user' | 'viewer';
  created_at: Date;
  updated_at: Date;

  constructor(data: UserData) {
    this.id = data.id;
    this.email = data.email;
    this.role = data.role;
    this.created_at = data.created_at;
    this.updated_at = data.updated_at;
  }

  static async findById(id: string): Promise<User | null> {
    const db = getDatabase();
    const user = await db('users').where({ id }).first();
    return user ? new User(user) : null;
  }

  static async findByEmail(email: string): Promise<User | null> {
    const db = getDatabase();
    const user = await db('users').where({ email }).first();
    return user ? new User(user) : null;
  }

  static async create(data: Omit<UserData, 'id' | 'created_at' | 'updated_at'>): Promise<User> {
    const db = getDatabase();
    const now = new Date();
    const [user] = await db('users').insert({
      ...data,
      created_at: now,
      updated_at: now,
    }).returning('*');
    return new User(user);
  }

  async update(data: Partial<Omit<UserData, 'id' | 'created_at' | 'updated_at'>>): Promise<void> {
    const db = getDatabase();
    await db('users').where({ id: this.id }).update({
      ...data,
      updated_at: new Date(),
    });
    
    // Update local instance
    Object.assign(this, data);
  }

  async delete(): Promise<void> {
    const db = getDatabase();
    await db('users').where({ id: this.id }).del();
  }

  toJSON(): UserData {
    return {
      id: this.id,
      email: this.email,
      role: this.role,
      created_at: this.created_at,
      updated_at: this.updated_at,
    };
  }
} 