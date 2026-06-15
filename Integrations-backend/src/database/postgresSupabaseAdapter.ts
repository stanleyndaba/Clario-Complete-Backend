import { Client } from 'pg';
import logger from '../utils/logger';

type DbError = {
  code?: string;
  message: string;
  details?: string;
  hint?: string;
};

type DbResult<T = any> = {
  data: T | null;
  error: DbError | null;
  count?: number | null;
};

type ColumnType = {
  dataType: string;
  udtName: string;
};

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function quoteQualifiedIdentifier(value: string): string {
  return value.split('.').map(quoteIdentifier).join('.');
}

function pgError(error: any): DbError {
  return {
    code: error?.code,
    message: error?.message || String(error),
    details: error?.detail,
    hint: error?.hint
  };
}

function normalizeRows(data: any): Record<string, any>[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') return [data];
  return [];
}

function shouldSerializeAsJson(columnType?: ColumnType): boolean {
  return columnType?.dataType === 'json' ||
    columnType?.dataType === 'jsonb' ||
    columnType?.udtName === 'json' ||
    columnType?.udtName === 'jsonb';
}

function prepareColumnValue(value: any, columnType?: ColumnType): any {
  if (value === null || typeof value === 'undefined') return null;
  if (shouldSerializeAsJson(columnType)) return JSON.stringify(value);
  return value;
}

