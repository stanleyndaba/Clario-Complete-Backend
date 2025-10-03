import knex from 'knex';
export declare const getDatabase: () => knex.Knex;
export declare const closeDatabase: () => Promise<void>;
export declare const checkDatabaseHealth: () => Promise<boolean>;
//# sourceMappingURL=connection.d.ts.map