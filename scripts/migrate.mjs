#!/usr/bin/env node
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  console.error("缺少 DATABASE_URL。");
  process.exit(1);
}

const directory = path.resolve("db/migrations");
const files = (await readdir(directory))
  .filter((name) => name.endsWith(".sql"))
  .sort();

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();

await client.query(`
  create table if not exists public._dotty_migrations (
    filename text primary key,
    applied_at timestamptz not null default now()
  )
`);

try {
  for (const filename of files) {
    const applied = await client.query("select 1 from public._dotty_migrations where filename = $1", [filename]);
    if (applied.rowCount) {
      console.log(`跳过 ${filename}`);
      continue;
    }

    const sql = await readFile(path.join(directory, filename), "utf8");
    console.log(`执行 ${filename}`);
    await client.query("begin");
    try {
      await client.query(sql);
      await client.query("insert into public._dotty_migrations (filename) values ($1)", [filename]);
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw new Error(`${filename}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  console.log("数据库已是最新状态");
} finally {
  await client.end();
}
