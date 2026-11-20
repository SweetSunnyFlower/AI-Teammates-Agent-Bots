import type { Pool, PoolClient, QueryResultRow } from "pg";
import { dbPool } from "./pool";

type Operator = "eq" | "neq" | "in" | "is" | "lt" | "lte" | "gt" | "gte" | "like" | "ilike";
type Filter = { column: string; operator: Operator; value: unknown };
type Order = { column: string; ascending: boolean };

type QueryError = { message: string; code?: string; details?: string; hint?: string };
type QueryResponse<T> = { data: T | null; error: QueryError | null; count?: number | null };
type QueryAction = "select" | "insert" | "update" | "delete";

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/i;

const WORKSPACE_TABLES = new Set([
  "departments",
  "bots",
  "tasks",
  "runs",
  "activity",
  "inbox_items",
  "messages",
  "bot_notes",
  "routines",
  "watches",
  "recaps",
  "connections",
  "code_runs",
]);

const JSON_COLUMNS: Record<string, Set<string>> = {
  bots: new Set(["avatar"]),
  tasks: new Set(["result"]),
  activity: new Set(["payload"]),
  inbox_items: new Set(["preview", "input", "edited_payload", "resume_state"]),
  messages: new Set(["parts"]),
  recaps: new Set(["content"]),
  connections: new Set(["meta"]),
  runs: new Set(["agent_state"]),
};

function ident(value: string) {
  if (!IDENTIFIER.test(value)) throw new Error(`Unsafe SQL identifier: ${value}`);
  return `"${value}"`;
}

function columnList(raw: string | undefined) {
  if (!raw || raw.trim() === "*") return "*";
  const columns = raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (!columns.length) return "*";
  return columns.map(ident).join(", ");
}

function prepareValue(table: string, column: string, value: unknown) {
  if (value === undefined) return null;
  if (value !== null && JSON_COLUMNS[table]?.has(column)) return JSON.stringify(value);
  return value;
}

function errorFrom(error: unknown): QueryError {
  if (error && typeof error === "object") {
    const e = error as { message?: string; code?: string; detail?: string; hint?: string };
    return { message: e.message ?? String(error), code: e.code, details: e.detail, hint: e.hint };
  }
  return { message: String(error) };
}

class QueryBuilder<T = any[]> implements PromiseLike<QueryResponse<T>> {
  private action: QueryAction = "select";
  private filters: Filter[] = [];
  private orders: Order[] = [];
  private selectColumns: string | undefined;
  private returningColumns: string | undefined;
  private payload: Record<string, unknown> | Record<string, unknown>[] | undefined;
  private conflictColumns: string[] = [];
  private rowLimit: number | undefined;
  private singleMode: "one" | "maybe" | null = null;
  private countMode = false;
  private headMode = false;

  constructor(
    private readonly table: string,
    private readonly userId: string | null,
  ) {
    ident(table);
  }

  select(columns = "*", options: { count?: "exact"; head?: boolean } = {}) {
    if (this.action === "select") this.selectColumns = columns;
    else this.returningColumns = columns;
    this.countMode = options.count === "exact";
    this.headMode = Boolean(options.head);
    return this;
  }

  insert(values: Record<string, unknown> | Record<string, unknown>[]) {
    this.action = "insert";
    this.payload = values;
    return this;
  }

  update(values: Record<string, unknown>, _options: { count?: "exact" } = {}) {
    this.action = "update";
    this.payload = values;
    return this;
  }

  upsert(
    values: Record<string, unknown> | Record<string, unknown>[],
    options: { onConflict?: string } = {},
  ) {
    this.action = "insert";
    this.payload = values;
    this.conflictColumns = (options.onConflict ?? "id")
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    return this;
  }

  delete(_options: { count?: "exact" } = {}) {
    this.action = "delete";
    this.countMode = true;
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push({ column, operator: "eq", value });
    return this;
  }

  neq(column: string, value: unknown) {
    this.filters.push({ column, operator: "neq", value });
    return this;
  }

