import "server-only";

import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { join } from "node:path";
import { ensureAssetDataPaths } from "./data-paths";
import * as schema from "./schema";

type AssetDatabase = BetterSQLite3Database<typeof schema>;

// Reinitialize after a development module reload so an older connection cannot skip migrations.
let databasePromise: Promise<AssetDatabase> | undefined;

async function openDatabase() {
  const paths = await ensureAssetDataPaths();
  const sqlite = new Database(paths.database);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  const database = drizzle(sqlite, { schema });
  migrate(database, { migrationsFolder: join(process.cwd(), "drizzle") });
  return database;
}

export function getAssetDatabase() {
  databasePromise ??= openDatabase().catch((error) => {
    databasePromise = undefined;
    throw error;
  });
  return databasePromise;
}
