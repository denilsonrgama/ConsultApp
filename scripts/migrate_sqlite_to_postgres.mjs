import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import pg from "pg";

const { Pool } = pg;
const root = resolve(new URL("..", import.meta.url).pathname.slice(1));
loadEnvFile(resolve(root, ".env"));
const sqlitePath = resolve(process.env.SQLITE_PATH || root, process.env.SQLITE_FILE || "consultapp.sqlite");
const postgresConnectionString = databaseConnectionString();

if (!postgresConnectionString) {
  throw new Error("Configure DATABASE_URL ou DB_NAME, DB_USER, DB_PASSWORD, DB_HOST e DB_PORT antes de migrar.");
}

if (!existsSync(sqlitePath)) {
  throw new Error(`SQLite nÃ£o encontrado em ${sqlitePath}.`);
}

const sqlite = new DatabaseSync(sqlitePath);
const row = sqlite.prepare("SELECT data FROM app_state WHERE id = ?").get("main");
if (!row?.data) {
  throw new Error("Nenhum estado principal encontrado no SQLite.");
}

const state = JSON.parse(row.data);
const pool = new Pool({
  connectionString: postgresConnectionString,
  ssl: process.env.PGSSL === "true" ? { rejectUnauthorized: process.env.PGSSL_REJECT_UNAUTHORIZED !== "false" } : undefined,
});

try {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_state (
      id TEXT PRIMARY KEY,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await pool.query(`
    INSERT INTO app_state (id, data, updated_at)
    VALUES ($1, $2::jsonb, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET data = EXCLUDED.data, updated_at = CURRENT_TIMESTAMP
  `, ["main", JSON.stringify(state)]);

  console.log("MigraÃ§Ã£o concluÃ­da.");
  console.log(`Clientes: ${state.clientes?.length || 0}`);
  console.log(`ServiÃ§os: ${state.servicos?.length || 0}`);
  console.log(`OrÃ§amentos: ${state.orcamentos?.length || 0}`);
  console.log(`ResponsÃ¡veis: ${state.responsaveis?.length || 0}`);
} finally {
  sqlite.close();
  await pool.end();
}

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;

  readFileSync(filePath, "utf-8").split(/\r?\n/).forEach((line) => {
    const clean = line.trim();
    if (!clean || clean.startsWith("#")) return;
    const separator = clean.indexOf("=");
    if (separator <= 0) return;
    const key = clean.slice(0, separator).trim();
    const value = clean.slice(separator + 1).trim().replace(/^['"]|['"]$/g, "");
    if (!process.env[key]) process.env[key] = value;
  });
}

function databaseConnectionString() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const { DB_NAME, DB_USER, DB_PASSWORD, DB_HOST, DB_PORT } = process.env;
  if (!DB_NAME || !DB_USER || !DB_PASSWORD || !DB_HOST) return "";
  const user = encodeURIComponent(DB_USER);
  const password = encodeURIComponent(DB_PASSWORD);
  const database = encodeURIComponent(DB_NAME);
  return `postgresql://${user}:${password}@${DB_HOST}:${DB_PORT || "5432"}/${database}`;
}
