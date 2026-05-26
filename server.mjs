import { createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { createHash, pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";
import { connect as netConnect } from "node:net";
import { homedir } from "node:os";
import path, { extname, join, normalize, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { connect as tlsConnect } from "node:tls";
import { pathToFileURL, fileURLToPath } from "node:url";

/*
========================================
CORREÇÃO RENDER / LINUX
========================================
*/

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = __dirname;
const puppeteerCacheDir = resolve(root, ".cache", "puppeteer");
process.env.PUPPETEER_CACHE_DIR ||= puppeteerCacheDir;

/*
========================================
CONFIGURAÇÕES
========================================
*/

loadEnvFile(resolve(root, ".env"));

const budgetsDir = resolve(root, "Orcamentos");
const reportsDir = resolve(root, "Relatorios");
const databasePath = resolve(root, "consultapp.sqlite");
const smtpConfigPath = resolve(root, "smtp-config.json");

const pythonExe =
  process.env.PYTHON ||
  join(
    homedir(),
    ".cache",
    "codex-runtimes",
    "codex-primary-runtime",
    "dependencies",
    "python",
    "python.exe"
  );

const port = Number(process.env.PORT || 5173);
const host = process.env.HOST || "0.0.0.0";

const serverVersion = "v199";

const postgresConnectionString = databaseConnectionString();

const databaseBackend = String(
  process.env.DB_BACKEND ||
  (postgresConnectionString ? "postgres" : "sqlite")
).toLowerCase();

const sqliteDb =
  databaseBackend === "sqlite"
    ? new DatabaseSync(databasePath)
    : null;

let postgresPool = null;

if (sqliteDb) {
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS app_state (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS usuarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario TEXT NOT NULL UNIQUE,
      nome TEXT NOT NULL,
      email TEXT NOT NULL DEFAULT '',
      perfil TEXT NOT NULL DEFAULT 'OPERADOR',
      permissoes TEXT,
      senha_hash TEXT NOT NULL,
      deve_trocar_senha INTEGER NOT NULL DEFAULT 0,
      ativo INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sessoes (
      token_hash TEXT PRIMARY KEY,
      usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS auditoria_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
      usuario TEXT NOT NULL DEFAULT '',
      perfil TEXT NOT NULL DEFAULT '',
      acao TEXT NOT NULL,
      modulo TEXT NOT NULL DEFAULT '',
      entidade_tipo TEXT NOT NULL DEFAULT '',
      entidade_id TEXT NOT NULL DEFAULT '',
      detalhes TEXT NOT NULL DEFAULT '{}',
      ip TEXT NOT NULL DEFAULT '',
      user_agent TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS arquivos (
      categoria TEXT NOT NULL,
      nome TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      conteudo BLOB NOT NULL,
      tamanho INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (categoria, nome)
    );
  `);
}

if (databaseBackend === "postgres") {
  postgresPool = await createPostgresPool();
} else if (databaseBackend !== "sqlite") {
  throw new Error(`Banco ${databaseBackend} nÃ£o suportado. Use sqlite ou postgres.`);
}

await ensureAuthSchema();
await ensureInitialAdminUser();
await ensureGuestUser();

const types = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".pdf": "application/pdf",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

function readBody(request) {
  return new Promise((resolveBody, rejectBody) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 10_000_000) {
        request.destroy();
        rejectBody(new Error("Payload muito grande"));
      }
    });
    request.on("end", () => resolveBody(body));
    request.on("error", rejectBody);
  });
}

function normalizeAppState(state) {
  return {
    clientes: Array.isArray(state?.clientes) ? state.clientes : [],
    servicos: Array.isArray(state?.servicos) ? state.servicos : [],
    orcamentos: Array.isArray(state?.orcamentos) ? state.orcamentos : [],
    responsaveis: Array.isArray(state?.responsaveis) ? state.responsaveis : [],
  };
}

async function createPostgresPool() {
  if (!postgresConnectionString) {
    throw new Error("Configure DATABASE_URL ou DB_NAME, DB_USER, DB_PASSWORD, DB_HOST e DB_PORT para usar PostgreSQL.");
  }

  let Pool;
  try {
    ({ Pool } = await import("pg"));
  } catch {
    throw new Error("DependÃªncia pg nÃ£o instalada. Rode npm install antes de usar PostgreSQL.");
  }

  const pool = new Pool({
    connectionString: postgresConnectionString,
    ssl: process.env.PGSSL === "true" ? { rejectUnauthorized: process.env.PGSSL_REJECT_UNAUTHORIZED !== "false" } : undefined,
  });
  await pool.query(readFileSync(join(root, "db", "postgres-schema.sql"), "utf-8"));
  return pool;
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

function publicFileUrl(relativeUrl) {
  const publicAppUrl = String(process.env.PUBLIC_APP_URL || "").trim().replace(/\/+$/, "");
  return publicAppUrl ? `${publicAppUrl}${relativeUrl}` : "";
}

function passwordHash(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = pbkdf2Sync(String(password), salt, 120_000, 32, "sha256").toString("hex");
  return `pbkdf2$120000$${salt}$${hash}`;
}

function verifyPassword(password, storedHash) {
  const [scheme, iterationsText, salt, expected] = String(storedHash || "").split("$");
  if (scheme !== "pbkdf2" || !iterationsText || !salt || !expected) return false;
  const actual = pbkdf2Sync(String(password), salt, Number(iterationsText), 32, "sha256");
  const expectedBuffer = Buffer.from(expected, "hex");
  return actual.length === expectedBuffer.length && timingSafeEqual(actual, expectedBuffer);
}

function hashToken(token) {
  return createHash("sha256").update(String(token)).digest("hex");
}

function parseCookies(request) {
  return Object.fromEntries(String(request.headers.cookie || "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const separator = item.indexOf("=");
      return separator > -1
        ? [decodeURIComponent(item.slice(0, separator)), decodeURIComponent(item.slice(separator + 1))]
        : [decodeURIComponent(item), ""];
    }));
}

function sessionCookie(token, maxAgeSeconds) {
  const secure = process.env.COOKIE_SECURE === "true" ? "; Secure" : "";
  return `consult_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`;
}

function clearSessionCookie() {
  return "consult_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0";
}

const PERMISSION_KEYS = [
  "dashboard.view",
  "clientes.view",
  "clientes.create",
  "clientes.edit",
  "clientes.delete",
  "servicos.view",
  "servicos.create",
  "servicos.edit",
  "servicos.delete",
  "orcamentos.view",
  "orcamentos.create",
  "orcamentos.edit",
  "orcamentos.delete",
  "orcamentos.print",
  "orcamentos.share",
  "orcamentos.status",
  "financeiro.view",
  "relatorios.view",
  "relatorios.export",
  "usuarios.view",
  "usuarios.create",
  "usuarios.edit",
  "auditoria.view",
  "data.write",
];

const PROFILE_PERMISSION_PRESETS = {
  ADMIN: Object.fromEntries(PERMISSION_KEYS.map((key) => [key, true])),
  OPERADOR: {
    "dashboard.view": true,
    "clientes.view": true,
    "clientes.create": true,
    "clientes.edit": true,
    "clientes.delete": true,
    "servicos.view": true,
    "servicos.create": true,
    "servicos.edit": true,
    "servicos.delete": true,
    "orcamentos.view": true,
    "orcamentos.create": true,
    "orcamentos.edit": true,
    "orcamentos.delete": true,
    "orcamentos.print": true,
    "orcamentos.share": true,
    "data.write": true,
  },
  FINANCEIRO: {
    "dashboard.view": true,
    "orcamentos.view": true,
    "orcamentos.print": true,
    "orcamentos.share": true,
    "financeiro.view": true,
    "relatorios.view": true,
    "relatorios.export": true,
  },
  VISUALIZADOR: {
    "dashboard.view": true,
    "clientes.view": true,
    "servicos.view": true,
    "orcamentos.view": true,
    "financeiro.view": true,
    "relatorios.view": true,
  },
  CONVIDADO: {
    "dashboard.view": true,
    "clientes.view": true,
    "servicos.view": true,
    "orcamentos.view": true,
  },
};

function permissionsForProfile(perfil) {
  const preset = PROFILE_PERMISSION_PRESETS[String(perfil || "").toUpperCase()] || {};
  return Object.fromEntries(PERMISSION_KEYS.map((key) => [key, Boolean(preset[key])]));
}

function normalizePermissions(value, perfil) {
  const base = permissionsForProfile(perfil);
  const custom = typeof value === "string" ? JSON.parse(value || "{}") : (value || {});
  PERMISSION_KEYS.forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(custom, key)) base[key] = Boolean(custom[key]);
  });
  return base;
}

function effectivePermissions(user) {
  return normalizePermissions(user?.permissoes, user?.perfil);
}

function hasPermission(user, key) {
  if (!key) return true;
  return Boolean(effectivePermissions(user)[key]);
}

function publicUser(user) {
  return user ? {
    id: user.id,
    usuario: user.usuario,
    nome: user.nome,
    email: user.email || "",
    perfil: user.perfil,
    permissoes: effectivePermissions(user),
  } : null;
}

async function ensureAuthSchema() {
  if (postgresPool) {
    await postgresPool.query("ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS email TEXT NOT NULL DEFAULT ''");
    await postgresPool.query("ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS deve_trocar_senha BOOLEAN NOT NULL DEFAULT FALSE");
    await postgresPool.query("ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS permissoes JSONB");
    await postgresPool.query(`
      CREATE TABLE IF NOT EXISTS auditoria_logs (
        id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
        usuario_id BIGINT REFERENCES usuarios(id) ON DELETE SET NULL,
        usuario TEXT NOT NULL DEFAULT '',
        perfil TEXT NOT NULL DEFAULT '',
        acao TEXT NOT NULL,
        modulo TEXT NOT NULL DEFAULT '',
        entidade_tipo TEXT NOT NULL DEFAULT '',
        entidade_id TEXT NOT NULL DEFAULT '',
        detalhes JSONB NOT NULL DEFAULT '{}'::jsonb,
        ip TEXT NOT NULL DEFAULT '',
        user_agent TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await postgresPool.query("CREATE INDEX IF NOT EXISTS auditoria_logs_created_at_idx ON auditoria_logs(created_at)");
    await postgresPool.query("CREATE INDEX IF NOT EXISTS auditoria_logs_usuario_id_idx ON auditoria_logs(usuario_id)");
    await postgresPool.query("CREATE INDEX IF NOT EXISTS auditoria_logs_acao_idx ON auditoria_logs(acao)");
    return;
  }

  const columns = sqliteDb.prepare("PRAGMA table_info(usuarios)").all().map((column) => column.name);
  if (!columns.includes("email")) {
    sqliteDb.prepare("ALTER TABLE usuarios ADD COLUMN email TEXT NOT NULL DEFAULT ''").run();
  }
  if (!columns.includes("deve_trocar_senha")) {
    sqliteDb.prepare("ALTER TABLE usuarios ADD COLUMN deve_trocar_senha INTEGER NOT NULL DEFAULT 0").run();
  }
  if (!columns.includes("permissoes")) {
    sqliteDb.prepare("ALTER TABLE usuarios ADD COLUMN permissoes TEXT").run();
  }
}

async function ensureInitialAdminUser() {
  const adminUser = process.env.ADMIN_USER || "admin";
  const adminPassword = process.env.ADMIN_PASSWORD || "admin123";
  const adminEmail = process.env.ADMIN_EMAIL || "";

  if (postgresPool) {
    const result = await postgresPool.query("SELECT COUNT(*)::int AS total FROM usuarios");
    if (Number(result.rows[0]?.total || 0) > 0) return;
    await postgresPool.query(
      "INSERT INTO usuarios (usuario, nome, email, perfil, senha_hash, ativo) VALUES ($1, $2, $3, $4, $5, TRUE)",
      [adminUser, "Administrador", adminEmail, "ADMIN", passwordHash(adminPassword)],
    );
    return;
  }

  const row = sqliteDb.prepare("SELECT COUNT(*) AS total FROM usuarios").get();
  if (Number(row?.total || 0) > 0) return;
  sqliteDb.prepare("INSERT INTO usuarios (usuario, nome, email, perfil, senha_hash, ativo) VALUES (?, ?, ?, ?, ?, 1)")
    .run(adminUser, "Administrador", adminEmail, "ADMIN", passwordHash(adminPassword));
}

async function ensureGuestUser() {
  const guestUser = process.env.GUEST_USER || "convidado";
  const guestPassword = process.env.GUEST_PASSWORD || "convidado123";
  const guestEmail = process.env.GUEST_EMAIL || "convidado@consult.local";

  if (await findUserByLogin(guestUser)) return;

  if (postgresPool) {
    await postgresPool.query(
      "INSERT INTO usuarios (usuario, nome, email, perfil, senha_hash, ativo) VALUES ($1, $2, $3, $4, $5, TRUE)",
      [guestUser, "Convidado", guestEmail, "CONVIDADO", passwordHash(guestPassword)],
    );
    return;
  }

  sqliteDb.prepare("INSERT INTO usuarios (usuario, nome, email, perfil, senha_hash, ativo) VALUES (?, ?, ?, ?, ?, 1)")
    .run(guestUser, "Convidado", guestEmail, "CONVIDADO", passwordHash(guestPassword));
}

async function findUserByLogin(usuario) {
  if (postgresPool) {
    const result = await postgresPool.query(
      "SELECT id, usuario, nome, email, perfil, permissoes, senha_hash, deve_trocar_senha, ativo FROM usuarios WHERE lower(usuario) = lower($1) OR lower(email) = lower($1) LIMIT 1",
      [usuario],
    );
    return result.rows[0] || null;
  }

  return sqliteDb.prepare("SELECT id, usuario, nome, email, perfil, permissoes, senha_hash, deve_trocar_senha, ativo FROM usuarios WHERE lower(usuario) = lower(?) OR lower(email) = lower(?) LIMIT 1").get(usuario, usuario) || null;
}

async function listUsers() {
  if (postgresPool) {
    const result = await postgresPool.query(`
      SELECT id, usuario, nome, email, perfil, permissoes, ativo
      FROM usuarios
      ORDER BY nome, usuario
    `);
    return result.rows.map(publicUserAdmin);
  }

  return sqliteDb.prepare("SELECT id, usuario, nome, email, perfil, permissoes, ativo FROM usuarios ORDER BY nome, usuario")
    .all()
    .map(publicUserAdmin);
}

function publicUserAdmin(user) {
  return {
    id: Number(user.id),
    usuario: user.usuario,
    nome: user.nome,
    email: user.email || "",
    perfil: user.perfil,
    permissoes: effectivePermissions(user),
    ativo: postgresPool ? user.ativo === true : Number(user.ativo || 0) === 1,
  };
}

function requestIp(request) {
  return String(request.headers["cf-connecting-ip"] || request.headers["x-forwarded-for"] || request.socket?.remoteAddress || "")
    .split(",")[0]
    .trim();
}

function safeAuditDetails(details = {}) {
  const clean = { ...(details || {}) };
  ["senha", "senhaTemporaria", "novaSenha", "pass", "password"].forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(clean, key)) clean[key] = "[omitido]";
  });
  return clean;
}

async function logAudit(request, user, audit = {}) {
  const action = String(audit.acao || audit.action || "").trim();
  if (!action) return;
  const details = safeAuditDetails(audit.detalhes || audit.details || {});
  const row = {
    usuarioId: user?.id ? Number(user.id) : null,
    usuario: String(user?.usuario || audit.usuario || ""),
    perfil: String(user?.perfil || audit.perfil || ""),
    acao: action.slice(0, 120),
    modulo: String(audit.modulo || audit.module || "").slice(0, 80),
    entidadeTipo: String(audit.entidadeTipo || audit.entityType || "").slice(0, 80),
    entidadeId: String(audit.entidadeId || audit.entityId || "").slice(0, 160),
    detalhes: details,
    ip: request ? requestIp(request).slice(0, 120) : "",
    userAgent: request ? String(request.headers["user-agent"] || "").slice(0, 500) : "",
  };

  if (postgresPool) {
    await postgresPool.query(`
      INSERT INTO auditoria_logs (usuario_id, usuario, perfil, acao, modulo, entidade_tipo, entidade_id, detalhes, ip, user_agent)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)
    `, [row.usuarioId, row.usuario, row.perfil, row.acao, row.modulo, row.entidadeTipo, row.entidadeId, JSON.stringify(row.detalhes), row.ip, row.userAgent]);
    return;
  }

  sqliteDb.prepare(`
    INSERT INTO auditoria_logs (usuario_id, usuario, perfil, acao, modulo, entidade_tipo, entidade_id, detalhes, ip, user_agent)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(row.usuarioId, row.usuario, row.perfil, row.acao, row.modulo, row.entidadeTipo, row.entidadeId, JSON.stringify(row.detalhes), row.ip, row.userAgent);
}

async function listAuditLogs(filters = {}) {
  const limit = Math.min(Math.max(Number(filters.limit || 100), 10), 500);
  const where = [];
  const params = [];
  const addFilter = (sql, value) => {
    params.push(value);
    where.push(sql.replace("?", postgresPool ? `$${params.length}` : "?"));
  };

  if (filters.usuario) addFilter("lower(usuario) LIKE lower(?)", `%${String(filters.usuario).trim()}%`);
  if (filters.acao) addFilter("lower(acao) LIKE lower(?)", `%${String(filters.acao).trim()}%`);
  if (filters.modulo) addFilter("modulo = ?", String(filters.modulo).trim());
  if (filters.dataInicio) addFilter("created_at >= ?", String(filters.dataInicio));
  if (filters.dataFim) addFilter("created_at < ?", `${String(filters.dataFim)} 23:59:59`);

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  if (postgresPool) {
    params.push(limit);
    const result = await postgresPool.query(`
      SELECT id, usuario, perfil, acao, modulo, entidade_tipo, entidade_id, detalhes, ip, user_agent, created_at
      FROM auditoria_logs
      ${whereSql}
      ORDER BY created_at DESC, id DESC
      LIMIT $${params.length}
    `, params);
    return result.rows.map((row) => ({
      ...row,
      detalhes: row.detalhes || {},
      created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    }));
  }

  params.push(limit);
  return sqliteDb.prepare(`
    SELECT id, usuario, perfil, acao, modulo, entidade_tipo, entidade_id, detalhes, ip, user_agent, created_at
    FROM auditoria_logs
    ${whereSql}
    ORDER BY created_at DESC, id DESC
    LIMIT ?
  `).all(...params).map((row) => ({
    ...row,
    detalhes: JSON.parse(row.detalhes || "{}"),
  }));
}

function validateUserPayload(payload, isUpdate = false) {
  const usuario = String(payload.usuario || "").trim();
  const nome = String(payload.nome || "").trim();
  const email = safeNormalizeEmail(payload.email);
  const perfil = String(payload.perfil || "").trim().toUpperCase();
  const senha = String(payload.senha || "");
  const allowedProfiles = new Set(["ADMIN", "OPERADOR", "FINANCEIRO", "VISUALIZADOR", "CONVIDADO"]);

  if (!usuario) throw new Error("Informe o usuário.");
  if (!nome) throw new Error("Informe o nome.");
  if (!email) throw new Error("Informe um e-mail válido.");
  if (!allowedProfiles.has(perfil)) throw new Error("Perfil inválido.");
  if (!isUpdate && senha.length < 6) throw new Error("A senha deve ter pelo menos 6 caracteres.");
  if (isUpdate && senha && senha.length < 6) throw new Error("A nova senha deve ter pelo menos 6 caracteres.");

  return {
    usuario,
    nome,
    email,
    perfil,
    senha,
    ativo: payload.ativo !== false,
    permissoes: normalizePermissions(payload.permissoes || {}, perfil),
  };
}

async function createUser(payload) {
  const user = validateUserPayload(payload);
  if (postgresPool) {
    const result = await postgresPool.query(`
      INSERT INTO usuarios (usuario, nome, email, perfil, permissoes, senha_hash, ativo)
      VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
      RETURNING id, usuario, nome, email, perfil, permissoes, ativo
    `, [user.usuario, user.nome, user.email, user.perfil, JSON.stringify(user.permissoes), passwordHash(user.senha), user.ativo]);
    return publicUserAdmin(result.rows[0]);
  }

  const result = sqliteDb.prepare("INSERT INTO usuarios (usuario, nome, email, perfil, permissoes, senha_hash, ativo) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(user.usuario, user.nome, user.email, user.perfil, JSON.stringify(user.permissoes), passwordHash(user.senha), user.ativo ? 1 : 0);
  return publicUserAdmin(sqliteDb.prepare("SELECT id, usuario, nome, email, perfil, permissoes, ativo FROM usuarios WHERE id = ?").get(result.lastInsertRowid));
}

async function updateUser(id, payload, currentUserId) {
  const user = validateUserPayload(payload, true);
  if (Number(id) === Number(currentUserId) && !user.ativo) {
    throw new Error("Você não pode inativar o próprio usuário.");
  }

  if (postgresPool) {
    const params = [user.usuario, user.nome, user.email, user.perfil, user.ativo, Number(id), JSON.stringify(user.permissoes)];
    let sql = `
      UPDATE usuarios
      SET usuario = $1, nome = $2, email = $3, perfil = $4, ativo = $5, permissoes = $7::jsonb, updated_at = CURRENT_TIMESTAMP
    `;
    if (user.senha) {
      params.push(passwordHash(user.senha));
      sql += `, senha_hash = $8`;
    }
    sql += ` WHERE id = $6 RETURNING id, usuario, nome, email, perfil, permissoes, ativo`;
    const result = await postgresPool.query(sql, params);
    if (!result.rowCount) throw new Error("Usuário não encontrado.");
    return publicUserAdmin(result.rows[0]);
  }

  if (user.senha) {
    sqliteDb.prepare(`
      UPDATE usuarios
      SET usuario = ?, nome = ?, email = ?, perfil = ?, ativo = ?, permissoes = ?, senha_hash = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(user.usuario, user.nome, user.email, user.perfil, user.ativo ? 1 : 0, JSON.stringify(user.permissoes), passwordHash(user.senha), Number(id));
  } else {
    sqliteDb.prepare(`
      UPDATE usuarios
      SET usuario = ?, nome = ?, email = ?, perfil = ?, ativo = ?, permissoes = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(user.usuario, user.nome, user.email, user.perfil, user.ativo ? 1 : 0, JSON.stringify(user.permissoes), Number(id));
  }

  const updated = sqliteDb.prepare("SELECT id, usuario, nome, email, perfil, permissoes, ativo FROM usuarios WHERE id = ?").get(Number(id));
  if (!updated) throw new Error("Usuário não encontrado.");
  return publicUserAdmin(updated);
}

function temporaryPassword() {
  return randomBytes(6).toString("base64url").replace(/[^a-zA-Z0-9]/g, "").slice(0, 10);
}

function safeNormalizeEmail(value) {
  const text = String(value || "").trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text) ? text : "";
}

async function resetUserPasswordByEmail(usuario, email) {
  const login = String(usuario || "").trim();
  const targetEmail = safeNormalizeEmail(email);
  if (!login || !targetEmail) return false;
  const user = await findUserByLogin(login);
  const active = postgresPool ? user?.ativo === true : Number(user?.ativo || 0) === 1;
  if (!user || !active || normalizeEmail(user.email || "") !== targetEmail) return false;

  const newPassword = temporaryPassword();
  if (postgresPool) {
    await postgresPool.query(
      "UPDATE usuarios SET senha_hash = $1, deve_trocar_senha = TRUE, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
      [passwordHash(newPassword), user.id],
    );
  } else {
    sqliteDb.prepare("UPDATE usuarios SET senha_hash = ?, deve_trocar_senha = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(passwordHash(newPassword), user.id);
  }

  await sendSmtpMail({
    to: targetEmail,
    subject: "ConsultApp - Recuperação de senha",
    text: `Olá, ${user.nome}.\r\n\r\nFoi solicitada a recuperação de acesso ao ConsultApp.\r\n\r\nUsuário: ${user.usuario}\r\nSenha temporária: ${newPassword}\r\n\r\nApós entrar no sistema, altere sua senha com o administrador.\r\n\r\nSe você não solicitou esta recuperação, informe o administrador do sistema.`,
    html: `
      <p>Olá, ${escapeHtmlEmail(user.nome)}.</p>
      <p>Foi solicitada a recuperação de acesso ao ConsultApp.</p>
      <p><strong>Usuário:</strong> ${escapeHtmlEmail(user.usuario)}<br>
      <strong>Senha temporária:</strong> ${escapeHtmlEmail(newPassword)}</p>
      <p>Após entrar no sistema, altere sua senha com o administrador.</p>
      <p>Se você não solicitou esta recuperação, informe o administrador do sistema.</p>
    `,
  });

  return true;
}

function userMustChangePassword(user) {
  return postgresPool ? user?.deve_trocar_senha === true : Number(user?.deve_trocar_senha || 0) === 1;
}

async function changeTemporaryPassword(usuario, senhaTemporaria, novaSenha) {
  const user = await findUserByLogin(String(usuario || ""));
  const active = postgresPool ? user?.ativo === true : Number(user?.ativo || 0) === 1;
  if (!user || !active || !userMustChangePassword(user) || !verifyPassword(senhaTemporaria || "", user.senha_hash)) {
    throw new Error("Usuário ou senha temporária inválidos.");
  }
  if (String(novaSenha || "").length < 6) {
    throw new Error("A nova senha deve ter pelo menos 6 caracteres.");
  }
  if (String(novaSenha) === String(senhaTemporaria || "")) {
    throw new Error("A nova senha deve ser diferente da senha temporária.");
  }

  if (postgresPool) {
    await postgresPool.query(
      "UPDATE usuarios SET senha_hash = $1, deve_trocar_senha = FALSE, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
      [passwordHash(novaSenha), user.id],
    );
  } else {
    sqliteDb.prepare("UPDATE usuarios SET senha_hash = ?, deve_trocar_senha = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(passwordHash(novaSenha), user.id);
  }
}

async function createSession(userId) {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 12);

  if (postgresPool) {
    await postgresPool.query("DELETE FROM sessoes WHERE expires_at < CURRENT_TIMESTAMP");
    await postgresPool.query(
      "INSERT INTO sessoes (token_hash, usuario_id, expires_at) VALUES ($1, $2, $3)",
      [tokenHash, userId, expiresAt],
    );
  } else {
    sqliteDb.prepare("DELETE FROM sessoes WHERE expires_at < datetime('now')").run();
    sqliteDb.prepare("INSERT INTO sessoes (token_hash, usuario_id, expires_at) VALUES (?, ?, ?)")
      .run(tokenHash, userId, expiresAt.toISOString());
  }

  return token;
}

async function destroySession(token) {
  if (!token) return;
  const tokenHash = hashToken(token);
  if (postgresPool) {
    await postgresPool.query("DELETE FROM sessoes WHERE token_hash = $1", [tokenHash]);
  } else {
    sqliteDb.prepare("DELETE FROM sessoes WHERE token_hash = ?").run(tokenHash);
  }
}

async function currentUser(request) {
  const token = parseCookies(request).consult_session;
  if (!token) return null;
  const tokenHash = hashToken(token);

  if (postgresPool) {
    const result = await postgresPool.query(`
      SELECT u.id, u.usuario, u.nome, u.email, u.perfil, u.permissoes
      FROM sessoes s
      JOIN usuarios u ON u.id = s.usuario_id
      WHERE s.token_hash = $1
        AND s.expires_at > CURRENT_TIMESTAMP
        AND u.ativo = TRUE
      LIMIT 1
    `, [tokenHash]);
    return result.rows[0] || null;
  }

  return sqliteDb.prepare(`
    SELECT u.id, u.usuario, u.nome, u.email, u.perfil, u.permissoes
    FROM sessoes s
    JOIN usuarios u ON u.id = s.usuario_id
    WHERE s.token_hash = ?
      AND s.expires_at > datetime('now')
      AND u.ativo = 1
    LIMIT 1
  `).get(tokenHash) || null;
}

function sendJson(response, status, payload, headers = {}) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...headers });
  response.end(JSON.stringify(payload));
}

async function requireUser(request, response, allowedProfiles = []) {
  const user = await currentUser(request);
  if (!user) {
    sendJson(response, 401, { ok: false, error: "Usuário não autenticado." });
    return null;
  }
  if (allowedProfiles.length && !allowedProfiles.includes(user.perfil)) {
    sendJson(response, 403, { ok: false, error: "Usuário sem permissão para esta ação." });
    return null;
  }
  return user;
}

async function requirePermission(request, response, permission) {
  const user = await requireUser(request, response);
  if (!user) return null;
  if (!hasPermission(user, permission)) {
    await logAudit(request, user, {
      acao: "permissao.negada",
      modulo: "seguranca",
      entidadeTipo: "permissao",
      entidadeId: permission,
      detalhes: { metodo: request.method, rota: request.url },
    }).catch(() => {});
    sendJson(response, 403, { ok: false, error: "UsuÃ¡rio sem permissÃ£o para esta aÃ§Ã£o." });
    return null;
  }
  return user;
}

async function readAppState() {
  if (postgresPool) {
    return readRelationalAppState();
  }

  const row = sqliteDb.prepare("SELECT data FROM app_state WHERE id = ?").get("main");
  return row ? normalizeAppState(JSON.parse(row.data)) : null;
}

async function writeAppState(state) {
  const normalized = normalizeAppState(state);
  if (postgresPool) {
    await writeRelationalAppState(normalized);
    return normalized;
  }

  sqliteDb.prepare(`
    INSERT INTO app_state (id, data, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = CURRENT_TIMESTAMP
  `).run("main", JSON.stringify(normalized));
  return normalized;
}

async function readRelationalAppState() {
  const clientsResult = await postgresPool.query(`
    SELECT documento, nome, telefone, email, cep, bairro, endereco, numero, complemento,
           uf, cidade, observacoes, razao_social, nome_fantasia, situacao_cnpj
    FROM clientes
    ORDER BY nome, documento
  `);

  if (!clientsResult.rowCount) {
    const legacyResult = await postgresPool.query("SELECT data FROM app_state WHERE id = $1", ["main"]);
    return legacyResult.rows[0]?.data ? normalizeAppState(legacyResult.rows[0].data) : normalizeAppState({});
  }

  const [responsaveisResult, servicosResult, orcamentosResult, itensResult] = await Promise.all([
    postgresPool.query("SELECT cliente_documento, cpf, nome FROM responsaveis ORDER BY nome, cpf"),
    postgresPool.query(`
      SELECT codigo, nome, status, frequencia, tipo, valor, observacoes
      FROM servicos
      ORDER BY codigo
    `),
    postgresPool.query(`
      SELECT numero, cliente_documento, data, status, observacoes
      FROM orcamentos
      ORDER BY numero
    `),
    postgresPool.query(`
      SELECT orcamento_numero, posicao, servico_codigo, quantidade, valor_unitario, desconto
      FROM orcamento_itens
      ORDER BY orcamento_numero, posicao
    `),
  ]);

  const responsavelByCliente = new Map();
  const responsaveis = responsaveisResult.rows.map((row) => {
    if (!responsavelByCliente.has(row.cliente_documento)) responsavelByCliente.set(row.cliente_documento, row);
    return {
      clienteDocumento: row.cliente_documento,
      cpf: row.cpf,
      nome: row.nome,
    };
  });
  const itemsByBudget = new Map();
  itensResult.rows.forEach((row) => {
    const itens = itemsByBudget.get(Number(row.orcamento_numero)) || [];
    itens.push({
      servicoCodigo: row.servico_codigo,
      quantidade: Number(row.quantidade || 0),
      valorUnitario: Number(row.valor_unitario || 0),
      desconto: Number(row.desconto || 0),
    });
    itemsByBudget.set(Number(row.orcamento_numero), itens);
  });

  return normalizeAppState({
    clientes: clientsResult.rows.map((row) => {
      const responsavel = responsavelByCliente.get(row.documento);
      return {
        documento: row.documento,
        nome: row.nome,
        telefone: row.telefone,
        email: row.email,
        cep: row.cep,
        bairro: row.bairro,
        endereco: row.endereco,
        numero: row.numero,
        complemento: row.complemento,
        uf: row.uf,
        cidade: row.cidade,
        obs: row.observacoes,
        razaoSocial: row.razao_social,
        nomeFantasia: row.nome_fantasia,
        situacaoCnpj: row.situacao_cnpj,
        responsavelNome: responsavel?.nome || "",
        responsavelCpf: responsavel?.cpf || "",
      };
    }),
    responsaveis,
    servicos: servicosResult.rows.map((row) => ({
      codigo: row.codigo,
      nome: row.nome,
      status: row.status,
      frequencia: row.frequencia,
      tipo: row.tipo,
      valor: Number(row.valor || 0),
      observacoes: row.observacoes,
    })),
    orcamentos: orcamentosResult.rows.map((row) => ({
      numero: Number(row.numero),
      clienteDocumento: row.cliente_documento,
      data: dbDateText(row.data),
      status: row.status,
      observacoes: row.observacoes,
      itens: itemsByBudget.get(Number(row.numero)) || [],
    })),
  });
}

async function writeRelationalAppState(state) {
  const client = await postgresPool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM orcamento_itens");
    await client.query("DELETE FROM orcamentos");
    await client.query("DELETE FROM responsaveis");
    await client.query("DELETE FROM servicos");
    await client.query("DELETE FROM clientes");

    for (const cliente of state.clientes) {
      await client.query(`
        INSERT INTO clientes (
          documento, nome, telefone, email, cep, bairro, endereco, numero, complemento,
          uf, cidade, observacoes, razao_social, nome_fantasia, situacao_cnpj
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9,
          $10, $11, $12, $13, $14, $15
        )
      `, [
        requiredText(cliente.documento, "documento do cliente"),
        requiredText(cliente.nome || cliente.razaoSocial || cliente.nomeFantasia, "nome do cliente"),
        dbText(cliente.telefone),
        dbText(cliente.email),
        dbText(cliente.cep),
        dbText(cliente.bairro),
        dbText(cliente.endereco),
        dbText(cliente.numero),
        dbText(cliente.complemento),
        dbText(cliente.uf),
        dbText(cliente.cidade),
        dbText(cliente.obs),
        dbText(cliente.razaoSocial),
        dbText(cliente.nomeFantasia),
        dbText(cliente.situacaoCnpj),
      ]);
    }

    for (const responsavel of state.responsaveis) {
      await client.query(`
        INSERT INTO responsaveis (cpf, cliente_documento, nome)
        VALUES ($1, $2, $3)
      `, [
        requiredText(responsavel.cpf, "CPF do responsavel"),
        requiredText(responsavel.clienteDocumento, "cliente do responsavel"),
        requiredText(responsavel.nome, "nome do responsavel"),
      ]);
    }

    for (const servico of state.servicos) {
      await client.query(`
        INSERT INTO servicos (codigo, nome, status, frequencia, tipo, valor, observacoes)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [
        requiredText(servico.codigo, "codigo do servico"),
        requiredText(servico.nome, "nome do servico"),
        dbText(servico.status || "ATIVO"),
        dbText(servico.frequencia),
        dbText(servico.tipo),
        dbNumber(servico.valor),
        dbText(servico.observacoes),
      ]);
    }

    for (const orcamento of state.orcamentos) {
      await client.query(`
        INSERT INTO orcamentos (numero, cliente_documento, data, status, observacoes)
        VALUES ($1, $2, $3, $4, $5)
      `, [
        Number(orcamento.numero),
        requiredText(orcamento.clienteDocumento, "cliente do orcamento"),
        requiredText(orcamento.data, "data do orcamento"),
        dbText(orcamento.status || "EM ANÁLISE"),
        dbText(orcamento.observacoes),
      ]);

      for (const [index, item] of (orcamento.itens || []).entries()) {
        await client.query(`
          INSERT INTO orcamento_itens (
            orcamento_numero, posicao, servico_codigo, quantidade, valor_unitario, desconto
          ) VALUES ($1, $2, $3, $4, $5, $6)
        `, [
          Number(orcamento.numero),
          index,
          requiredText(item.servicoCodigo, "servico do item"),
          dbNumber(item.quantidade),
          dbNumber(item.valorUnitario),
          dbNumber(item.desconto),
        ]);
      }
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function dbText(value) {
  return String(value || "").trim();
}

function requiredText(value, label) {
  const text = dbText(value);
  if (!text) throw new Error(`Campo obrigatorio ausente: ${label}.`);
  return text;
}

function dbNumber(value) {
  return Number(value || 0);
}

function dbDateText(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value || "").slice(0, 10);
}

function safeFileName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .trim();
}

function safePdfFileName(value) {
  const clean = safeFileName(value);
  return clean.toLowerCase().endsWith(".pdf") ? clean : `${clean}.pdf`;
}

function isApprovedStatus(value) {
  return String(value || "").toUpperCase().includes("APROV");
}

function contentTypeForFile(fileName) {
  return types[extname(fileName).toLowerCase()] || "application/octet-stream";
}

async function saveStoredFile({ categoria, nome, mimeType, conteudo }) {
  const buffer = Buffer.isBuffer(conteudo) ? conteudo : Buffer.from(conteudo);
  if (postgresPool) {
    await postgresPool.query(
      `INSERT INTO arquivos (categoria, nome, mime_type, conteudo, tamanho, updated_at)
       VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
       ON CONFLICT (categoria, nome)
       DO UPDATE SET mime_type = EXCLUDED.mime_type,
                     conteudo = EXCLUDED.conteudo,
                     tamanho = EXCLUDED.tamanho,
                     updated_at = CURRENT_TIMESTAMP`,
      [categoria, nome, mimeType, buffer, buffer.length],
    );
    return;
  }

  sqliteDb.prepare(`
    INSERT INTO arquivos (categoria, nome, mime_type, conteudo, tamanho, updated_at)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(categoria, nome)
    DO UPDATE SET mime_type = excluded.mime_type,
                  conteudo = excluded.conteudo,
                  tamanho = excluded.tamanho,
                  updated_at = CURRENT_TIMESTAMP
  `).run(categoria, nome, mimeType, buffer, buffer.length);
}

async function readStoredFile(categoria, nome) {
  if (postgresPool) {
    const result = await postgresPool.query(
      "SELECT nome, mime_type, conteudo, tamanho FROM arquivos WHERE categoria = $1 AND nome = $2",
      [categoria, nome],
    );
    const row = result.rows[0];
    return row ? {
      nome: row.nome,
      mimeType: row.mime_type,
      conteudo: Buffer.from(row.conteudo),
      tamanho: Number(row.tamanho || row.conteudo?.length || 0),
    } : null;
  }

  const row = sqliteDb.prepare(
    "SELECT nome, mime_type, conteudo, tamanho FROM arquivos WHERE categoria = ? AND nome = ?",
  ).get(categoria, nome);
  return row ? {
    nome: row.nome,
    mimeType: row.mime_type,
    conteudo: Buffer.from(row.conteudo),
    tamanho: Number(row.tamanho || row.conteudo?.length || 0),
  } : null;
}

function loadSmtpConfig() {
  const fileConfig = existsSync(smtpConfigPath) ? JSON.parse(readFileSync(smtpConfigPath, "utf-8")) : {};
  const config = {
    host: process.env.SMTP_HOST || fileConfig.host,
    port: Number(process.env.SMTP_PORT || fileConfig.port || 587),
    secure: String(process.env.SMTP_SECURE ?? fileConfig.secure ?? "false") === "true",
    user: process.env.SMTP_USER || fileConfig.user,
    pass: process.env.SMTP_PASS || fileConfig.pass,
    from: process.env.SMTP_FROM || fileConfig.from || fileConfig.user,
    fromName: process.env.SMTP_FROM_NAME || fileConfig.fromName || "Consult",
  };

  if (!config.host || !config.user || !config.pass || !config.from) {
    throw new Error("SMTP não configurado. Preencha o arquivo smtp-config.json.");
  }
  return config;
}

function encodeHeader(value) {
  return `=?UTF-8?B?${Buffer.from(String(value), "utf-8").toString("base64")}?=`;
}

function normalizeEmail(value) {
  const text = String(value || "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) {
    throw new Error("E-mail de destino inválido.");
  }
  return text;
}

function escapeHtmlEmail(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function friendlySmtpError(error) {
  const message = String(error?.message || error || "");
  if (message.includes("535") || message.toLowerCase().includes("badcredentials")) {
    return "Falha de autenticação no Gmail. Use uma senha de app do Google no campo pass do smtp-config.json, não a senha normal da conta.";
  }
  if (message.toLowerCase().includes("smtp não configurado")) return message;
  return message || "Falha ao enviar e-mail.";
}

function dotStuff(message) {
  return String(message).replace(/^\./gm, "..");
}

function createMailMessage({ config, to, subject, text, html, attachmentPath, attachmentName, attachmentContent, attachmentMimeType }) {
  const mixedBoundary = `mixed-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const altBoundary = `alt-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const attachmentBuffer = attachmentContent
    ? Buffer.from(attachmentContent)
    : attachmentPath
      ? readFileSync(attachmentPath)
      : null;
  const attachment = attachmentBuffer ? attachmentBuffer.toString("base64").replace(/.{1,76}/g, "$&\r\n").trim() : "";

  const parts = [
    `From: ${encodeHeader(config.fromName)} <${config.from}>`,
    `To: <${to}>`,
    `Subject: ${encodeHeader(subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${mixedBoundary}"`,
    "",
    `--${mixedBoundary}`,
    `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
    "",
    `--${altBoundary}`,
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    text,
    "",
    `--${altBoundary}`,
    "Content-Type: text/html; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    html,
    "",
    `--${altBoundary}--`,
  ];

  if (attachment) {
    parts.push(
      `--${mixedBoundary}`,
      `Content-Type: ${attachmentMimeType || "application/pdf"}; name="${attachmentName}"`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="${attachmentName}"`,
      "",
      attachment,
      "",
    );
  }

  parts.push(`--${mixedBoundary}--`, "");
  return parts.join("\r\n");
}

function createSmtpSession(socket) {
  let buffer = "";
  const waiters = [];

  socket.setEncoding("utf-8");
  socket.on("data", (chunk) => {
    buffer += chunk;
    flush();
  });
  socket.on("error", (error) => {
    while (waiters.length) waiters.shift().reject(error);
  });

  function flush() {
    const match = buffer.match(/(?:^|\r?\n)(\d{3}) [^\r\n]*(?:\r?\n|$)/);
    if (!match || !waiters.length) return;
    const responseText = buffer.slice(0, match.index + match[0].length);
    buffer = buffer.slice(match.index + match[0].length);
    waiters.shift().resolve(responseText);
  }

  function readResponse() {
    return new Promise((resolveResponse, rejectResponse) => {
      waiters.push({ resolve: resolveResponse, reject: rejectResponse });
      flush();
    });
  }

  async function command(line, expected) {
    socket.write(`${line}\r\n`);
    const responseText = await readResponse();
    const code = Number(responseText.slice(0, 3));
    const allowed = Array.isArray(expected) ? expected : [expected];
    if (!allowed.includes(code)) throw new Error(`Falha SMTP em "${line}": ${responseText.trim()}`);
    return responseText;
  }

  return { command, readResponse, socket };
}

function openSmtpSocket(config) {
  return new Promise((resolveSocket, rejectSocket) => {
    const socket = config.secure
      ? tlsConnect({ host: config.host, port: config.port, servername: config.host }, () => resolveSocket(socket))
      : netConnect({ host: config.host, port: config.port }, () => resolveSocket(socket));
    socket.once("error", rejectSocket);
  });
}

async function sendSmtpMail({ to, subject, text, html, attachmentPath, attachmentName, attachmentContent, attachmentMimeType }) {
  const config = loadSmtpConfig();
  to = normalizeEmail(to);
  let socket = await openSmtpSocket(config);
  let smtp = createSmtpSession(socket);
  await smtp.readResponse();
  await smtp.command(`EHLO ${config.host}`, 250);

  if (!config.secure) {
    await smtp.command("STARTTLS", 220);
    socket = tlsConnect({ socket, servername: config.host });
    smtp = createSmtpSession(socket);
    await smtp.command(`EHLO ${config.host}`, 250);
  }

  await smtp.command("AUTH LOGIN", 334);
  await smtp.command(Buffer.from(config.user).toString("base64"), 334);
  await smtp.command(Buffer.from(config.pass).toString("base64"), 235);
  await smtp.command(`MAIL FROM:<${config.from}>`, 250);
  await smtp.command(`RCPT TO:<${to}>`, [250, 251]);
  await smtp.command("DATA", 354);
  const message = createMailMessage({ config, to, subject, text, html, attachmentPath, attachmentName, attachmentContent, attachmentMimeType });
  socket.write(`${dotStuff(message)}\r\n.\r\n`);
  const dataResponse = await smtp.readResponse();
  if (Number(dataResponse.slice(0, 3)) !== 250) throw new Error(`Falha ao enviar e-mail: ${dataResponse.trim()}`);
  await smtp.command("QUIT", 221).catch(() => {});
  socket.end();
}

function onlyDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function normalizeCnpjStatus(value) {
  const text = String(value || "").trim();
  const upper = text.toUpperCase();
  const map = {
    "1": "NULA",
    "2": "ATIVA",
    "3": "SUSPENSA",
    "4": "INAPTA",
    "8": "BAIXADA",
  };

  return map[upper] || upper || "";
}

function chromiumPath() {
  const candidates = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  ];

  return candidates.find((candidate) => existsSync(candidate)) || "";
}

function printHtmlToPdf(html, target) {
  const browserExe = chromiumPath();
  if (!browserExe) {
    throw new Error("Chrome ou Edge nÃ£o encontrado para gerar o PDF.");
  }

  const tempDir = mkdtempSync(join(root, ".pdf-temp-"));
  const htmlPath = join(tempDir, "orcamento.html");
  try {
    writeFileSync(htmlPath, html, "utf-8");
    const result = spawnSync(browserExe, [
      "--headless=new",
      "--disable-gpu",
      "--disable-extensions",
      "--allow-file-access-from-files",
      "--no-pdf-header-footer",
      "--print-to-pdf-no-header",
      `--print-to-pdf=${target}`,
      pathToFileURL(htmlPath).href,
    ], { encoding: "utf-8" });

    if (result.status !== 0 || !existsSync(target)) {
      throw new Error(result.stderr || "Falha ao converter o orÃ§amento para PDF.");
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function renderChromiumPath() {
  const candidates = [
    process.env.CHROME_PATH,
    process.env.CHROMIUM_PATH,
    chromiumPath(),
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ];
  return candidates.filter(Boolean).find((candidate) => existsSync(candidate)) || "";
}

function installPuppeteerChrome() {
  const cliPath = join(root, "node_modules", "puppeteer", "lib", "puppeteer", "node", "cli.js");
  if (!existsSync(cliPath)) {
    throw new Error("CLI do Puppeteer nao encontrada em node_modules.");
  }

  mkdirSync(puppeteerCacheDir, { recursive: true });
  const result = spawnSync(process.execPath, [cliPath, "browsers", "install", "chrome"], {
    cwd: root,
    encoding: "utf-8",
    env: {
      ...process.env,
      PUPPETEER_CACHE_DIR: puppeteerCacheDir,
    },
  });

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || "Falha ao instalar o Chrome do Puppeteer.");
  }
}

async function printHtmlToPdfPortable(html, target) {
  const browserExe = renderChromiumPath();
  if (browserExe) {
    const tempDir = mkdtempSync(join(root, ".pdf-temp-"));
    const htmlPath = join(tempDir, "documento.html");
    try {
      writeFileSync(htmlPath, html, "utf-8");
      const result = spawnSync(browserExe, [
        "--headless=new",
        "--disable-gpu",
        "--disable-extensions",
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--allow-file-access-from-files",
        "--no-pdf-header-footer",
        "--print-to-pdf-no-header",
        `--print-to-pdf=${target}`,
        pathToFileURL(htmlPath).href,
      ], { encoding: "utf-8" });

      if (result.status !== 0 || !existsSync(target)) {
        throw new Error(result.stderr || "Falha ao converter o PDF.");
      }
      return;
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }

  let browser;
  try {
    const puppeteer = await import("puppeteer");
    const launchOptions = {
      headless: "new",
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    };

    try {
      browser = await puppeteer.default.launch(launchOptions);
    } catch (firstError) {
      installPuppeteerChrome();
      browser = await puppeteer.default.launch(launchOptions);
    }

    const page = await browser.newPage();
    page.setDefaultTimeout(120000);
    page.setDefaultNavigationTimeout(120000);
    await page.setContent(html, { waitUntil: "domcontentloaded", timeout: 120000 });
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
    await page.pdf({ path: target, printBackground: true, preferCSSPageSize: true, timeout: 120000 });
  } catch (error) {
    throw new Error(`Falha ao gerar o PDF no servidor. Detalhe: ${error.message}`);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

const crcTable = new Uint32Array(256).map((_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = date.getDate();
  const month = date.getMonth() + 1;
  const year = Math.max(1980, date.getFullYear()) - 1980;
  return { date: (year << 9) | (month << 5) | day, time };
}

function zipStore(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const stamp = dosDateTime();

  files.forEach((file) => {
    const name = Buffer.from(file.name, "utf-8");
    const data = Buffer.isBuffer(file.data) ? file.data : Buffer.from(String(file.data), "utf-8");
    const crc = crc32(data);
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(stamp.time, 10);
    local.writeUInt16LE(stamp.date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    name.copy(local, 30);
    localParts.push(local, data);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(stamp.time, 12);
    central.writeUInt16LE(stamp.date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);
    centralParts.push(central);

    offset += local.length + data.length;
  });

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, ...centralParts, end]);
}

function xmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function excelColumnName(index) {
  let name = "";
  let value = index;
  while (value > 0) {
    const mod = (value - 1) % 26;
    name = String.fromCharCode(65 + mod) + name;
    value = Math.floor((value - mod) / 26);
  }
  return name;
}

function worksheetRow(values, rowIndex) {
  const cells = Array.isArray(values) ? values : [values];
  return `<row r="${rowIndex}">${cells.map((value, columnIndex) => {
    const ref = `${excelColumnName(columnIndex + 1)}${rowIndex}`;
    return `<c r="${ref}" t="inlineStr"><is><t>${xmlEscape(value)}</t></is></c>`;
  }).join("")}</row>`;
}

function createReportXlsx(report) {
  const columns = Array.isArray(report?.columns) ? report.columns : [];
  const summary = Array.isArray(report?.summary) ? report.summary : [];
  const rows = Array.isArray(report?.rows) ? report.rows : [];
  if (!columns.length) throw new Error("Relatório inválido.");

  const width = Math.max(columns.length, 2);
  const sheetRows = [
    [report.title || "Relatório"],
    [report.subtitle || ""],
    [],
    ...summary.map((item) => [item.label || "", item.value || ""]),
    [],
    columns,
    ...rows.map((row) => (Array.isArray(row) ? row : [row])),
  ];
  const sheetData = sheetRows.map((row, index) => worksheetRow(row, index + 1)).join("");
  const lastColumn = excelColumnName(width);
  const dimension = `A1:${lastColumn}${sheetRows.length}`;
  const worksheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <dimension ref="${dimension}"/>
  <sheetViews><sheetView workbookViewId="0"/></sheetViews>
  <sheetFormatPr defaultRowHeight="15"/>
  <cols>${Array.from({ length: width }, (_, index) => `<col min="${index + 1}" max="${index + 1}" width="${index === 1 ? 34 : 18}" customWidth="1"/>`).join("")}</cols>
  <sheetData>${sheetData}</sheetData>
</worksheet>`;

  return zipStore([
    {
      name: "[Content_Types].xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`,
    },
    {
      name: "_rels/.rels",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`,
    },
    {
      name: "xl/workbook.xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Relatório" sheetId="1" r:id="rId1"/></sheets>
</workbook>`,
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`,
    },
    { name: "xl/worksheets/sheet1.xml", data: worksheet },
    {
      name: "xl/styles.xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="1"><font><sz val="11"/><name val="Arial"/></font></fonts>
  <fills count="1"><fill><patternFill patternType="none"/></fill></fills>
  <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`,
    },
    {
      name: "docProps/core.xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>${xmlEscape(report.title || "Relatório")}</dc:title>
  <dc:creator>ConsultApp</dc:creator>
  <dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:created>
</cp:coreProperties>`,
    },
    {
      name: "docProps/app.xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>ConsultApp</Application>
</Properties>`,
    },
  ]);
}

async function fetchJson(url) {
  const apiResponse = await fetch(url, { headers: { Accept: "application/json" } });
  const data = await apiResponse.json().catch(() => ({}));
  return { apiResponse, data };
}

async function consultCnpj(cnpj) {
  const brasilApi = await fetchJson(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`);
  if (brasilApi.apiResponse.ok) {
    return {
      razaoSocial: brasilApi.data.razao_social || "",
      nomeFantasia: brasilApi.data.nome_fantasia || "",
      situacaoCnpj: normalizeCnpjStatus(brasilApi.data.descricao_situacao_cadastral || brasilApi.data.situacao_cadastral),
    };
  }

  const cnpjWs = await fetchJson(`https://publica.cnpj.ws/cnpj/${cnpj}`);
  if (cnpjWs.apiResponse.ok) {
    return {
      razaoSocial: cnpjWs.data.razao_social || "",
      nomeFantasia: cnpjWs.data.estabelecimento?.nome_fantasia || "",
      situacaoCnpj: normalizeCnpjStatus(cnpjWs.data.estabelecimento?.situacao_cadastral || cnpjWs.data.estabelecimento?.situacao_cadastral_id),
    };
  }

  const message = brasilApi.data.message || brasilApi.data.type || cnpjWs.data?.detalhes || cnpjWs.data?.message || "CNPJ não encontrado.";
  const error = new Error(message);
  error.status = brasilApi.apiResponse.status || cnpjWs.apiResponse.status || 404;
  throw error;
}

async function consultCep(cep) {
  const viaCep = await fetchJson(`https://viacep.com.br/ws/${cep}/json/`);
  if (!viaCep.apiResponse.ok || viaCep.data.erro) {
    const error = new Error("CEP não encontrado.");
    error.status = viaCep.apiResponse.status || 404;
    throw error;
  }

  return {
    cep,
    endereco: viaCep.data.logradouro || "",
    bairro: viaCep.data.bairro || "",
    cidade: viaCep.data.localidade || "",
    uf: viaCep.data.uf || "",
  };
}

createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host}`);

  if (request.method === "POST" && url.pathname === "/api/auth/login") {
    try {
      const payload = JSON.parse(await readBody(request));
      const user = await findUserByLogin(String(payload.usuario || ""));
      const active = postgresPool ? user?.ativo === true : Number(user?.ativo || 0) === 1;
      if (!user || !active || !verifyPassword(payload.senha || "", user.senha_hash)) {
        await logAudit(request, user, {
          acao: "auth.login.falha",
          modulo: "seguranca",
          entidadeTipo: "usuario",
          entidadeId: String(payload.usuario || ""),
          detalhes: { motivo: "credenciais_invalidas" },
        }).catch(() => {});
        sendJson(response, 401, { ok: false, error: "Usuário ou senha inválidos." });
        return;
      }

      if (userMustChangePassword(user)) {
        sendJson(response, 200, {
          ok: true,
          passwordChangeRequired: true,
          user: { usuario: user.usuario, nome: user.nome },
        });
        return;
      }

      const token = await createSession(user.id);
      await logAudit(request, user, {
        acao: "auth.login.sucesso",
        modulo: "seguranca",
        entidadeTipo: "usuario",
        entidadeId: user.usuario,
      }).catch(() => {});
      sendJson(response, 200, { ok: true, user: publicUser(user) }, { "Set-Cookie": sessionCookie(token, 60 * 60 * 12) });
    } catch (error) {
      sendJson(response, 500, { ok: false, error: error.message });
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/auth/guest") {
    try {
      const guestUser = process.env.GUEST_USER || "convidado";
      const user = await findUserByLogin(guestUser);
      const active = postgresPool ? user?.ativo === true : Number(user?.ativo || 0) === 1;
      if (!user || !active || user.perfil !== "CONVIDADO") {
        sendJson(response, 403, { ok: false, error: "Acesso de convidado indisponível." });
        return;
      }

      const token = await createSession(user.id);
      await logAudit(request, user, {
        acao: "auth.login.convidado",
        modulo: "seguranca",
        entidadeTipo: "usuario",
        entidadeId: user.usuario,
      }).catch(() => {});
      sendJson(response, 200, { ok: true, user: publicUser(user) }, { "Set-Cookie": sessionCookie(token, 60 * 60 * 12) });
    } catch (error) {
      sendJson(response, 500, { ok: false, error: error.message });
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/auth/logout") {
    const user = await currentUser(request);
    await logAudit(request, user, {
      acao: "auth.logout",
      modulo: "seguranca",
      entidadeTipo: "usuario",
      entidadeId: user?.usuario || "",
    }).catch(() => {});
    await destroySession(parseCookies(request).consult_session);
    sendJson(response, 200, { ok: true }, { "Set-Cookie": clearSessionCookie() });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/auth/close") {
    const user = await currentUser(request);
    await logAudit(request, user, {
      acao: "auth.fechar_tela",
      modulo: "seguranca",
      entidadeTipo: "usuario",
      entidadeId: user?.usuario || "",
    }).catch(() => {});
    await destroySession(parseCookies(request).consult_session);
    sendJson(response, 200, { ok: true }, { "Set-Cookie": clearSessionCookie() });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/auth/confirm-password") {
    const user = await currentUser(request);
    if (!user) {
      sendJson(response, 401, { ok: false, error: "UsuÃ¡rio nÃ£o autenticado." });
      return;
    }
    try {
      const payload = JSON.parse(await readBody(request));
      const permission = String(payload.permission || "");
      if (permission && !hasPermission(user, permission)) {
        await logAudit(request, user, {
          acao: "auth.confirmar_senha.negado",
          modulo: "seguranca",
          entidadeTipo: "usuario",
          entidadeId: user.usuario,
          detalhes: { permissao: permission },
        }).catch(() => {});
        sendJson(response, 403, { ok: false, error: "UsuÃ¡rio sem permissÃ£o para esta confirmaÃ§Ã£o." });
        return;
      }

      const fullUser = await findUserByLogin(user.usuario);
      if (!fullUser || !verifyPassword(payload.senha || "", fullUser.senha_hash)) {
        await logAudit(request, user, {
          acao: "auth.confirmar_senha.falha",
          modulo: "seguranca",
          entidadeTipo: "usuario",
          entidadeId: user.usuario,
          detalhes: { permissao: permission },
        }).catch(() => {});
        sendJson(response, 401, { ok: false, error: "Senha invÃ¡lida." });
        return;
      }

      await logAudit(request, user, {
        acao: "auth.confirmar_senha.sucesso",
        modulo: "seguranca",
        entidadeTipo: "usuario",
        entidadeId: user.usuario,
        detalhes: { permissao: permission },
      }).catch(() => {});
      sendJson(response, 200, { ok: true });
    } catch (error) {
      sendJson(response, 500, { ok: false, error: error.message });
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/auth/forgot-password") {
    try {
      const payload = JSON.parse(await readBody(request));
      await resetUserPasswordByEmail(payload.usuario, payload.email);
      await logAudit(request, null, {
        acao: "auth.recuperar_senha",
        modulo: "seguranca",
        entidadeTipo: "usuario",
        entidadeId: String(payload.usuario || ""),
        detalhes: { email: safeNormalizeEmail(payload.email) },
      }).catch(() => {});
      sendJson(response, 200, { ok: true, message: "Se os dados estiverem corretos, enviaremos uma senha temporária para o e-mail cadastrado." });
    } catch (error) {
      sendJson(response, 500, { ok: false, error: friendlySmtpError(error) });
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/auth/change-temporary-password") {
    try {
      const payload = JSON.parse(await readBody(request));
      await changeTemporaryPassword(payload.usuario, payload.senhaTemporaria, payload.novaSenha);
      await logAudit(request, null, {
        acao: "auth.trocar_senha_temporaria",
        modulo: "seguranca",
        entidadeTipo: "usuario",
        entidadeId: String(payload.usuario || ""),
      }).catch(() => {});
      sendJson(response, 200, { ok: true, message: "Senha alterada com sucesso. Faça login novamente com a nova senha." });
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error.message });
    }
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/auth/me") {
    sendJson(response, 200, { ok: true, user: publicUser(await currentUser(request)) });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/usuarios") {
    if (!await requirePermission(request, response, "usuarios.view")) return;
    try {
      sendJson(response, 200, { ok: true, usuarios: await listUsers() });
    } catch (error) {
      sendJson(response, 500, { ok: false, error: error.message });
    }
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/auditoria") {
    const authUser = await requirePermission(request, response, "auditoria.view");
    if (!authUser) return;
    try {
      const logs = await listAuditLogs({
        usuario: url.searchParams.get("usuario") || "",
        acao: url.searchParams.get("acao") || "",
        modulo: url.searchParams.get("modulo") || "",
        dataInicio: url.searchParams.get("dataInicio") || "",
        dataFim: url.searchParams.get("dataFim") || "",
        limit: url.searchParams.get("limit") || 100,
      });
      await logAudit(request, authUser, {
        acao: "auditoria.consultar",
        modulo: "auditoria",
        entidadeTipo: "auditoria_logs",
        entidadeId: "",
        detalhes: { quantidade: logs.length },
      }).catch(() => {});
      sendJson(response, 200, { ok: true, logs });
    } catch (error) {
      sendJson(response, 500, { ok: false, error: error.message });
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/usuarios") {
    const authUser = await requirePermission(request, response, "usuarios.create");
    if (!authUser) return;
    try {
      const payload = JSON.parse(await readBody(request));
      const usuario = await createUser(payload);
      await logAudit(request, authUser, {
        acao: "usuario.criar",
        modulo: "usuarios",
        entidadeTipo: "usuario",
        entidadeId: usuario.usuario,
        detalhes: { perfil: usuario.perfil, id: usuario.id },
      }).catch(() => {});
      sendJson(response, 200, { ok: true, usuario });
    } catch (error) {
      const duplicate = String(error.message || "").includes("duplicate") || String(error.message || "").includes("UNIQUE");
      sendJson(response, duplicate ? 409 : 400, { ok: false, error: duplicate ? "Usuário já cadastrado." : error.message });
    }
    return;
  }

  const userMatch = url.pathname.match(/^\/api\/usuarios\/(\d+)$/);
  if ((request.method === "PUT" || request.method === "PATCH") && userMatch) {
    const authUser = await requirePermission(request, response, "usuarios.edit");
    if (!authUser) return;
    try {
      const payload = JSON.parse(await readBody(request));
      const usuario = await updateUser(userMatch[1], payload, authUser.id);
      await logAudit(request, authUser, {
        acao: "usuario.alterar",
        modulo: "usuarios",
        entidadeTipo: "usuario",
        entidadeId: usuario.usuario,
        detalhes: { perfil: usuario.perfil, id: usuario.id },
      }).catch(() => {});
      sendJson(response, 200, { ok: true, usuario });
    } catch (error) {
      const duplicate = String(error.message || "").includes("duplicate") || String(error.message || "").includes("UNIQUE");
      sendJson(response, duplicate ? 409 : 400, { ok: false, error: duplicate ? "Usuário já cadastrado." : error.message });
    }
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/data") {
    if (!await requireUser(request, response)) return;
    try {
      sendJson(response, 200, { ok: true, state: await readAppState() });
    } catch (error) {
      sendJson(response, 500, { ok: false, error: friendlySmtpError(error) });
    }
    return;
  }

  if ((request.method === "POST" || request.method === "PUT") && url.pathname === "/api/data") {
    const authUser = await requirePermission(request, response, "data.write");
    if (!authUser) return;
    try {
      const payload = JSON.parse(await readBody(request));
      const state = await writeAppState(payload.state || payload);
      await logAudit(request, authUser, {
        acao: payload.audit?.acao || "dados.salvar",
        modulo: payload.audit?.modulo || "dados",
        entidadeTipo: payload.audit?.entidadeTipo || "",
        entidadeId: payload.audit?.entidadeId || "",
        detalhes: {
          ...(payload.audit?.detalhes || {}),
          totais: {
            clientes: state.clientes.length,
            servicos: state.servicos.length,
            orcamentos: state.orcamentos.length,
          },
        },
      }).catch(() => {});
      sendJson(response, 200, { ok: true, state });
    } catch (error) {
      sendJson(response, 500, { ok: false, error: error.message });
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/orcamentos/salvar") {
    const authUser = await requirePermission(request, response, "orcamentos.print");
    if (!authUser) return;
    try {
      const payload = JSON.parse(await readBody(request));
      const fileName = `${safeFileName(payload.fileName)}.html`;
      const html = String(payload.html || "");

      if (!fileName || fileName === ".html" || !html) {
        response.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ ok: false, error: "Arquivo inválido." }));
        return;
      }

      mkdirSync(budgetsDir, { recursive: true });
      const target = resolve(budgetsDir, fileName);
      if (!target.startsWith(budgetsDir)) {
        response.writeHead(403, { "Content-Type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ ok: false, error: "Caminho inválido." }));
        return;
      }

      writeFileSync(target, html, "utf-8");
      const approved = isApprovedStatus(payload.orcamento?.status);
      if (approved) {
        await saveStoredFile({
          categoria: "orcamentos",
          nome: fileName,
          mimeType: "text/html; charset=utf-8",
          conteudo: Buffer.from(html, "utf-8"),
        });
      }
      await logAudit(request, authUser, {
        acao: "orcamento.salvar.html",
        modulo: "orcamentos",
        entidadeTipo: "orcamento",
        entidadeId: fileName,
        detalhes: { armazenamento: approved ? "banco" : "temporario", status: payload.orcamento?.status || "", path: target },
      }).catch(() => {});
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ ok: true, fileName, path: target }));
    } catch (error) {
      response.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ ok: false, error: error.message }));
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/orcamentos/salvar-pdf") {
    const authUser = await requirePermission(request, response, "orcamentos.print");
    if (!authUser) return;
    try {
      const payload = JSON.parse(await readBody(request));
      const fileName = `${safeFileName(payload.fileName)}.pdf`;
      const approved = isApprovedStatus(payload.orcamento?.status);
      const savedUrl = `/orcamentos/${encodeURIComponent(fileName)}`;
      const storedFile = approved ? await readStoredFile("orcamentos", fileName) : null;

      if (!fileName || fileName === ".pdf") {
        response.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ ok: false, error: "Arquivo inválido." }));
        return;
      }

      if (storedFile) {
        await logAudit(request, authUser, {
          acao: "orcamento.abrir_pdf_existente",
          modulo: "orcamentos",
          entidadeTipo: "orcamento",
          entidadeId: payload.orcamento?.numero || fileName,
          detalhes: { fileName, armazenamento: "banco", tamanho: storedFile.tamanho },
        }).catch(() => {});
        response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({
          ok: true,
          fileName,
          url: savedUrl,
          publicUrl: publicFileUrl(savedUrl),
          savedToDatabase: true,
          reused: true,
        }));
        return;
      }

      mkdirSync(budgetsDir, { recursive: true });
      const target = resolve(budgetsDir, fileName);
      if (!target.startsWith(budgetsDir)) {
        response.writeHead(403, { "Content-Type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ ok: false, error: "Caminho inválido." }));
        return;
      }

      if (payload.html) {
        await printHtmlToPdfPortable(String(payload.html), target);
      } else {
        const generatorPayload = { ...payload, output: target };
        const result = spawnSync(pythonExe, [join(root, "scripts", "generate_budget_pdf.py")], {
          input: JSON.stringify(generatorPayload),
          encoding: "utf-8",
          cwd: root,
        });

        if (result.status !== 0) {
          throw new Error(result.stderr || "Falha ao gerar PDF.");
        }
      }

      const pdfBuffer = readFileSync(target);
      if (approved) {
        await saveStoredFile({
          categoria: "orcamentos",
          nome: fileName,
          mimeType: "application/pdf",
          conteudo: pdfBuffer,
        });
      }
      await logAudit(request, authUser, {
        acao: "orcamento.gerar_pdf",
        modulo: "orcamentos",
        entidadeTipo: "orcamento",
        entidadeId: payload.orcamento?.numero || fileName,
        detalhes: { fileName, armazenamento: approved ? "banco" : "temporario", status: payload.orcamento?.status || "", tamanho: pdfBuffer.length, path: target },
      }).catch(() => {});
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({
        ok: true,
        fileName,
        path: target,
        url: savedUrl,
        publicUrl: publicFileUrl(savedUrl),
        savedToDatabase: approved,
        reused: false,
      }));
    } catch (error) {
      response.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ ok: false, error: error.message }));
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/relatorios/salvar-pdf") {
    const authUser = await requirePermission(request, response, "relatorios.export");
    if (!authUser) return;
    try {
      const payload = JSON.parse(await readBody(request));
      const fileName = `${safeFileName(payload.fileName)}.pdf`;
      const html = String(payload.html || "");

      if (!fileName || fileName === ".pdf" || !html) {
        response.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ ok: false, error: "RelatÃ³rio invÃ¡lido." }));
        return;
      }

      mkdirSync(reportsDir, { recursive: true });
      const target = resolve(reportsDir, fileName);
      if (!target.startsWith(reportsDir)) {
        response.writeHead(403, { "Content-Type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ ok: false, error: "Caminho invÃ¡lido." }));
        return;
      }

      await printHtmlToPdfPortable(html, target);
      const pdfBuffer = readFileSync(target);
      await saveStoredFile({
        categoria: "relatorios",
        nome: fileName,
        mimeType: "application/pdf",
        conteudo: pdfBuffer,
      });
      await logAudit(request, authUser, {
        acao: "relatorio.gerar_pdf",
        modulo: "relatorios",
        entidadeTipo: "relatorio",
        entidadeId: fileName,
        detalhes: { armazenamento: "banco", tamanho: pdfBuffer.length, path: target },
      }).catch(() => {});
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      const savedUrl = `/relatorios/${encodeURIComponent(fileName)}`;
      response.end(JSON.stringify({ ok: true, fileName, path: target, url: savedUrl, publicUrl: publicFileUrl(savedUrl) }));
    } catch (error) {
      response.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ ok: false, error: error.message }));
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/relatorios/salvar-xlsx") {
    const authUser = await requirePermission(request, response, "relatorios.export");
    if (!authUser) return;
    try {
      const payload = JSON.parse(await readBody(request));
      const fileName = `${safeFileName(payload.fileName)}.xlsx`;

      if (!fileName || fileName === ".xlsx") {
        response.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ ok: false, error: "RelatÃƒÂ³rio invÃƒÂ¡lido." }));
        return;
      }

      mkdirSync(reportsDir, { recursive: true });
      const target = resolve(reportsDir, fileName);
      if (!target.startsWith(reportsDir)) {
        response.writeHead(403, { "Content-Type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ ok: false, error: "Caminho invÃƒÂ¡lido." }));
        return;
      }

      const xlsxBuffer = createReportXlsx(payload.report);
      writeFileSync(target, xlsxBuffer);
      await saveStoredFile({
        categoria: "relatorios",
        nome: fileName,
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        conteudo: xlsxBuffer,
      });
      await logAudit(request, authUser, {
        acao: "relatorio.gerar_excel",
        modulo: "relatorios",
        entidadeTipo: "relatorio",
        entidadeId: fileName,
        detalhes: { armazenamento: "banco", tamanho: xlsxBuffer.length, path: target, titulo: payload.report?.title || "" },
      }).catch(() => {});
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ ok: true, fileName, path: target, url: `/relatorios/${encodeURIComponent(fileName)}` }));
    } catch (error) {
      response.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ ok: false, error: error.message }));
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/orcamentos/enviar-email") {
    const authUser = await requirePermission(request, response, "orcamentos.share");
    if (!authUser) return;
    try {
      const payload = JSON.parse(await readBody(request));
      const fileName = safePdfFileName(payload.fileName);
      const attachmentPath = resolve(budgetsDir, fileName);
      const storedAttachment = await readStoredFile("orcamentos", fileName);
      const hasLocalAttachment = attachmentPath.startsWith(budgetsDir) && existsSync(attachmentPath);
      if (!storedAttachment && !hasLocalAttachment) {
        response.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ ok: false, error: "PDF do orçamento não encontrado. Salve o orçamento novamente." }));
        return;
      }

      const pdfUrl = String(payload.url || "");
      const clientName = String(payload.cliente || "cliente");
      const text = `Prezado cliente: ${clientName}\r\n\r\nConforme solicitado, enviamos o orçamento referente aos serviços de Medicina e Segurança do Trabalho.\r\n\r\nEm caso de dúvidas, estamos à disposição.`;
      const html = `
        <p>Prezado cliente: ${escapeHtmlEmail(clientName)}</p>
        <p>Conforme solicitado, enviamos o orçamento referente aos serviços de Medicina e Segurança do Trabalho.</p>
        <p>Em caso de dúvidas, estamos à disposição.</p>
        `;

      await sendSmtpMail({
        to: payload.to,
        subject: String(payload.subject || "Orçamento"),
        text,
        html,
        attachmentPath: storedAttachment ? "" : attachmentPath,
        attachmentContent: storedAttachment?.conteudo,
        attachmentMimeType: storedAttachment?.mimeType,
        attachmentName: fileName,
      });

      await logAudit(request, authUser, {
        acao: "orcamento.enviar_email",
        modulo: "orcamentos",
        entidadeTipo: "orcamento",
        entidadeId: fileName,
        detalhes: { destinatario: payload.to },
      }).catch(() => {});
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ ok: true }));
    } catch (error) {
      response.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ ok: false, error: error.message }));
    }
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/status") {
    response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ ok: true, version: serverVersion, saveBudget: true, database: databaseBackend }));
    return;
  }

  if (request.method === "GET" && url.pathname.startsWith("/api/cnpj/")) {
    const authUser = await requirePermission(request, response, "clientes.create");
    if (!authUser) return;
    try {
      const cnpj = onlyDigits(decodeURIComponent(url.pathname.replace("/api/cnpj/", "")));
      if (cnpj.length !== 14) {
        response.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ ok: false, error: "CNPJ inválido." }));
        return;
      }

      const data = await consultCnpj(cnpj);
      await logAudit(request, authUser, {
        acao: "cliente.consultar_cnpj",
        modulo: "clientes",
        entidadeTipo: "cnpj",
        entidadeId: cnpj,
        detalhes: { situacaoCnpj: data.situacaoCnpj },
      }).catch(() => {});

      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({
        ok: true,
        cnpj,
        razaoSocial: data.razaoSocial,
        nomeFantasia: data.nomeFantasia,
        situacaoCnpj: data.situacaoCnpj,
      }));
    } catch (error) {
      response.writeHead(error.status || 500, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ ok: false, error: error.message || "Falha ao consultar CNPJ." }));
    }
    return;
  }

  if (request.method === "GET" && url.pathname.startsWith("/api/cep/")) {
    const authUser = await requirePermission(request, response, "clientes.create");
    if (!authUser) return;
    try {
      const cep = onlyDigits(decodeURIComponent(url.pathname.replace("/api/cep/", "")));
      if (cep.length !== 8) {
        response.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ ok: false, error: "CEP inválido." }));
        return;
      }

      const data = await consultCep(cep);
      await logAudit(request, authUser, {
        acao: "cliente.consultar_cep",
        modulo: "clientes",
        entidadeTipo: "cep",
        entidadeId: cep,
        detalhes: { cidade: data.cidade, uf: data.uf },
      }).catch(() => {});
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ ok: true, ...data }));
    } catch (error) {
      response.writeHead(error.status || 500, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ ok: false, error: error.message || "Falha ao consultar CEP." }));
    }
    return;
  }

  if (request.method === "GET" && url.pathname.startsWith("/orcamentos/")) {
    const fileName = safeFileName(decodeURIComponent(url.pathname.replace("/orcamentos/", "")));
    const filePath = resolve(budgetsDir, fileName);
    const storedFile = await readStoredFile("orcamentos", fileName);

    if (storedFile) {
      response.writeHead(200, {
        "Content-Type": storedFile.mimeType || contentTypeForFile(fileName),
        "Content-Length": storedFile.conteudo.length,
        "Content-Disposition": `inline; filename="${fileName}"`,
      });
      response.end(storedFile.conteudo);
      return;
    }

    if (!filePath.startsWith(budgetsDir) || !existsSync(filePath)) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }

    response.writeHead(200, { "Content-Type": contentTypeForFile(filePath) });
    createReadStream(filePath).pipe(response);
    return;
  }

  if (request.method === "GET" && url.pathname.startsWith("/relatorios/")) {
    const fileName = safeFileName(decodeURIComponent(url.pathname.replace("/relatorios/", "")));
    const filePath = resolve(reportsDir, fileName);
    const storedFile = await readStoredFile("relatorios", fileName);

    if (storedFile) {
      response.writeHead(200, {
        "Content-Type": storedFile.mimeType || contentTypeForFile(fileName),
        "Content-Length": storedFile.conteudo.length,
        "Content-Disposition": `inline; filename="${fileName}"`,
      });
      response.end(storedFile.conteudo);
      return;
    }

    if (!filePath.startsWith(reportsDir) || !existsSync(filePath)) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }

    response.writeHead(200, { "Content-Type": contentTypeForFile(filePath) });
    createReadStream(filePath).pipe(response);
    return;
  }

  const requested = normalize(decodeURIComponent(url.pathname)).replace(/^[/\\]+/, "");
  let filePath = resolve(join(root, requested || "index.html"));

  if (!filePath.startsWith(root)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  if (existsSync(filePath) && statSync(filePath).isDirectory()) {
    filePath = join(filePath, "index.html");
  }

  if (!existsSync(filePath)) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }

  response.writeHead(200, { "Content-Type": types[extname(filePath)] || "application/octet-stream" });
  createReadStream(filePath).pipe(response);
}).listen(port, host, () => {
  console.log(`ConsultApp running at http://${host}:${port}`);
});
