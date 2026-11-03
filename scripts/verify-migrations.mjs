import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const directory = mkdtempSync(join(tmpdir(), "mowo-migration-"));
try {
  const sqlite = new Database(join(directory, "verification.db"));
  sqlite.pragma("foreign_keys = ON");
  migrate(drizzle(sqlite), { migrationsFolder: join(process.cwd(), "drizzle") });
  const tables = sqlite.prepare("select name from sqlite_master where type = 'table' and name like 'frame_extraction_%'").all();
  const columns = sqlite.prepare("pragma table_info('asset_collection_items')").all().map((column) => column.name);
  if (tables.length !== 3 || !columns.includes("id") || !columns.includes("duration_ms")) throw new Error("拆帧迁移结构不完整");
  sqlite.close();
  console.log("SQLite migrations verified");
} finally {
  rmSync(directory, { recursive: true, force: true });
}
