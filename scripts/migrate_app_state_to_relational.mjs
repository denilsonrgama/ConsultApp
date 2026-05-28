import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import pg from "pg";

const { Pool } = pg;
const root = resolve(new URL("..", import.meta.url).pathname.slice(1));
loadEnvFile(resolve(root, ".env"));
const connectionString = databaseConnectionString();

if (!connectionString) {
  throw new Error("Configure DATABASE_URL ou DB_NAME, DB_USER, DB_PASSWORD, DB_HOST e DB_PORT antes de migrar.");
}

const pool = new Pool({
  connectionString,
  ssl: process.env.PGSSL === "true" ? { rejectUnauthorized: process.env.PGSSL_REJECT_UNAUTHORIZED !== "false" } : undefined,
});

try {
  await pool.query(readFileSync(join(root, "db", "postgres-schema.sql"), "utf-8"));
  await pool.query("ALTER TABLE clientes ADD COLUMN IF NOT EXISTS responsavel_nome TEXT NOT NULL DEFAULT ''");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const stateResult = await client.query("SELECT data FROM app_state WHERE id = $1", ["main"]);
    const state = stateResult.rows[0]?.data;
    if (!state) throw new Error("app_state principal nao encontrado para migracao.");

    await client.query("DELETE FROM orcamento_itens");
    await client.query("DELETE FROM orcamentos");
    await client.query("DELETE FROM responsaveis");
    await client.query("DELETE FROM servicos");
    await client.query("DELETE FROM clientes");

    await client.query(`
      INSERT INTO clientes (
        documento, nome, telefone, email, cep, bairro, endereco, numero, complemento,
        uf, cidade, observacoes, razao_social, nome_fantasia, situacao_cnpj, responsavel_nome
      )
      SELECT
        c->>'documento',
        COALESCE(NULLIF(c->>'nome', ''), NULLIF(c->>'razaoSocial', ''), NULLIF(c->>'nomeFantasia', '')),
        COALESCE(c->>'telefone', ''),
        COALESCE(c->>'email', ''),
        COALESCE(c->>'cep', ''),
        COALESCE(c->>'bairro', ''),
        COALESCE(c->>'endereco', ''),
        COALESCE(c->>'numero', ''),
        COALESCE(c->>'complemento', ''),
        COALESCE(c->>'uf', ''),
        COALESCE(c->>'cidade', ''),
        COALESCE(c->>'obs', ''),
        COALESCE(c->>'razaoSocial', ''),
        COALESCE(c->>'nomeFantasia', ''),
        COALESCE(c->>'situacaoCnpj', ''),
        COALESCE(c->>'responsavelNome', '')
      FROM jsonb_array_elements($1::jsonb->'clientes') AS c
    `, [JSON.stringify(state)]);

    await client.query(`
      INSERT INTO servicos (codigo, nome, status, frequencia, tipo, valor, observacoes)
      SELECT
        s->>'codigo',
        s->>'nome',
        COALESCE(NULLIF(s->>'status', ''), 'ATIVO'),
        COALESCE(s->>'frequencia', ''),
        COALESCE(s->>'tipo', ''),
        COALESCE(NULLIF(s->>'valor', '')::numeric, 0),
        COALESCE(s->>'observacoes', '')
      FROM jsonb_array_elements($1::jsonb->'servicos') AS s
    `, [JSON.stringify(state)]);

    await client.query(`
      INSERT INTO orcamentos (numero, cliente_documento, data, status, observacoes)
      SELECT
        (o->>'numero')::integer,
        o->>'clienteDocumento',
        (o->>'data')::date,
        COALESCE(NULLIF(o->>'status', ''), 'EM ANÁLISE'),
        COALESCE(o->>'observacoes', '')
      FROM jsonb_array_elements($1::jsonb->'orcamentos') AS o
    `, [JSON.stringify(state)]);

    await client.query(`
      INSERT INTO orcamento_itens (
        orcamento_numero, posicao, servico_codigo, quantidade, valor_unitario, desconto
      )
      SELECT
        (o->>'numero')::integer,
        item.ordinality - 1,
        item.value->>'servicoCodigo',
        COALESCE(NULLIF(item.value->>'quantidade', '')::numeric, 0),
        COALESCE(NULLIF(item.value->>'valorUnitario', '')::numeric, 0),
        COALESCE(NULLIF(item.value->>'desconto', '')::numeric, 0)
      FROM jsonb_array_elements($1::jsonb->'orcamentos') AS o
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(o->'itens', '[]'::jsonb)) WITH ORDINALITY AS item(value, ordinality)
    `, [JSON.stringify(state)]);

    const counts = await client.query(`
      SELECT
        (SELECT count(*)::integer FROM clientes) AS clientes,
        (SELECT count(*)::integer FROM servicos) AS servicos,
        (SELECT count(*)::integer FROM orcamentos) AS orcamentos,
        (SELECT count(*)::integer FROM orcamento_itens) AS itens
    `);
    await client.query("COMMIT");
    console.log("Migracao relacional concluida.");
    console.log(JSON.stringify(counts.rows[0]));
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
} finally {
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
  return `postgresql://${encodeURIComponent(DB_USER)}:${encodeURIComponent(DB_PASSWORD)}@${DB_HOST}:${DB_PORT || "5432"}/${encodeURIComponent(DB_NAME)}`;
}