  in(column: string, values: readonly unknown[]) {
    this.filters.push({ column, operator: "in", value: values });
    return this;
  }

  is(column: string, value: null | boolean) {
    this.filters.push({ column, operator: "is", value });
    return this;
  }

  not(column: string, operator: "is", value: null | boolean) {
    this.filters.push({ column, operator: operator === "is" ? "neq" : operator, value });
    return this;
  }

  lte(column: string, value: unknown) {
    this.filters.push({ column, operator: "lte", value });
    return this;
  }

  gte(column: string, value: unknown) {
    this.filters.push({ column, operator: "gte", value });
    return this;
  }

  gt(column: string, value: unknown) {
    this.filters.push({ column, operator: "gt", value });
    return this;
  }

  like(column: string, value: string) {
    this.filters.push({ column, operator: "like", value });
    return this;
  }

  ilike(column: string, value: string) {
    this.filters.push({ column, operator: "ilike", value });
    return this;
  }

  or(raw: string) {
    for (const expression of raw.split(",").map((part) => part.trim()).filter(Boolean)) {
      const match = /^([a-z_][a-z0-9_]*)\.(eq|neq|like)\.(.*)$/i.exec(expression);
      if (!match) throw new Error(`Unsupported OR expression: ${expression}`);
      this.filters.push({
        column: match[1],
        operator: match[2] as Operator,
        value: match[3].replaceAll("*", "%"),
      });
      this.filters[this.filters.length - 1].value = { __or: true, value: match[3].replaceAll("*", "%") };
    }
    return this;
  }

  match(values: Record<string, unknown>) {
    for (const [column, value] of Object.entries(values)) this.eq(column, value);
    return this;
  }

  order(column: string, options: { ascending?: boolean } = {}) {
    this.orders.push({ column, ascending: options.ascending !== false });
    return this;
  }

  limit(rows: number) {
    this.rowLimit = rows;
    return this;
  }

  single<R = T extends Array<infer U> ? U : T>() {
    this.singleMode = "one";
    return this as unknown as PromiseLike<QueryResponse<R>>;
  }

  maybeSingle<R = T extends Array<infer U> ? U : T>() {
    this.singleMode = "maybe";
    return this as unknown as PromiseLike<QueryResponse<R>>;
  }

  returns<R>() {
    return this as unknown as PromiseLike<QueryResponse<R>>;
  }