function splitSelectColumns(columns: string): string[] {
  const result: string[] = [];
  let current = '';
  let depth = 0;

  for (const char of columns) {
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;

    if (char === ',' && depth === 0) {
      if (current.trim()) result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  if (current.trim()) result.push(current.trim());
  return result;
}

function isSimpleColumn(column: string): boolean {
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(column.trim());
}

export function createPostgresSupabaseAdapter(connectionString: string): any {
  const client = new Client({
    connectionString,
    ssl: connectionString.includes('sslmode=require') ? undefined : { rejectUnauthorized: false }
  });

  let connectPromise: Promise<void> | null = null;
  const columnTypeCache = new Map<string, Promise<Map<string, ColumnType>>>();

  async function ensureConnected(): Promise<void> {
    if (!connectPromise) {
      connectPromise = client.connect();
    }
    await connectPromise;
  }

  async function query<T = any>(sql: string, values: any[] = []): Promise<DbResult<T[]>> {
    try {
      await ensureConnected();
      const result = await client.query(sql, values);
      return { data: result.rows as T[], error: null, count: result.rowCount };
    } catch (error: any) {
      return { data: null, error: pgError(error), count: null };
    }
  }

  async function getColumnTypes(table: string): Promise<Map<string, ColumnType>> {
    const [schemaName, tableName] = table.includes('.')
      ? table.split('.', 2)
      : ['public', table];
    const cacheKey = `${schemaName}.${tableName}`;

    if (!columnTypeCache.has(cacheKey)) {
      columnTypeCache.set(cacheKey, (async () => {
        const result = await query<{ column_name: string; data_type: string; udt_name: string }>(
          `
            SELECT column_name, data_type, udt_name
            FROM information_schema.columns
            WHERE table_schema = $1
              AND table_name = $2
          `,
          [schemaName, tableName]
        );

        const types = new Map<string, ColumnType>();
        for (const row of result.data || []) {
          types.set(row.column_name, {
            dataType: String(row.data_type || '').toLowerCase(),
            udtName: String(row.udt_name || '').toLowerCase()
          });
        }
        return types;
      })());
    }

    return columnTypeCache.get(cacheKey)!;
  }

  class QueryBuilder {
    private filters: string[] = [];
    private values: any[] = [];
    private mode: 'select' | 'insert' | 'upsert' | 'update' | 'delete' = 'select';
    private payload: any = null;
    private selectedColumns = '*';
    private conflictColumns: string[] = [];
    private singleMode: 'none' | 'single' | 'maybeSingle' = 'none';
    private orderClauses: string[] = [];
    private limitCount: number | null = null;
    private offsetCount: number | null = null;
    private countMode: string | null = null;
    private headMode = false;

    constructor(private readonly table: string) {}

    select(columns?: string, options?: { count?: string; head?: boolean }) {
      this.selectedColumns = columns || '*';
      this.countMode = options?.count || null;
      this.headMode = options?.head === true;
      return this;
    }

    insert(data: any) {
      this.mode = 'insert';
      this.payload = data;
      return this;
    }

    upsert(data: any, options?: { onConflict?: string }) {
      this.mode = 'upsert';
      this.payload = data;
      this.conflictColumns = String(options?.onConflict || '')
        .split(',')
        .map((column) => column.trim())
        .filter(Boolean);
      return this;
    }

    update(data: any) {
      this.mode = 'update';
      this.payload = data;
      return this;
    }

    delete() {
      this.mode = 'delete';
      return this;
    }

    eq(field: string, value: any) {
      this.values.push(value);
      this.filters.push(`${quoteIdentifier(field)} = $${this.values.length}`);
      return this;
    }

    neq(field: string, value: any) {
      this.values.push(value);
      this.filters.push(`${quoteIdentifier(field)} <> $${this.values.length}`);
      return this;
    }

    gt(field: string, value: any) {
      this.values.push(value);
      this.filters.push(`${quoteIdentifier(field)} > $${this.values.length}`);
      return this;
    }

    gte(field: string, value: any) {
      this.values.push(value);
      this.filters.push(`${quoteIdentifier(field)} >= $${this.values.length}`);
      return this;
    }

    lt(field: string, value: any) {
      this.values.push(value);
      this.filters.push(`${quoteIdentifier(field)} < $${this.values.length}`);
      return this;
    }

    lte(field: string, value: any) {
      this.values.push(value);
      this.filters.push(`${quoteIdentifier(field)} <= $${this.values.length}`);
      return this;
    }

    like(field: string, value: any) {
      this.values.push(value);
      this.filters.push(`${quoteIdentifier(field)} LIKE $${this.values.length}`);
      return this;
    }

    ilike(field: string, value: any) {
      this.values.push(value);
      this.filters.push(`${quoteIdentifier(field)} ILIKE $${this.values.length}`);
      return this;
    }

    in(field: string, values: any[]) {
      this.values.push(values);
      this.filters.push(`${quoteIdentifier(field)} = ANY($${this.values.length})`);
      return this;
    }

    is(field: string, value: any) {
      if (value === null) {
        this.filters.push(`${quoteIdentifier(field)} IS NULL`);
      } else {
        this.values.push(value);
        this.filters.push(`${quoteIdentifier(field)} IS NOT DISTINCT FROM $${this.values.length}`);
      }
      return this;
    }

    not(field: string, operator: string, value: any) {
      const op = String(operator || '').toLowerCase();
      if (op === 'is' && value === null) {
        this.filters.push(`${quoteIdentifier(field)} IS NOT NULL`);
        return this;
      }
      if (op === 'eq') return this.neq(field, value);
      if (op === 'ilike') {
        this.values.push(value);
        this.filters.push(`${quoteIdentifier(field)} NOT ILIKE $${this.values.length}`);
        return this;
      }
      if (op === 'in' && Array.isArray(value)) {
        this.values.push(value);
        this.filters.push(`NOT (${quoteIdentifier(field)} = ANY($${this.values.length}))`);
        return this;
      }
      logger.warn('[PG_ADAPTER] Unsupported .not filter ignored', { table: this.table, field, operator });
      return this;
    }

    or(filter: string) {
      logger.warn('[PG_ADAPTER] Unsupported .or filter ignored', { table: this.table, filter });
      return this;
    }

    order(field: string, options?: { ascending?: boolean }) {
      this.orderClauses.push(`${quoteIdentifier(field)} ${options?.ascending === false ? 'DESC' : 'ASC'}`);
      return this;
    }

    limit(count: number) {
      this.limitCount = count;
      return this;
    }

    range(from: number, to: number) {
      this.offsetCount = from;
      this.limitCount = Math.max(0, to - from + 1);
      return this;
    }

    single() {
      this.singleMode = 'single';
      return this;
    }

    maybeSingle() {
      this.singleMode = 'maybeSingle';
      return this;
    }

    private whereClause(): string {
      return this.filters.length ? ` WHERE ${this.filters.join(' AND ')}` : '';
    }

    private orderLimitClause(): string {
      const clauses: string[] = [];
      if (this.orderClauses.length) clauses.push(`ORDER BY ${this.orderClauses.join(', ')}`);
      if (typeof this.limitCount === 'number') clauses.push(`LIMIT ${this.limitCount}`);
      if (typeof this.offsetCount === 'number') clauses.push(`OFFSET ${this.offsetCount}`);
      return clauses.length ? ` ${clauses.join(' ')}` : '';
    }

    private selectList(): string {
      if (!this.selectedColumns || this.selectedColumns === '*') return '*';

      const columns = splitSelectColumns(this.selectedColumns)
        .filter((column) => isSimpleColumn(column));

      return columns.length ? columns.map(quoteIdentifier).join(', ') : '*';
    }

    private async addNestedTenantRows(rows: any[]): Promise<any[]> {
      if (this.table !== 'tenant_memberships' || !this.selectedColumns.includes('tenants')) {
        return rows;
      }

      const tenantIds = Array.from(new Set(rows.map((row) => row.tenant_id).filter(Boolean)));
      if (!tenantIds.length) return rows;

      const tenantResult = await query<any>(
        `SELECT id, name, slug, plan, status FROM tenants WHERE id = ANY($1)`,
        [tenantIds]
      );
      const tenantsById = new Map((tenantResult.data || []).map((tenant) => [tenant.id, tenant]));

      return rows.map((row) => ({
        ...row,
        tenants: tenantsById.get(row.tenant_id) || null
      }));
    }

    private async executeInsert(upsert: boolean): Promise<DbResult> {
      const rows = normalizeRows(this.payload);
      if (!rows.length) return { data: [], error: null, count: 0 };

      const columns = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
      const columnTypes = await getColumnTypes(this.table);
      const values = [...this.values];
      const tuples = rows.map((row) => {
        const placeholders = columns.map((column) => {
          values.push(prepareColumnValue(row[column], columnTypes.get(column)));
          return `$${values.length}`;
        });
        return `(${placeholders.join(', ')})`;
      });

      const quotedColumns = columns.map(quoteIdentifier).join(', ');
      let sql = `INSERT INTO ${quoteQualifiedIdentifier(this.table)} (${quotedColumns}) VALUES ${tuples.join(', ')}`;

      if (upsert && this.conflictColumns.length) {
        const quotedConflict = this.conflictColumns.map(quoteIdentifier).join(', ');
        const updateColumns = columns.filter((column) => !this.conflictColumns.includes(column));
        if (updateColumns.length) {
          const assignments = updateColumns
            .map((column) => `${quoteIdentifier(column)} = EXCLUDED.${quoteIdentifier(column)}`)
            .join(', ');
          sql += ` ON CONFLICT (${quotedConflict}) DO UPDATE SET ${assignments}`;
        } else {
          sql += ` ON CONFLICT (${quotedConflict}) DO NOTHING`;
        }
      }

      sql += ' RETURNING *';
      const result = await query(sql, values);
      return this.shapeRows(result);
    }

    private async executeUpdate(): Promise<DbResult> {
      const row = this.payload || {};
      const columns = Object.keys(row);
      if (!columns.length) return { data: [], error: null, count: 0 };

      const columnTypes = await getColumnTypes(this.table);
      const values = [...this.values];
      const assignments = columns.map((column) => {
        values.push(prepareColumnValue(row[column], columnTypes.get(column)));
        return `${quoteIdentifier(column)} = $${values.length}`;
      });
      const sql = `UPDATE ${quoteQualifiedIdentifier(this.table)} SET ${assignments.join(', ')}${this.whereClause()} RETURNING *`;
      const result = await query(sql, values);
      return this.shapeRows(result);
    }

    private async executeDelete(): Promise<DbResult> {
      const sql = `DELETE FROM ${quoteQualifiedIdentifier(this.table)}${this.whereClause()}`;
      return query(sql, this.values);
    }

    private async executeSelect(): Promise<DbResult> {
      if (this.headMode) {
        const countResult = await query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM ${quoteQualifiedIdentifier(this.table)}${this.whereClause()}`,
          this.values
        );
        return {
          data: null,
          error: countResult.error,
          count: countResult.data?.[0]?.count ? Number(countResult.data[0].count) : 0
        };
      }

      const sql = `SELECT ${this.selectList()} FROM ${quoteQualifiedIdentifier(this.table)}${this.whereClause()}${this.orderLimitClause()}`;
      const result = await query(sql, this.values);
      return this.shapeRows(result);
    }

    private async shapeRows(result: DbResult<any[]>): Promise<DbResult> {
      if (result.error) return result;

      let rows = result.data || [];
      rows = await this.addNestedTenantRows(rows);

      if (this.countMode && !this.headMode) {
        const countResult = await query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM ${quoteQualifiedIdentifier(this.table)}${this.whereClause()}`,
          this.values
        );
        result.count = countResult.data?.[0]?.count ? Number(countResult.data[0].count) : rows.length;
      }

      if (this.singleMode === 'single' && rows.length !== 1) {
        return { data: null, error: { code: 'PGRST116', message: rows.length ? 'Multiple rows returned' : 'No rows returned' } };
      }

      if (this.singleMode === 'single' || this.singleMode === 'maybeSingle') {
        return { data: rows[0] || null, error: null, count: result.count ?? rows.length };
      }

      return { data: rows, error: null, count: result.count ?? result.count };
    }

    async execute(): Promise<DbResult> {
      if (this.mode === 'insert') return this.executeInsert(false);
      if (this.mode === 'upsert') return this.executeInsert(true);
      if (this.mode === 'update') return this.executeUpdate();
      if (this.mode === 'delete') return this.executeDelete();
      return this.executeSelect();
    }

    then(resolve: any, reject: any) {
      return this.execute().then(resolve, reject);
    }
  }

  const adapter = {
    auth: {
      getSession: () => Promise.resolve({ data: { session: null }, error: null }),
      getUser: () => Promise.resolve({ data: { user: null }, error: null }),
      signOut: () => Promise.resolve({ error: null })
    },
    from(table: string) {
      return new QueryBuilder(table);
    },
    async close() {
      if (connectPromise) {
        await connectPromise.catch(() => undefined);
        await client.end().catch(() => undefined);
      }
    }
  };

  return adapter;
}