  then<TResult1 = QueryResponse<T>, TResult2 = never>(
    onfulfilled?: ((value: QueryResponse<T>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) {
    return this.execute().then(onfulfilled, onrejected);
  }

  private whereSql(params: unknown[], alias = "") {
    const conditions: string[] = [];
    const orConditions: string[] = [];
    const prefix = alias ? `${alias}.` : "";

    for (const filter of this.filters) {
      const column = `${prefix}${ident(filter.column)}`;
      const raw = filter.value && typeof filter.value === "object" && "__or" in filter.value
        ? (filter.value as unknown as { value: unknown }).value
        : filter.value;

      if (raw === null) {
        conditions.push(filter.operator === "neq" ? `${column} is not null` : `${column} is null`);
        continue;
      }
      if (filter.operator === "in") {
        const values = raw as readonly unknown[];
        if (!values.length) {
          conditions.push("false");
        } else {
          const placeholders = values.map((value) => {
            params.push(value);
            return `$${params.length}`;
          });
          conditions.push(`${column} in (${placeholders.join(", ")})`);
        }
        continue;
      }
      params.push(raw);
      const placeholder = `$${params.length}`;
      const sqlOperator =
        filter.operator === "eq" ? "=" :
        filter.operator === "neq" ? "is distinct from" :
        filter.operator === "gt" ? ">" :
        filter.operator === "gte" ? ">=" :
        filter.operator === "lt" ? "<" :
        filter.operator === "lte" ? "<=" :
        filter.operator === "like" ? "like" :
        filter.operator === "ilike" ? "ilike" : "=";
      const condition = `${column} ${sqlOperator} ${placeholder}`;
      if (filter.value && typeof filter.value === "object" && "__or" in filter.value) orConditions.push(condition);
      else conditions.push(condition);
    }

    if (orConditions.length) conditions.push(`(${orConditions.join(" or ")})`);

    if (this.userId && this.table === "workspaces") {
      params.push(this.userId);
      conditions.push(`"owner_id" = $${params.length}`);
    }
    if (this.userId && this.table === "profiles") {
      params.push(this.userId);
      conditions.push(`"user_id" = $${params.length}`);
    }
    if (this.userId && WORKSPACE_TABLES.has(this.table)) {
      params.push(this.userId);
      conditions.push(
        `exists (select 1 from "workspaces" "owned_w" where "owned_w"."id" = ${prefix}${ident("workspace_id")} and "owned_w"."owner_id" = $${params.length})`,
      );
    }
    return conditions.length ? ` where ${conditions.join(" and ")}` : "";
  }

  private insertSql(params: unknown[]) {
    const rows = Array.isArray(this.payload) ? this.payload : this.payload ? [this.payload] : [];
    if (!rows.length) throw new Error(`No rows supplied for ${this.table}`);

    const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
    columns.forEach(ident);
    const values: string[] = [];
    for (const row of rows) {
      const slots = columns.map((column) => {
        params.push(prepareValue(this.table, column, row[column]));
        return `$${params.length}`;
      });
      values.push(`(${slots.join(", ")})`);
    }

    let sql = `insert into ${ident(this.table)} (${columns.map(ident).join(", ")}) values ${values.join(", ")}`;
    if (this.conflictColumns.length) {
      const conflict = this.conflictColumns.map(ident).join(", ");
      const updates = columns
        .filter((column) => !this.conflictColumns.includes(column))
        .map((column) => `${ident(column)} = excluded.${ident(column)}`);
      sql += ` on conflict (${conflict}) ${updates.length ? `do update set ${updates.join(", ")}` : "do nothing"}`;
    }
    if (this.returningColumns) sql += ` returning ${columnList(this.returningColumns)}`;
    return sql;
  }

  private async assertInsertOwnership(client: Pool | PoolClient) {
    if (!this.userId || !this.payload) return;
    const rows = Array.isArray(this.payload) ? this.payload : [this.payload];
    for (const row of rows) {
      if (this.table === "profiles") row.user_id = this.userId;
      if (this.table === "workspaces") row.owner_id = this.userId;
      if (this.table === "telegram_link_codes") row.user_id = this.userId;
      if (WORKSPACE_TABLES.has(this.table)) {
        const workspaceId = row.workspace_id;
        if (!workspaceId) throw new Error(`Missing workspace_id for ${this.table}`);
        const owned = await client.query(
          'select 1 from "workspaces" where "id" = $1 and "owner_id" = $2',
          [workspaceId, this.userId],
        );
        if (!owned.rowCount) throw new Error("You don't have access to that workspace.");
      }
    }
  }

  private async executeWith(client: Pool | PoolClient): Promise<unknown[]> {
    const params: unknown[] = [];
    let sql: string;

    if (this.action === "insert") {
      await this.assertInsertOwnership(client);
      sql = this.insertSql(params);
    } else if (this.action === "update") {
      const values = Object.entries(this.payload as Record<string, unknown>)
        .filter(([, value]) => value !== undefined);
      if (!values.length) return [];
      const assignments = values.map(([column, value]) => {
        params.push(prepareValue(this.table, column, value));
        return `${ident(column)} = $${params.length}`;
      });
      sql = `update ${ident(this.table)} set ${assignments.join(", ")}${this.whereSql(params)}`;
      if (this.returningColumns) sql += ` returning ${columnList(this.returningColumns)}`;
    } else if (this.action === "delete") {
      sql = `delete from ${ident(this.table)}${this.whereSql(params)} returning 1`;
    } else {
      if (this.headMode) {
        sql = `select count(*)::int as "count" from ${ident(this.table)}${this.whereSql(params)}`;
      } else {
        sql = `select ${columnList(this.selectColumns)} from ${ident(this.table)}${this.whereSql(params)}`;
        if (this.orders.length) {
          sql += ` order by ${this.orders
            .map((order) => `${ident(order.column)} ${order.ascending ? "asc" : "desc"}`)
            .join(", ")}`;
        }
        if (this.rowLimit !== undefined) sql += ` limit ${Math.max(0, Math.floor(this.rowLimit))}`;
      }
    }

    const result = await client.query(sql, params);
    return result.rows;
  }

  private async execute(): Promise<QueryResponse<T>> {
    const pool = dbPool();
    let rows: unknown[] = [];
    try {
      if ((this.action === "insert" || this.action === "update" || this.action === "delete") && this.userId) {
        const client = await pool.connect();
        try {
          await client.query("begin");
          rows = await this.executeWith(client);
          await client.query("commit");
        } catch (error) {
          await client.query("rollback").catch(() => {});
          throw error;
        } finally {
          client.release();
        }
      } else {
        rows = await this.executeWith(pool);
      }

      if (this.headMode && this.countMode) {
        return { data: null, error: null, count: Number((rows[0] as { count?: number })?.count ?? 0) };
      }
      if (this.countMode && (this.action === "delete" || this.action === "update")) {
        return { data: (this.returningColumns ? rows : null) as T | null, error: null, count: rows.length };
      }
      if (this.singleMode) {
        if (rows.length === 1) return { data: rows[0] as T, error: null };
        if (rows.length === 0 && this.singleMode === "maybe") return { data: null, error: null };
        return {
          data: null,
          error: {
            message: rows.length === 0 ? "The result contains 0 rows" : "JSON object requested, multiple rows returned",
            code: "PGRST116",
          },
        };
      }
      return {
        data: (this.action === "select" || this.returningColumns ? rows : null) as T | null,
        error: null,
        count: this.countMode ? rows.length : undefined,
      };
    } catch (error) {
      return { data: null, error: errorFrom(error), count: null };
    }
  }
}

function rpcParams(args: Record<string, unknown>) {
  return Object.entries(args)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => ({ key, value }));
}

export type DbClient = ReturnType<typeof createDbClient>;

export function createDbClient(userId: string | null = null) {
  return {
    from<T = any>(table: string) {
      return new QueryBuilder<T>(table, userId);
    },

    async rpc<T = string | null>(name: string, args: Record<string, unknown> = {}): Promise<QueryResponse<T>> {
      if (!IDENTIFIER.test(name)) return { data: null, error: { message: "Unsafe RPC name" } };
      const pool = dbPool();
      const client = await pool.connect();
      try {
        await client.query("begin");
        if (userId) await client.query("select set_config('app.user_id', $1, true)", [userId]);

        if (userId && name !== "create_workspace") {
          let workspaceId = args.p_workspace_id as string | undefined;
          if (!workspaceId && name === "delete_department" && args.p_department_id) {
            const dept = await client.query<{ workspace_id: string }>(
              'select "workspace_id" from "departments" where "id" = $1',
              [args.p_department_id],
            );
            workspaceId = dept.rows[0]?.workspace_id;
          }
          if (workspaceId) {
            const owned = await client.query(
              'select 1 from "workspaces" where "id" = $1 and "owner_id" = $2',
              [workspaceId, userId],
            );
            if (!owned.rowCount) throw new Error("You don't have access to that workspace.");
          }
        }

        const params: unknown[] = [];
        const named = rpcParams(args).map(({ key, value }) => {
          params.push(value);
          return `${ident(key)} => $${params.length}`;
        });
        const result = await client.query<QueryResultRow>(
          `select "public"."${name}"(${named.join(", ")}) as "data"`,
          params,
        );
        await client.query("commit");
        return { data: (result.rows[0]?.data ?? null) as T, error: null };
      } catch (error) {
        await client.query("rollback").catch(() => {});
        return { data: null, error: errorFrom(error) };
      } finally {
        client.release();
      }
    },
  };
}
