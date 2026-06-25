import { createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { createHash, pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";
import { connect as netConnect } from "node:net";
import { homedir } from "node:os";
import path, { extname, join, normalize, resolve } from "node:path";
import { connect as tlsConnect } from "node:tls";
import { pathToFileURL, fileURLToPath } from "node:url";
import PDFDocument from "pdfkit";

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

const serverVersion = "v336";
const PASSWORD_POLICY_VERSION = "strong-password-v1-20260625";
const PASSWORD_MIN_LENGTH = Math.max(8, Number(process.env.PASSWORD_MIN_LENGTH || 8));
const PASSWORD_MAX_AGE_DAYS = Math.max(1, Number(process.env.PASSWORD_MAX_AGE_DAYS || 30));

const postgresConnectionString = databaseConnectionString();
const postgresPool = await createPostgresPool();

await ensureAuthSchema();
await ensureInitialAdminUser();
await ensureGuestUser();
await enforceCurrentPasswordPolicy();

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
    clientes: Array.isArray(state?.clientes) ? state.clientes.map((cliente) => {
      const { responsavelCpf, ...cleanCliente } = cliente;
      return {
        ...cleanCliente,
        status: normalizeClienteStatus(cliente.status),
      };
    }) : [],
    servicos: Array.isArray(state?.servicos) ? state.servicos : [],
    orcamentos: Array.isArray(state?.orcamentos) ? state.orcamentos : [],
    responsaveis: [],
  };
}

function normalizeClienteStatus(status) {
  return String(status || "ATIVO").trim().toUpperCase() === "INATIVO" ? "INATIVO" : "ATIVO";
}

async function createPostgresPool() {
  if (!postgresConnectionString) {
    throw new Error("Configure DATABASE_URL ou DB_NAME, DB_USER, DB_PASSWORD, DB_HOST e DB_PORT para usar PostgreSQL.");
  }

  let Pool;
  try {
    ({ Pool } = await import("pg"));
  } catch {
    throw new Error("Dependência pg não instalada. Rode npm install antes de usar PostgreSQL.");
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

function isGuestUser(user) {
  return String(user?.perfil || "").toUpperCase() === "CONVIDADO";
}

function passwordPolicyError(password, user = {}) {
  const value = String(password || "");
  if (value.length < PASSWORD_MIN_LENGTH) {
    return `A senha deve ter pelo menos ${PASSWORD_MIN_LENGTH} caracteres.`;
  }
  if (!/[A-Z]/.test(value)) return "A senha deve conter pelo menos uma letra maiúscula.";
  if (!/[a-z]/.test(value)) return "A senha deve conter pelo menos uma letra minúscula.";
  if (!/[0-9]/.test(value)) return "A senha deve conter pelo menos um número.";
  if (!/[^A-Za-z0-9]/.test(value)) return "A senha deve conter pelo menos um caractere especial.";
  const lower = value.toLowerCase();
  const identifiers = [
    user.usuario,
    user.email,
    String(user.email || "").split("@")[0],
  ].map((item) => String(item || "").trim().toLowerCase()).filter((item) => item.length >= 4);
  if (identifiers.some((item) => lower.includes(item))) {
    return "A senha não pode conter o usuário ou e-mail cadastrado.";
  }
  return "";
}

function assertStrongPassword(password, user = {}) {
  const error = passwordPolicyError(password, user);
  if (error) throw new Error(error);
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
  "clientes.status",
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
  "arquivos.view",
  "arquivos.delete",
  "usuarios.view",
  "usuarios.create",
  "usuarios.edit",
  "usuarios.delete",
  "auditoria.view",
  "auditoria.manage",
  "data.write",
];

const PROFILE_PERMISSION_PRESETS = {
  ADMIN: Object.fromEntries(PERMISSION_KEYS.map((key) => [key, !key.startsWith("auditoria.")])),
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

const SUPER_ADMIN_LOGIN = String(process.env.ADMIN_USER || "admin").trim().toLowerCase();
const SUPER_ADMIN_EMAIL = String(process.env.ADMIN_EMAIL || "").trim().toLowerCase();
const TECHNICAL_PERMISSION_KEYS = new Set(["auditoria.view", "auditoria.manage"]);

function isSuperAdminUser(user) {
  const login = String(user?.usuario || "").trim().toLowerCase();
  const email = String(user?.email || "").trim().toLowerCase();
  return login === SUPER_ADMIN_LOGIN || (SUPER_ADMIN_EMAIL && email === SUPER_ADMIN_EMAIL);
}

function isSuperAdminLogin(usuario) {
  const value = String(usuario || "").trim().toLowerCase();
  return value === SUPER_ADMIN_LOGIN || (SUPER_ADMIN_EMAIL && value === SUPER_ADMIN_EMAIL);
}

function permissionsForProfile(perfil) {
  const preset = PROFILE_PERMISSION_PRESETS[String(perfil || "").toUpperCase()] || {};
  return Object.fromEntries(PERMISSION_KEYS.map((key) => [key, Boolean(preset[key])]));
}

function normalizePermissions(value, perfil, user = null) {
  const base = permissionsForProfile(perfil);
  const custom = typeof value === "string" ? JSON.parse(value || "{}") : (value || {});
  PERMISSION_KEYS.forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(custom, key)) base[key] = Boolean(custom[key]);
  });
  if (isSuperAdminUser(user)) {
    PERMISSION_KEYS.forEach((key) => {
      base[key] = true;
    });
  } else {
    TECHNICAL_PERMISSION_KEYS.forEach((key) => {
      base[key] = false;
    });
  }
  return base;
}

function effectivePermissions(user) {
  return normalizePermissions(user?.permissoes, user?.perfil, user);
}

function hasPermission(user, key) {
  if (!key) return true;
  return Boolean(effectivePermissions(user)[key]);
}

function canManageUserPasswords(user) {
  return isSuperAdminUser(user) || String(user?.perfil || "").trim().toUpperCase() === "ADMIN";
}

function publicUser(user) {
  return user ? {
    id: user.id,
    usuario: user.usuario,
    nome: user.nome,
    sobrenome: user.sobrenome || "",
    email: user.email || "",
    telefone: user.telefone || "",
    dataNascimento: user.data_nascimento ? String(user.data_nascimento).slice(0, 10) : "",
    perfil: user.perfil,
    permissoes: effectivePermissions(user),
    superAdmin: isSuperAdminUser(user),
  } : null;
}

async function ensureAuthSchema() {
  await postgresPool.query("ALTER TABLE clientes ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'ATIVO'");
  await postgresPool.query("ALTER TABLE clientes ADD COLUMN IF NOT EXISTS responsavel_nome TEXT NOT NULL DEFAULT ''");
  await postgresPool.query(`
    UPDATE clientes AS cliente
    SET responsavel_nome = responsavel.nome
    FROM responsaveis AS responsavel
    WHERE responsavel.cliente_documento = cliente.documento
      AND COALESCE(cliente.responsavel_nome, '') = ''
  `);
  await postgresPool.query("ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS email TEXT NOT NULL DEFAULT ''");
  await postgresPool.query("ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS deve_trocar_senha BOOLEAN NOT NULL DEFAULT FALSE");
  await postgresPool.query("ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS senha_alterada_em TIMESTAMPTZ");
  await postgresPool.query("ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS senha_politica_versao TEXT NOT NULL DEFAULT ''");
  await postgresPool.query("ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS permissoes JSONB");
  await postgresPool.query("ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS superadmin_locked BOOLEAN NOT NULL DEFAULT FALSE");
  await postgresPool.query("ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS sobrenome TEXT NOT NULL DEFAULT ''");
  await postgresPool.query("ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS telefone TEXT NOT NULL DEFAULT ''");
  await postgresPool.query("ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS data_nascimento DATE");
  await postgresPool.query("ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS cadastro_pendente BOOLEAN NOT NULL DEFAULT FALSE");
  await postgresPool.query("ALTER TABLE sessoes ADD COLUMN IF NOT EXISTS csrf_token TEXT NOT NULL DEFAULT ''");
  await postgresPool.query("ALTER TABLE arquivos ADD COLUMN IF NOT EXISTS public_token TEXT NOT NULL DEFAULT ''");
  await postgresPool.query("CREATE UNIQUE INDEX IF NOT EXISTS arquivos_public_token_unique_idx ON arquivos(public_token) WHERE public_token <> ''");
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
  await postgresPool.query("CREATE INDEX IF NOT EXISTS auditoria_logs_usuario_idx ON auditoria_logs(usuario)");
  await postgresPool.query("CREATE INDEX IF NOT EXISTS auditoria_logs_modulo_idx ON auditoria_logs(modulo)");
  await postgresPool.query("CREATE INDEX IF NOT EXISTS auditoria_logs_acao_idx ON auditoria_logs(acao)");
}

async function ensureInitialAdminUser() {
  const adminUser = process.env.ADMIN_USER || "admin";
  const adminPassword = process.env.ADMIN_PASSWORD || "admin123";
  const adminEmail = process.env.ADMIN_EMAIL || "admin@consult.local";

  const result = await postgresPool.query("SELECT COUNT(*)::int AS total FROM usuarios");
  if (Number(result.rows[0]?.total || 0) > 0) return;
  await postgresPool.query(
    "INSERT INTO usuarios (usuario, nome, email, perfil, senha_hash, ativo) VALUES ($1, $2, $3, $4, $5, TRUE)",
    [adminUser, "Administrador", adminEmail, "ADMIN", passwordHash(adminPassword)],
  );
}

async function ensureGuestUser() {
  const guestUser = process.env.GUEST_USER || "convidado";
  const guestPassword = process.env.GUEST_PASSWORD || "convidado123";
  const guestEmail = process.env.GUEST_EMAIL || "convidado@consult.local";

  if (await findUserByLogin(guestUser)) return;

  await postgresPool.query(
    "INSERT INTO usuarios (usuario, nome, email, perfil, senha_hash, ativo) VALUES ($1, $2, $3, $4, $5, TRUE)",
    [guestUser, "Convidado", guestEmail, "CONVIDADO", passwordHash(guestPassword)],
  );
}

async function enforceCurrentPasswordPolicy() {
  await postgresPool.query(`
    UPDATE usuarios
    SET deve_trocar_senha = TRUE,
        senha_politica_versao = $1,
        updated_at = CURRENT_TIMESTAMP
    WHERE COALESCE(senha_politica_versao, '') <> $1
      AND UPPER(COALESCE(perfil, '')) <> 'CONVIDADO'
  `, [PASSWORD_POLICY_VERSION]);
}

async function findUserByLogin(usuario) {
  const result = await postgresPool.query(
    "SELECT id, usuario, nome, sobrenome, email, telefone, data_nascimento, perfil, permissoes, senha_hash, deve_trocar_senha, senha_alterada_em, senha_politica_versao, ativo, superadmin_locked, cadastro_pendente FROM usuarios WHERE lower(usuario) = lower($1) OR lower(email) = lower($1) LIMIT 1",
    [usuario],
  );
  return result.rows[0] || null;
}

async function usernameExists(usuario, ignoreId = null) {
  const params = [String(usuario || "").trim().toLowerCase()];
  let sql = "SELECT 1 FROM usuarios WHERE lower(usuario) = $1";
  if (ignoreId) {
    params.push(Number(ignoreId));
    sql += " AND id <> $2";
  }
  sql += " LIMIT 1";
  const result = await postgresPool.query(sql, params);
  return result.rowCount > 0;
}

async function emailExists(email, ignoreId = null) {
  const normalized = safeNormalizeEmail(email);
  if (!normalized) return false;
  const params = [normalized.toLowerCase()];
  let sql = "SELECT 1 FROM usuarios WHERE lower(email) = $1";
  if (ignoreId) {
    params.push(Number(ignoreId));
    sql += " AND id <> $2";
  }
  sql += " LIMIT 1";
  const result = await postgresPool.query(sql, params);
  return result.rowCount > 0;
}

function slugPart(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "")
    .replace(/\.+/g, ".");
}

async function generateUsername(nome, sobrenome = "", ignoreId = null) {
  const first = slugPart(String(nome || "").split(/\s+/).filter(Boolean)[0] || "");
  const nameParts = `${nome || ""} ${sobrenome || ""}`.split(/\s+/).map(slugPart).filter(Boolean);
  const uniqueParts = [...new Set(nameParts)];
  const lastParts = uniqueParts.slice(1).reverse();
  const candidates = [];

  lastParts.forEach((part) => {
    if (first && part && first !== part) candidates.push(`${first}.${part}`);
  });
  if (first) candidates.push(first);

  for (const candidate of candidates) {
    if (!(await usernameExists(candidate, ignoreId))) return candidate;
  }

  const base = candidates[0] || `usuario.${Date.now()}`;
  for (let index = 2; index < 10_000; index += 1) {
    const candidate = `${base}${index}`;
    if (!(await usernameExists(candidate, ignoreId))) return candidate;
  }

  throw new Error("Não foi possível gerar um usuário automático.");
}

async function findUserById(id) {
  const result = await postgresPool.query(
    "SELECT id, usuario, nome, sobrenome, email, telefone, data_nascimento, perfil, permissoes, ativo, superadmin_locked, cadastro_pendente FROM usuarios WHERE id = $1 LIMIT 1",
    [Number(id)],
  );
  return result.rows[0] || null;
}

function canSeeManagedUser(actor, user) {
  return isSuperAdminUser(actor) || (!isSuperAdminUser(user) && !isSuperAdminLocked(user));
}

function isSuperAdminLocked(user) {
  return user?.superadmin_locked === true;
}

async function listUsers(actor) {
  const result = await postgresPool.query(`
    SELECT id, usuario, nome, sobrenome, email, telefone, data_nascimento, perfil, permissoes, ativo, superadmin_locked, cadastro_pendente
    FROM usuarios
    ORDER BY nome, usuario
  `);
  return result.rows.filter((user) => canSeeManagedUser(actor, user)).map(publicUserAdmin);
}

function publicUserAdmin(user) {
  return {
    id: Number(user.id),
    usuario: user.usuario,
    nome: user.nome,
    sobrenome: user.sobrenome || "",
    email: user.email || "",
    telefone: user.telefone || "",
    dataNascimento: user.data_nascimento ? String(user.data_nascimento).slice(0, 10) : "",
    perfil: user.perfil,
    permissoes: effectivePermissions(user),
    ativo: user.ativo === true,
    cadastroPendente: user.cadastro_pendente === true,
    superAdmin: isSuperAdminUser(user),
    superadminLocked: isSuperAdminLocked(user),
  };
}

function requestIp(request) {
  return String(request.headers["cf-connecting-ip"] || request.headers["x-forwarded-for"] || request.socket?.remoteAddress || "")
    .split(",")[0]
    .trim();
}

const rateLimitBuckets = new Map();
let lastRateLimitCleanup = 0;
const rateLimitRules = {
  login: { max: Number(process.env.RATE_LIMIT_LOGIN_MAX || 5), windowMs: Number(process.env.RATE_LIMIT_LOGIN_WINDOW_MS || 10 * 60 * 1000) },
  forgotPassword: { max: Number(process.env.RATE_LIMIT_PASSWORD_RESET_MAX || 3), windowMs: Number(process.env.RATE_LIMIT_PASSWORD_RESET_WINDOW_MS || 15 * 60 * 1000) },
  guest: { max: Number(process.env.RATE_LIMIT_GUEST_MAX || 20), windowMs: Number(process.env.RATE_LIMIT_GUEST_WINDOW_MS || 60 * 1000) },
  firstAccess: { max: Number(process.env.RATE_LIMIT_FIRST_ACCESS_MAX || 3), windowMs: Number(process.env.RATE_LIMIT_FIRST_ACCESS_WINDOW_MS || 30 * 60 * 1000) },
};

function cleanupRateLimits(now = Date.now()) {
  if (now - lastRateLimitCleanup < 60_000) return;
  lastRateLimitCleanup = now;
  for (const [key, bucket] of rateLimitBuckets.entries()) {
    if (bucket.resetAt <= now) rateLimitBuckets.delete(key);
  }
}

function rateLimitIdentity(value) {
  return String(value || "-").trim().toLowerCase().slice(0, 160) || "-";
}

function rateLimitKey(scope, request, identity = "") {
  return `${scope}:${rateLimitIdentity(requestIp(request) || "unknown")}:${rateLimitIdentity(identity)}`;
}

function rateLimitStatus(scope, request, identity = "") {
  const rule = rateLimitRules[scope];
  if (!rule?.max || !rule?.windowMs) return { limited: false, retryAfterSeconds: 0 };
  const now = Date.now();
  cleanupRateLimits(now);
  const bucket = rateLimitBuckets.get(rateLimitKey(scope, request, identity));
  if (!bucket || bucket.resetAt <= now) return { limited: false, retryAfterSeconds: 0 };
  return {
    limited: bucket.count >= rule.max,
    retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
  };
}

function recordRateLimitAttempt(scope, request, identity = "") {
  const rule = rateLimitRules[scope];
  if (!rule?.max || !rule?.windowMs) return { limited: false, retryAfterSeconds: 0 };
  const now = Date.now();
  cleanupRateLimits(now);
  const key = rateLimitKey(scope, request, identity);
  const current = rateLimitBuckets.get(key);
  const bucket = current && current.resetAt > now
    ? current
    : { count: 0, resetAt: now + rule.windowMs };
  bucket.count += 1;
  rateLimitBuckets.set(key, bucket);
  return {
    limited: bucket.count > rule.max,
    retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
  };
}

function clearRateLimit(scope, request, identity = "") {
  rateLimitBuckets.delete(rateLimitKey(scope, request, identity));
}

function sendRateLimitResponse(response, check) {
  sendJson(response, 429, {
    ok: false,
    error: "Muitas tentativas. Aguarde alguns minutos e tente novamente.",
  }, { "Retry-After": String(check.retryAfterSeconds || 60) });
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

  await postgresPool.query(`
    INSERT INTO auditoria_logs (usuario_id, usuario, perfil, acao, modulo, entidade_tipo, entidade_id, detalhes, ip, user_agent)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)
  `, [row.usuarioId, row.usuario, row.perfil, row.acao, row.modulo, row.entidadeTipo, row.entidadeId, JSON.stringify(row.detalhes), row.ip, row.userAgent]);
}

function boundedNumber(value, fallback, min, max) {
  const number = Number(value);
  const safe = Number.isFinite(number) ? number : fallback;
  return Math.min(Math.max(Math.floor(safe), min), max);
}

async function listAuditLogs(filters = {}) {
  const limit = boundedNumber(filters.limit, 100, 10, 500);
  const page = boundedNumber(filters.page, 1, 1, 1000000);
  const offset = (page - 1) * limit;
  const where = [];
  const params = [];
  const addFilter = (sql, value) => {
    params.push(value);
    where.push(sql.replace("?", `$${params.length}`));
  };

  if (filters.usuario) addFilter("lower(usuario) LIKE lower(?)", `%${String(filters.usuario).trim()}%`);
  if (filters.acao) addFilter("lower(acao) LIKE lower(?)", `%${String(filters.acao).trim()}%`);
  if (filters.modulo) addFilter("modulo = ?", String(filters.modulo).trim());
  if (filters.dataInicio) addFilter("created_at >= ?", String(filters.dataInicio));
  if (filters.dataFim) addFilter("created_at < ?", `${String(filters.dataFim)} 23:59:59`);

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const totalResult = await postgresPool.query(`
    SELECT COUNT(*)::int AS total
    FROM auditoria_logs
    ${whereSql}
  `, params);
  const total = Number(totalResult.rows[0]?.total || 0);
  const queryParams = params.slice();
  queryParams.push(limit, offset);
  const result = await postgresPool.query(`
    SELECT id, usuario, perfil, acao, modulo, entidade_tipo, entidade_id, detalhes, ip, user_agent, created_at
    FROM auditoria_logs
    ${whereSql}
    ORDER BY created_at DESC, id DESC
    LIMIT $${queryParams.length - 1}
    OFFSET $${queryParams.length}
  `, queryParams);
  const logs = result.rows.map((row) => ({
    ...row,
    detalhes: row.detalhes || {},
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  }));
  return { logs, total, page, limit, pages: Math.max(Math.ceil(total / limit), 1) };
}

function normalizeAuditRetentionDays(value) {
  return boundedNumber(value, 365, 30, 3650);
}

function auditRetentionCutoff(days) {
  const cutoff = new Date(Date.now() - normalizeAuditRetentionDays(days) * 24 * 60 * 60 * 1000);
  return cutoff.toISOString().slice(0, 19).replace("T", " ");
}

async function maintainAuditLogs({ olderThanDays = 365, deleteOld = false } = {}) {
  const days = normalizeAuditRetentionDays(olderThanDays);
  const cutoff = auditRetentionCutoff(days);

  if (!deleteOld) {
    const result = await postgresPool.query("SELECT COUNT(*)::int AS total FROM auditoria_logs WHERE created_at < $1", [cutoff]);
    return { olderThanDays: days, cutoff, total: Number(result.rows[0]?.total || 0), deleted: 0 };
  }
  const result = await postgresPool.query("DELETE FROM auditoria_logs WHERE created_at < $1", [cutoff]);
  return { olderThanDays: days, cutoff, total: Number(result.rowCount || 0), deleted: Number(result.rowCount || 0) };
}

function validateUserPayload(payload, isUpdate = false, targetUser = null) {
  const email = safeNormalizeEmail(payload.email);
  const usuario = String(targetUser?.usuario || payload.usuario || "").trim();
  const nome = String(payload.nome || "").trim();
  const sobrenome = String(payload.sobrenome || "").trim();
  const telefone = String(payload.telefone || "").trim();
  const dataNascimento = normalizeDateOnly(payload.dataNascimento || payload.data_nascimento || "");
  const perfil = String(payload.perfil || "").trim().toUpperCase();
  const senha = String(payload.senha || "");
  const allowedProfiles = new Set(["ADMIN", "OPERADOR", "FINANCEIRO", "VISUALIZADOR", "CONVIDADO"]);

  if (!email) throw new Error("Informe um e-mail válido.");
  if (!nome) throw new Error("Informe o nome.");
  if (!allowedProfiles.has(perfil)) throw new Error("Perfil inválido.");
  if (senha) assertStrongPassword(senha, { usuario, nome, email });

  return {
    usuario,
    nome,
    sobrenome,
    email,
    telefone,
    dataNascimento,
    perfil,
    senha,
    ativo: payload.ativo !== false,
    cadastroPendente: payload.ativo === true ? false : payload.cadastroPendente === true,
    permissoes: normalizePermissions(payload.permissoes || {}, perfil, { ...targetUser, usuario, perfil }),
  };
}

function normalizeDateOnly(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error("Data de nascimento inválida.");
  const date = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) {
    throw new Error("Data de nascimento inválida.");
  }
  return text;
}

function validateFirstAccessPayload(payload) {
  const nome = String(payload.nome || "").trim();
  const sobrenome = String(payload.sobrenome || "").trim();
  const email = safeNormalizeEmail(payload.email);
  const telefone = String(payload.telefone || "").trim();
  const dataNascimento = normalizeDateOnly(payload.dataNascimento || "");
  const senha = String(payload.senha || "");

  if (!nome) throw new Error("Informe o nome.");
  if (!sobrenome) throw new Error("Informe o sobrenome.");
  if (!email) throw new Error("Informe um e-mail válido.");
  if (!dataNascimento) throw new Error("Informe a data de nascimento.");
  if (!telefone) throw new Error("Informe o telefone.");
  if (!senha) throw new Error("Informe a senha.");
  assertStrongPassword(senha, { usuario: email, nome, email });

  return { usuario: email, nome, sobrenome, email, telefone, dataNascimento, senha };
}

async function requestFirstAccess(payload) {
  const user = validateFirstAccessPayload(payload);
  const existing = await findUserByLogin(user.email);
  const existingEmail = safeNormalizeEmail(existing?.email || "").toLowerCase();
  if (!existing || existing.ativo === true || existing.cadastro_pendente !== true || existingEmail !== user.email.toLowerCase()) {
    throw new Error("Usuário não autorizado.");
  }
  const result = await postgresPool.query(`
    UPDATE usuarios
    SET nome = $1,
        sobrenome = $2,
        telefone = $3,
        data_nascimento = $4,
        senha_hash = $5,
        deve_trocar_senha = FALSE,
        senha_alterada_em = CURRENT_TIMESTAMP,
        senha_politica_versao = $6,
        ativo = FALSE,
        cadastro_pendente = TRUE,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = $7
    RETURNING id, usuario, nome, sobrenome, email, telefone, data_nascimento, perfil, permissoes, ativo, superadmin_locked, cadastro_pendente
  `, [
    user.nome,
    user.sobrenome,
    user.telefone,
    user.dataNascimento,
    passwordHash(user.senha),
    PASSWORD_POLICY_VERSION,
    existing.id,
  ]);

  return publicUserAdmin(result.rows[0]);
}

async function createUser(payload, authUser) {
  const user = validateUserPayload(payload, false, { usuario: payload.email });
  if (await emailExists(user.email)) {
    throw new Error("Já existe um usuário ou solicitação para este e-mail.");
  }
  user.usuario = await generateUsername(user.nome, user.sobrenome);
  if (isSuperAdminLogin(user.usuario) && !isSuperAdminUser(authUser)) {
    throw new Error("Somente o superusuario pode cadastrar o login tecnico.");
  }
  const superadminLocked = isSuperAdminUser(authUser) && !isSuperAdminLogin(user.usuario);
  const active = false;
  const cadastroPendente = true;
  const forcePasswordChange = false;
  const result = await postgresPool.query(`
    INSERT INTO usuarios (usuario, nome, sobrenome, email, telefone, data_nascimento, perfil, permissoes, senha_hash, ativo, cadastro_pendente, superadmin_locked, deve_trocar_senha, senha_politica_versao)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12, $13, $14)
    RETURNING id, usuario, nome, sobrenome, email, telefone, data_nascimento, perfil, permissoes, ativo, superadmin_locked, cadastro_pendente
  `, [user.usuario, user.nome, user.sobrenome, user.email, user.telefone, user.dataNascimento, user.perfil, JSON.stringify(user.permissoes), passwordHash(temporaryPassword()), active, cadastroPendente, superadminLocked, forcePasswordChange, PASSWORD_POLICY_VERSION]);
  return publicUserAdmin(result.rows[0]);
}

async function updateUser(id, payload, authUser) {
  const existing = await findUserById(id);
  if (!existing) throw new Error("Usuario nao encontrado.");
  if (!canSeeManagedUser(authUser, existing)) {
    throw new Error("Usuario protegido pelo superusuario.");
  }
  const user = validateUserPayload(payload, true, existing);
  if (await emailExists(user.email, id)) {
    throw new Error("Já existe outro usuário com este e-mail.");
  }
  if (user.senha) {
    throw new Error("Use a rotina de redefinição de senha.");
  }
  if (isSuperAdminUser(existing) && !isSuperAdminLogin(user.usuario)) {
    throw new Error("O login tecnico do superusuario nao pode ser alterado.");
  }
  if (isSuperAdminLogin(user.usuario) && !isSuperAdminUser(authUser)) {
    throw new Error("Somente o superusuario pode alterar o login tecnico.");
  }
  if (Number(id) === Number(authUser?.id) && !user.ativo) {
    throw new Error("Você não pode inativar o próprio usuário.");
  }
  if (!isSuperAdminUser(existing)) {
    user.usuario = await generateUsername(user.nome, user.sobrenome, id);
  }
  if (isSuperAdminLogin(user.usuario) && !isSuperAdminUser(authUser)) {
    throw new Error("Somente o superusuario pode usar este identificador tecnico.");
  }

  const superadminLocked = isSuperAdminUser(authUser) && !isSuperAdminLogin(user.usuario)
    ? true
    : isSuperAdminLocked(existing);

  const cadastroPendente = user.ativo ? false : (existing.cadastro_pendente === true || user.cadastroPendente === true);
  const params = [user.usuario, user.nome, user.email, user.perfil, user.ativo, Number(id), JSON.stringify(user.permissoes), superadminLocked, user.sobrenome, user.telefone, user.dataNascimento, cadastroPendente];
  let sql = `
    UPDATE usuarios
    SET usuario = $1, nome = $2, email = $3, perfil = $4, ativo = $5,
        permissoes = $7::jsonb, superadmin_locked = $8,
        sobrenome = $9, telefone = $10, data_nascimento = $11, cadastro_pendente = $12,
        updated_at = CURRENT_TIMESTAMP
  `;
  sql += ` WHERE id = $6 RETURNING id, usuario, nome, sobrenome, email, telefone, data_nascimento, perfil, permissoes, ativo, superadmin_locked, cadastro_pendente`;
  const result = await postgresPool.query(sql, params);
  if (!result.rowCount) throw new Error("Usuário não encontrado.");
  return publicUserAdmin(result.rows[0]);
}

async function userBusinessRecordCounts(user) {
  const result = await postgresPool.query(`
    SELECT
      COUNT(*) FILTER (WHERE acao = 'cliente.criar')::int AS clientes,
      COUNT(*) FILTER (WHERE acao = 'servico.criar')::int AS servicos,
      COUNT(*) FILTER (WHERE acao = 'orcamento.criar')::int AS orcamentos,
      COUNT(*) FILTER (
        WHERE acao IN ('orcamento.gerar_pdf', 'relatorio.gerar_pdf')
          AND lower(COALESCE(detalhes->>'armazenamento', '')) = 'banco'
      )::int AS arquivos
    FROM auditoria_logs
    WHERE usuario_id = $1 OR lower(usuario) = lower($2)
  `, [Number(user.id), String(user.usuario || "")]);
  const row = result.rows[0] || {};
  return {
    clientes: Number(row.clientes || 0),
    servicos: Number(row.servicos || 0),
    orcamentos: Number(row.orcamentos || 0),
    arquivos: Number(row.arquivos || 0),
  };
}

async function deleteOrInactivateUser(id, authUser) {
  const existing = await findUserById(id);
  if (!existing) throw new Error("Usuário não encontrado.");
  if (!canSeeManagedUser(authUser, existing)) {
    throw new Error("Usuário protegido pelo superusuário.");
  }
  if (Number(id) === Number(authUser?.id)) {
    throw new Error("Você não pode excluir ou inativar o próprio usuário.");
  }
  if (isSuperAdminUser(existing) || isSuperAdminLocked(existing)) {
    throw new Error("Usuário protegido pelo superusuário.");
  }

  const vinculos = await userBusinessRecordCounts(existing);
  const totalVinculos = Object.values(vinculos).reduce((sum, value) => sum + Number(value || 0), 0);

  if (totalVinculos > 0) {
    const result = await postgresPool.query(`
      UPDATE usuarios
      SET ativo = FALSE,
          cadastro_pendente = FALSE,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING id, usuario, nome, sobrenome, email, telefone, data_nascimento, perfil, permissoes, ativo, superadmin_locked, cadastro_pendente
    `, [Number(id)]);
    await postgresPool.query("DELETE FROM sessoes WHERE usuario_id = $1", [Number(id)]);
    return { action: "inactivated", usuario: publicUserAdmin(result.rows[0]), vinculos };
  }

  await postgresPool.query("DELETE FROM sessoes WHERE usuario_id = $1", [Number(id)]);
  await postgresPool.query("DELETE FROM usuarios WHERE id = $1", [Number(id)]);
  return { action: "deleted", usuario: publicUserAdmin(existing), vinculos };
}

function temporaryPassword() {
  return randomBytes(6).toString("base64url").replace(/[^a-zA-Z0-9]/g, "").slice(0, 10);
}

function safeNormalizeEmail(value) {
  const text = String(value || "").trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text) ? text : "";
}

async function resetUserPasswordByEmail(usuario, email) {
  const targetEmail = safeNormalizeEmail(email || usuario).toLowerCase();
  if (!targetEmail) return false;
  const user = await findUserByLogin(targetEmail);
  const active = user?.ativo === true;
  if (!user || !active || normalizeEmail(user.email || "").toLowerCase() !== targetEmail) return false;

  const newPassword = temporaryPassword();
  await postgresPool.query(
    "UPDATE usuarios SET senha_hash = $1, deve_trocar_senha = TRUE, senha_alterada_em = NULL, senha_politica_versao = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3",
    [passwordHash(newPassword), PASSWORD_POLICY_VERSION, user.id],
  );

  await sendSmtpMail({
    to: targetEmail,
    subject: "ConsultApp - Recuperação de senha",
    text: `Olá, ${user.nome}.\r\n\r\nFoi solicitada a recuperação de acesso ao ConsultApp.\r\n\r\nE-mail de acesso: ${user.email}\r\nUsuário técnico: ${user.usuario}\r\nSenha temporária: ${newPassword}\r\n\r\nApós entrar no sistema, você deverá criar uma nova senha antes de continuar.\r\n\r\nSe você não solicitou esta recuperação, informe o administrador do sistema.`,
    html: `
      <p>Olá, ${escapeHtmlEmail(user.nome)}.</p>
      <p>Foi solicitada a recuperação de acesso ao ConsultApp.</p>
      <p><strong>E-mail de acesso:</strong> ${escapeHtmlEmail(user.email)}<br>
      <strong>Usuário técnico:</strong> ${escapeHtmlEmail(user.usuario)}<br>
      <strong>Senha temporária:</strong> ${escapeHtmlEmail(newPassword)}</p>
      <p>Após entrar no sistema, você deverá criar uma nova senha antes de continuar.</p>
      <p>Se você não solicitou esta recuperação, informe o administrador do sistema.</p>
    `,
  });

  return true;
}

async function resetUserPasswordById(id, authUser) {
  if (!canManageUserPasswords(authUser)) {
    throw new Error("Somente ADMIN ou superusuário pode redefinir senha.");
  }
  const target = await findUserById(id);
  if (!target) throw new Error("Usuário não encontrado.");
  if (!canSeeManagedUser(authUser, target)) {
    throw new Error("Usuário protegido pelo superusuário.");
  }
  if (isSuperAdminUser(target) && !isSuperAdminUser(authUser)) {
    throw new Error("Somente o superusuário pode redefinir esta senha.");
  }
  if (isSuperAdminLocked(target) && !isSuperAdminUser(authUser)) {
    throw new Error("Usuário protegido pelo superusuário.");
  }
  if (target.cadastro_pendente === true) {
    throw new Error("Usuário pendente deve concluir o Primeiro acesso.");
  }
  if (target.ativo !== true) {
    throw new Error("Ative o usuário antes de redefinir a senha.");
  }
  if (!safeNormalizeEmail(target.email)) {
    throw new Error("Usuário sem e-mail válido cadastrado.");
  }

  const sent = await resetUserPasswordByEmail("", target.email);
  if (!sent) throw new Error("Não foi possível enviar a senha temporária.");
  return publicUserAdmin(target);
}

function userMustChangePassword(user) {
  if (!user || isGuestUser(user)) return false;
  if (user.deve_trocar_senha === true) return true;
  if (String(user.senha_politica_versao || "") !== PASSWORD_POLICY_VERSION) return true;
  if (!user.senha_alterada_em) return true;
  const changedAt = new Date(user.senha_alterada_em).getTime();
  if (!Number.isFinite(changedAt)) return true;
  return Date.now() - changedAt >= PASSWORD_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
}

async function changeTemporaryPassword(usuario, senhaTemporaria, novaSenha) {
  const user = await findUserByLogin(String(usuario || ""));
  const active = user?.ativo === true;
  if (!user || !active || !userMustChangePassword(user) || !verifyPassword(senhaTemporaria || "", user.senha_hash)) {
    throw new Error("Usuário ou senha atual inválidos.");
  }
  assertStrongPassword(novaSenha, user);
  if (String(novaSenha) === String(senhaTemporaria || "")) {
    throw new Error("A nova senha deve ser diferente da senha atual.");
  }

  await postgresPool.query(
    "UPDATE usuarios SET senha_hash = $1, deve_trocar_senha = FALSE, senha_alterada_em = CURRENT_TIMESTAMP, senha_politica_versao = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3",
    [passwordHash(novaSenha), PASSWORD_POLICY_VERSION, user.id],
  );
}

async function createSession(userId) {
  const token = randomBytes(32).toString("base64url");
  const csrfToken = randomBytes(32).toString("base64url");
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 12);

  await postgresPool.query("DELETE FROM sessoes WHERE expires_at < CURRENT_TIMESTAMP");
  await postgresPool.query(
    "INSERT INTO sessoes (token_hash, usuario_id, expires_at, csrf_token) VALUES ($1, $2, $3, $4)",
    [tokenHash, userId, expiresAt, csrfToken],
  );

  return { token, csrfToken };
}

async function destroySession(token) {
  if (!token) return;
  const tokenHash = hashToken(token);
  await postgresPool.query("DELETE FROM sessoes WHERE token_hash = $1", [tokenHash]);
}

async function currentUser(request) {
  const token = parseCookies(request).consult_session;
  if (!token) return null;
  const tokenHash = hashToken(token);

  const result = await postgresPool.query(`
    SELECT u.id, u.usuario, u.nome, u.sobrenome, u.email, u.telefone, u.data_nascimento, u.perfil, u.permissoes, u.superadmin_locked
    FROM sessoes s
    JOIN usuarios u ON u.id = s.usuario_id
    WHERE s.token_hash = $1
      AND s.expires_at > CURRENT_TIMESTAMP
      AND u.ativo = TRUE
    LIMIT 1
  `, [tokenHash]);
  return result.rows[0] || null;
}

async function sessionCsrfToken(request, createIfMissing = false) {
  const token = parseCookies(request).consult_session;
  if (!token) return "";
  const tokenHash = hashToken(token);

  const result = await postgresPool.query(
    "SELECT csrf_token FROM sessoes WHERE token_hash = $1 AND expires_at > CURRENT_TIMESTAMP LIMIT 1",
    [tokenHash],
  );
  let csrfToken = String(result.rows[0]?.csrf_token || "");
  if (!csrfToken && createIfMissing && result.rows.length) {
    csrfToken = randomBytes(32).toString("base64url");
    await postgresPool.query("UPDATE sessoes SET csrf_token = $1 WHERE token_hash = $2", [csrfToken, tokenHash]);
  }
  return csrfToken;
}

function safeCompareText(actual, expected) {
  const actualBuffer = Buffer.from(String(actual || ""));
  const expectedBuffer = Buffer.from(String(expected || ""));
  return actualBuffer.length > 0
    && actualBuffer.length === expectedBuffer.length
    && timingSafeEqual(actualBuffer, expectedBuffer);
}

function requestBaseOrigin(request) {
  const hostHeader = String(request.headers["x-forwarded-host"] || request.headers.host || "").split(",")[0].trim();
  const protoHeader = String(request.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const protocol = protoHeader || (request.socket?.encrypted ? "https" : "http");
  return hostHeader ? `${protocol}://${hostHeader}` : "";
}

function allowedCsrfOrigins(request) {
  return [
    process.env.PUBLIC_APP_URL,
    process.env.CSRF_ALLOWED_ORIGINS,
    requestBaseOrigin(request),
  ]
    .flatMap((value) => String(value || "").split(","))
    .map((value) => {
      try {
        return new URL(value.trim()).origin;
      } catch {
        return "";
      }
    })
    .filter(Boolean);
}

function isAllowedRequestOrigin(request) {
  const allowed = new Set(allowedCsrfOrigins(request));
  const originHeader = String(request.headers.origin || "").trim();
  if (originHeader) {
    try {
      return allowed.has(new URL(originHeader).origin);
    } catch {
      return false;
    }
  }

  const refererHeader = String(request.headers.referer || "").trim();
  if (refererHeader) {
    try {
      return allowed.has(new URL(refererHeader).origin);
    } catch {
      return false;
    }
  }

  return true;
}

function isStateChangingApiRequest(request, url) {
  return url.pathname.startsWith("/api/")
    && ["POST", "PUT", "PATCH", "DELETE"].includes(request.method || "");
}

function requiresCsrfToken(request, url) {
  if (!isStateChangingApiRequest(request, url)) return false;
  return ![
    "/api/auth/login",
    "/api/auth/guest",
    "/api/auth/close",
    "/api/auth/forgot-password",
    "/api/auth/change-temporary-password",
    "/api/auth/first-access",
  ].includes(url.pathname);
}

async function validateCsrfToken(request) {
  const expected = await sessionCsrfToken(request, false);
  const received = String(request.headers["x-csrf-token"] || "");
  return safeCompareText(received, expected);
}

function sendJson(response, status, payload, headers = {}) {
  writeHead(response, status, { "Content-Type": "application/json; charset=utf-8", ...headers });
  response.end(JSON.stringify(payload));
}

function securityHeaders(extra = {}) {
  return {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "same-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    ...extra,
  };
}

function writeHead(response, status, headers = {}) {
  response.writeHead(status, securityHeaders(headers));
}

function isAllowedStaticPath(requested) {
  const normalized = requested.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || normalized === "index.html") return true;
  if (["manifest.webmanifest", "service-worker.js"].includes(normalized)) return true;
  if (normalized === "src/app.js" || normalized === "src/styles/app.css" || normalized === "src/data/seed.js") return true;
  if (normalized.startsWith("assets/")) return !normalized.split("/").some((part) => part.startsWith("."));
  return false;
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
    sendJson(response, 403, { ok: false, error: "Usuário sem permissão para esta ação." });
    return null;
  }
  return user;
}

async function requireAnyPermission(request, response, permissions) {
  const user = await requireUser(request, response);
  if (!user) return null;
  if (!permissions.some((permission) => hasPermission(user, permission))) {
    await logAudit(request, user, {
      acao: "permissao.negada",
      modulo: "seguranca",
      entidadeTipo: "permissao",
      entidadeId: permissions.join("|"),
      detalhes: { metodo: request.method, rota: request.url },
    }).catch(() => {});
    sendJson(response, 403, { ok: false, error: "Usuario sem permissao para esta acao." });
    return null;
  }
  return user;
}

async function readAppState() {
  return readRelationalAppState();
}

async function writeAppState(state) {
  const normalized = normalizeAppState(state);
  validateUniqueBudgetServices(normalized);
  await writeRelationalAppState(normalized);
  return normalized;
}

function validateUniqueBudgetServices(state) {
  for (const orcamento of state.orcamentos || []) {
    const seen = new Set();
    for (const item of orcamento.itens || []) {
      const code = String(item.servicoCodigo || "").trim();
      if (!code) continue;
      if (seen.has(code)) {
        throw new Error(`O serviço ${code} está duplicado no orçamento ${orcamento.numero}.`);
      }
      seen.add(code);
    }
  }
}

async function readRelationalAppState() {
  const clientsResult = await postgresPool.query(`
    SELECT documento, nome, status, telefone, email, cep, bairro, endereco, numero, complemento,
           uf, cidade, observacoes, razao_social, nome_fantasia, situacao_cnpj, responsavel_nome
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
  responsaveisResult.rows.forEach((row) => {
    if (!responsavelByCliente.has(row.cliente_documento)) responsavelByCliente.set(row.cliente_documento, row);
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
        status: row.status || "ATIVO",
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
        responsavelNome: row.responsavel_nome || responsavel?.nome || "",
      };
    }),
    responsaveis: [],
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
          documento, nome, status, telefone, email, cep, bairro, endereco, numero, complemento,
          uf, cidade, observacoes, razao_social, nome_fantasia, situacao_cnpj, responsavel_nome
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
          $11, $12, $13, $14, $15, $16, $17
        )
      `, [
        requiredText(cliente.documento, "documento do cliente"),
        requiredText(cliente.nome || cliente.razaoSocial || cliente.nomeFantasia, "nome do cliente"),
        dbText(cliente.status || "ATIVO"),
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
        dbText(cliente.responsavelNome),
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

function safeDispositionPdfFileName(value, fallback = "consult-documento.pdf") {
  const fileName = safePdfFileName(value || fallback);
  return fileName === ".pdf" ? fallback : fileName;
}

function publicPdfFileName(file) {
  const category = String(file?.categoria || "").toLowerCase();
  if (category === "orcamentos") return "consult-orcamento.pdf";
  if (category === "relatorios") return "consult-relatorio.pdf";
  return "consult-documento.pdf";
}

function publicPdfTitle(file) {
  const category = String(file?.categoria || "").toLowerCase();
  if (category === "orcamentos") return "Consult Orcamento";
  if (category === "relatorios") return "Consult Relatorio";
  return "Consult Documento";
}

function inlinePdfDisposition(fileName) {
  const safeName = safeDispositionPdfFileName(fileName);
  return `inline; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(safeName)}`;
}

function sanitizePdfTitle(content, title) {
  const source = Buffer.isBuffer(content) ? content : Buffer.from(content || "");
  const marker = Buffer.from("/Title (", "ascii");
  const start = source.indexOf(marker);
  if (start < 0) return source;

  const titleStart = start + marker.length;
  let titleEnd = titleStart;
  while (titleEnd < source.length) {
    const byte = source[titleEnd];
    if (byte === 0x5c) {
      titleEnd += 2;
      continue;
    }
    if (byte === 0x29) break;
    titleEnd += 1;
  }
  if (titleEnd <= titleStart || titleEnd >= source.length) return source;

  const output = Buffer.from(source);
  const maxLength = titleEnd - titleStart;
  const neutralTitle = String(title || "Consult Documento")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[()\\]/g, " ")
    .slice(0, maxLength);
  const neutralBytes = Buffer.from(neutralTitle, "ascii");
  output.fill(0x20, titleStart, titleEnd);
  neutralBytes.copy(output, titleStart, 0, Math.min(neutralBytes.length, maxLength));
  return output;
}

function isApprovedStatus(value) {
  return String(value || "").toUpperCase().includes("APROV");
}

function contentTypeForFile(fileName) {
  return types[extname(fileName).toLowerCase()] || "application/octet-stream";
}

const temporaryPublicFiles = new Map();
let lastTemporaryPublicFileCleanup = 0;
const temporaryPublicFileTtlMs = Number(process.env.TEMP_PUBLIC_FILE_TTL_MS || 24 * 60 * 60 * 1000);

function createPublicFileToken() {
  return randomBytes(24).toString("base64url");
}

function normalizePublicFileToken(value) {
  const token = String(value || "").trim();
  return /^[a-zA-Z0-9_-]{24,128}$/.test(token) ? token : "";
}

function publicFileRoute(token) {
  return `/arquivo-publico/${encodeURIComponent(token)}`;
}

function temporaryFileRoute(token) {
  return `/arquivo-temporario/${encodeURIComponent(token)}`;
}

function publicFileContent(file) {
  const storageFileName = safeDispositionPdfFileName(file.nome || "documento.pdf");
  const mimeType = file.mimeType || contentTypeForFile(storageFileName);
  if (mimeType === "application/pdf" || storageFileName.toLowerCase().endsWith(".pdf")) {
    return sanitizePdfTitle(file.conteudo, publicPdfTitle(file));
  }
  return file.conteudo;
}

function publicFileResponse(file, content = file.conteudo) {
  const storageFileName = safeDispositionPdfFileName(file.nome || "documento.pdf");
  const body = Buffer.isBuffer(content) ? content : Buffer.from(content || "");
  const publicName = safeDispositionPdfFileName(file.publicName || publicPdfFileName(file));
  return {
    "Content-Type": file.mimeType || contentTypeForFile(storageFileName),
    "Content-Length": body.length,
    "Content-Disposition": inlinePdfDisposition(publicName),
    "Cache-Control": "private, no-store",
  };
}

function sendPublicFile(response, file) {
  const content = publicFileContent(file);
  response.writeHead(200, publicFileResponse(file, content));
  response.end(content);
}

function cleanupTemporaryPublicFiles(now = Date.now()) {
  if (now - lastTemporaryPublicFileCleanup < 60_000) return;
  lastTemporaryPublicFileCleanup = now;
  for (const [token, file] of temporaryPublicFiles.entries()) {
    if (Number(file.expiresAt || 0) <= now) temporaryPublicFiles.delete(token);
  }
}

function createTemporaryPublicFile({ categoria, nome, filePath, mimeType }) {
  cleanupTemporaryPublicFiles();
  const baseDir = categoria === "relatorios" ? reportsDir : budgetsDir;
  const resolvedPath = resolve(filePath);
  if (!resolvedPath.startsWith(baseDir)) return null;
  let token = createPublicFileToken();
  while (temporaryPublicFiles.has(token)) token = createPublicFileToken();
  temporaryPublicFiles.set(token, {
    categoria,
    nome,
    filePath: resolvedPath,
    mimeType,
    expiresAt: Date.now() + temporaryPublicFileTtlMs,
  });
  const url = temporaryFileRoute(token);
  return { token, url, publicUrl: publicFileUrl(url) };
}

function readTemporaryPublicFile(token) {
  cleanupTemporaryPublicFiles();
  const cleanToken = normalizePublicFileToken(token);
  const file = cleanToken ? temporaryPublicFiles.get(cleanToken) : null;
  if (!file || Number(file.expiresAt || 0) <= Date.now()) {
    if (cleanToken) temporaryPublicFiles.delete(cleanToken);
    return null;
  }
  const baseDir = file.categoria === "relatorios" ? reportsDir : budgetsDir;
  const filePath = resolve(file.filePath);
  if (!filePath.startsWith(baseDir) || !existsSync(filePath)) return null;
  const conteudo = readFileSync(filePath);
  return {
    categoria: file.categoria,
    nome: file.nome,
    mimeType: file.mimeType || contentTypeForFile(file.nome),
    conteudo,
    tamanho: conteudo.length,
    temporary: true,
  };
}

async function ensureStoredFileToken(categoria, nome, currentToken = "") {
  const existing = normalizePublicFileToken(currentToken);
  if (existing) return existing;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const token = createPublicFileToken();
    try {
      const updated = await postgresPool.query(
        "UPDATE arquivos SET public_token = $1 WHERE categoria = $2 AND nome = $3 AND COALESCE(public_token, '') = '' RETURNING public_token",
        [token, categoria, nome],
      );
      if (updated.rows[0]?.public_token) return updated.rows[0].public_token;
      const selected = await postgresPool.query(
        "SELECT public_token FROM arquivos WHERE categoria = $1 AND nome = $2 LIMIT 1",
        [categoria, nome],
      );
      const selectedToken = normalizePublicFileToken(selected.rows[0]?.public_token);
      if (selectedToken) return selectedToken;
      return "";
    } catch (error) {
      if (!String(error.message || "").toLowerCase().includes("unique")) throw error;
    }
  }

  throw new Error("Não foi possível gerar link seguro para o arquivo.");
}

async function saveStoredFile({ categoria, nome, mimeType, conteudo }) {
  const buffer = Buffer.isBuffer(conteudo) ? conteudo : Buffer.from(conteudo);
  const publicToken = createPublicFileToken();
  const result = await postgresPool.query(
    `INSERT INTO arquivos (categoria, nome, mime_type, conteudo, tamanho, public_token, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
     ON CONFLICT (categoria, nome)
     DO UPDATE SET mime_type = EXCLUDED.mime_type,
                    conteudo = EXCLUDED.conteudo,
                    tamanho = EXCLUDED.tamanho,
                    public_token = CASE
                      WHEN COALESCE(arquivos.public_token, '') = '' THEN EXCLUDED.public_token
                      ELSE arquivos.public_token
                    END,
                    updated_at = CURRENT_TIMESTAMP
     RETURNING public_token`,
    [categoria, nome, mimeType, buffer, buffer.length, publicToken],
  );
  const token = await ensureStoredFileToken(categoria, nome, result.rows[0]?.public_token);
  const url = publicFileRoute(token);
  return { token, url, publicUrl: publicFileUrl(url) };
}

async function readStoredFile(categoria, nome) {
  const result = await postgresPool.query(
    "SELECT categoria, nome, mime_type, conteudo, tamanho, public_token FROM arquivos WHERE categoria = $1 AND nome = $2",
    [categoria, nome],
  );
  const row = result.rows[0];
  if (!row) return null;
  const token = await ensureStoredFileToken(row.categoria, row.nome, row.public_token);
  const url = publicFileRoute(token);
  return {
    categoria: row.categoria,
    nome: row.nome,
    mimeType: row.mime_type,
    conteudo: Buffer.from(row.conteudo),
    tamanho: Number(row.tamanho || row.conteudo?.length || 0),
    publicToken: token,
    url,
    publicUrl: publicFileUrl(url),
  };
}

async function readStoredFileByPublicToken(token) {
  const cleanToken = normalizePublicFileToken(token);
  if (!cleanToken) return null;

  const result = await postgresPool.query(
    "SELECT categoria, nome, mime_type, conteudo, tamanho, public_token FROM arquivos WHERE public_token = $1 LIMIT 1",
    [cleanToken],
  );
  const row = result.rows[0];
  return row ? {
    categoria: row.categoria,
    nome: row.nome,
    mimeType: row.mime_type,
    conteudo: Buffer.from(row.conteudo),
    tamanho: Number(row.tamanho || row.conteudo?.length || 0),
    publicToken: row.public_token,
  } : null;
}

async function listStoredPdfFiles() {
  const result = await postgresPool.query(`
    SELECT categoria, nome, mime_type, tamanho, public_token, created_at, updated_at
    FROM arquivos
    WHERE mime_type = 'application/pdf'
    ORDER BY updated_at DESC, nome
  `);
  const files = [];
  for (const row of result.rows) {
    const token = await ensureStoredFileToken(row.categoria, row.nome, row.public_token);
    const fileUrl = publicFileRoute(token);
    files.push({
      categoria: row.categoria,
      nome: row.nome,
      mimeType: row.mime_type,
      tamanho: Number(row.tamanho || 0),
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
      updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
      publicToken: token,
      url: fileUrl,
      publicUrl: publicFileUrl(fileUrl),
    });
  }
  return files;
}

async function deleteStoredFile(categoria, nome) {
  const result = await postgresPool.query(
    "DELETE FROM arquivos WHERE categoria = $1 AND nome = $2 RETURNING tamanho",
    [categoria, nome],
  );
  return result.rowCount > 0;
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
    throw new Error("Chrome ou Edge não encontrado para gerar o PDF.");
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
      throw new Error(result.stderr || "Falha ao converter o orçamento para PDF.");
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

async function printHtmlToPdfPortable(html, target, documentTitle = "ConsultApp") {
  let browser;
  try {
    const puppeteer = await import("puppeteer");
    const executablePath = renderChromiumPath();
    const launchOptions = {
      headless: "new",
      executablePath: executablePath || undefined,
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
    await page.setViewport({ width: 1280, height: 1800, deviceScaleFactor: 1 });
    await page.emulateMediaType("print");
    await page.setContent(html, { waitUntil: ["domcontentloaded", "networkidle0"], timeout: 120000 });
    await page.evaluate((title) => {
      document.title = title;
    }, String(documentTitle || "ConsultApp").slice(0, 120));
    await page.evaluate(async () => {
      if (document.fonts?.ready) await document.fonts.ready;
      await Promise.all([...document.images].map((image) => {
        if (image.complete && image.naturalWidth > 0) return Promise.resolve();
        return new Promise((resolve) => {
          image.addEventListener("load", resolve, { once: true });
          image.addEventListener("error", resolve, { once: true });
        });
      }));
    });
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 300));
    await page.pdf({ path: target, printBackground: true, preferCSSPageSize: true, timeout: 120000 });
    if (!existsSync(target) || statSync(target).size < 1024) {
      throw new Error("PDF gerado vazio ou inválido.");
    }
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

function normalizePdfText(value) {
  return String(value ?? "")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u00a0/g, " ")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, " ");
}

async function createReportPdf(report) {
  const columns = Array.isArray(report?.columns) ? report.columns : [];
  const rows = Array.isArray(report?.rows) ? report.rows : [];
  if (!columns.length) throw new Error("Relatorio invalido.");

  const doc = new PDFDocument({
    size: "A4",
    layout: String(report.pageSize || "").toLowerCase().includes("landscape") ? "landscape" : "portrait",
    margin: 34,
    info: {
      Title: normalizePdfText(report.title || "Relatorio"),
      Author: "ConsultApp",
      Creator: "ConsultApp",
    },
  });
  const chunks = [];
  const done = new Promise((resolvePdf, rejectPdf) => {
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolvePdf(Buffer.concat(chunks)));
    doc.on("error", rejectPdf);
  });

  const pageBottom = () => doc.page.height - doc.page.margins.bottom;
  const contentWidth = () => doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const drawHeader = () => {
    const left = doc.page.margins.left;
    const top = doc.page.margins.top;
    doc.font("Helvetica-Bold").fontSize(10).fillColor("#152f38").text("Consult", left, top);
    doc.font("Helvetica-Bold").fontSize(18).fillColor("#152f38").text("CONSULT", doc.page.width - doc.page.margins.right - 130, top, { width: 130, align: "right" });
    doc.font("Helvetica-Bold").fontSize(20).fillColor("#152f38").text(normalizePdfText(report.title || "Relatorio"), left, top + 18, { width: contentWidth() - 150 });
    doc.font("Helvetica-Bold").fontSize(8).fillColor("#152f38").text("Seguranca e Medicina do Trabalho", doc.page.width - doc.page.margins.right - 170, top + 22, { width: 170, align: "right" });
    doc.moveTo(left, top + 48).lineTo(doc.page.width - doc.page.margins.right, top + 48).lineWidth(1.4).strokeColor("#087f8b").stroke();
    doc.font("Helvetica").fontSize(9).fillColor("#52656c").text(normalizePdfText(report.subtitle || ""), left, top + 60, { width: contentWidth() });
    doc.y = top + 86;
  };
  const ensureSpace = (needed) => {
    if (doc.y + needed <= pageBottom()) return;
    doc.addPage();
    drawHeader();
  };
  const drawTableHeader = (columnWidth) => {
    ensureSpace(26);
    const x = doc.page.margins.left;
    const yHeader = doc.y;
    doc.rect(x, yHeader, contentWidth(), 20).fill("#165a72");
    doc.font("Helvetica-Bold").fontSize(7).fillColor("#ffffff");
    columns.forEach((column, index) => {
      doc.text(normalizePdfText(column), x + index * columnWidth + 4, yHeader + 6, { width: columnWidth - 8, height: 12, ellipsis: true });
    });
    doc.y = yHeader + 22;
  };

  drawHeader();
  const summary = Array.isArray(report.summary) ? report.summary : [];
  const summaryColumns = Math.max(1, Math.min(summary.length || 1, doc.page.layout === "landscape" ? 6 : 3));
  const summaryWidth = contentWidth() / summaryColumns;
  const summaryStartY = doc.y;
  summary.forEach((item, index) => {
    const row = Math.floor(index / summaryColumns);
    const column = index % summaryColumns;
    const x = doc.page.margins.left + column * summaryWidth;
    const yBox = summaryStartY + row * 50;
    doc.roundedRect(x, yBox, summaryWidth - 8, 42, 3).strokeColor("#d4e1e5").lineWidth(0.8).stroke();
    doc.font("Helvetica").fontSize(7).fillColor("#52656c").text(normalizePdfText(String(item.label || "").toUpperCase()), x + 7, yBox + 8, { width: summaryWidth - 22, height: 10, ellipsis: true });
    doc.font("Helvetica-Bold").fontSize(11).fillColor("#152f38").text(normalizePdfText(item.value || ""), x + 7, yBox + 23, { width: summaryWidth - 22, height: 14, ellipsis: true });
  });
  doc.y = summaryStartY + Math.ceil(summary.length / summaryColumns) * 50 + 8;

  const columnWidth = contentWidth() / columns.length;
  drawTableHeader(columnWidth);
  rows.forEach((row, rowIndex) => {
    const values = Array.isArray(row) ? row : [row];
    const heights = columns.map((_, index) => doc.heightOfString(normalizePdfText(values[index] ?? ""), { width: columnWidth - 8, lineGap: 1 }));
    const rowHeight = Math.max(22, Math.min(54, Math.max(...heights) + 10));
    if (doc.y + rowHeight > pageBottom()) {
      doc.addPage();
      drawHeader();
      drawTableHeader(columnWidth);
    }
    const yRow = doc.y;
    if (rowIndex % 2 === 0) {
      doc.rect(doc.page.margins.left, yRow, contentWidth(), rowHeight).fill("#f5fafb");
    }
    doc.font("Helvetica").fontSize(7).fillColor("#152f38");
    columns.forEach((_, index) => {
      doc.text(normalizePdfText(values[index] ?? ""), doc.page.margins.left + index * columnWidth + 4, yRow + 6, {
        width: columnWidth - 8,
        height: rowHeight - 10,
        ellipsis: true,
      });
    });
    doc.moveTo(doc.page.margins.left, yRow + rowHeight).lineTo(doc.page.width - doc.page.margins.right, yRow + rowHeight).strokeColor("#dbe6e9").lineWidth(0.6).stroke();
    doc.y = yRow + rowHeight;
  });

  ensureSpace(20);
  doc.moveDown(0.8);
  doc.font("Helvetica").fontSize(8).fillColor("#52656c").text(String(rows.length) + " registro(s)", { align: "right" });
  doc.end();
  return done;
}

async function fetchJson(url) {
  const apiResponse = await fetch(url, { headers: { Accept: "application/json" } });
  const data = await apiResponse.json().catch(() => ({}));
  return { apiResponse, data };
}

function cnpjAddressPayload(data = {}) {
  return {
    cep: onlyDigits(data.cep || ""),
    endereco: [data.tipoLogradouro, data.logradouro].filter(Boolean).join(" ").replace(/\s+/g, " ").trim(),
    bairro: data.bairro || "",
    numero: data.numero || "",
    complemento: data.complemento || "",
    uf: data.uf || "",
    cidade: data.cidade || "",
  };
}

async function consultCnpj(cnpj) {
  const brasilApi = await fetchJson(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`);
  if (brasilApi.apiResponse.ok) {
    return {
      razaoSocial: brasilApi.data.razao_social || "",
      nomeFantasia: brasilApi.data.nome_fantasia || "",
      situacaoCnpj: normalizeCnpjStatus(brasilApi.data.descricao_situacao_cadastral || brasilApi.data.situacao_cadastral),
      ...cnpjAddressPayload({
        cep: brasilApi.data.cep,
        tipoLogradouro: brasilApi.data.descricao_tipo_de_logradouro,
        logradouro: brasilApi.data.logradouro,
        bairro: brasilApi.data.bairro,
        numero: brasilApi.data.numero,
        complemento: brasilApi.data.complemento,
        uf: brasilApi.data.uf,
        cidade: brasilApi.data.municipio,
      }),
    };
  }

  const cnpjWs = await fetchJson(`https://publica.cnpj.ws/cnpj/${cnpj}`);
  if (cnpjWs.apiResponse.ok) {
    const estabelecimento = cnpjWs.data.estabelecimento || {};
    return {
      razaoSocial: cnpjWs.data.razao_social || "",
      nomeFantasia: estabelecimento.nome_fantasia || "",
      situacaoCnpj: normalizeCnpjStatus(estabelecimento.situacao_cadastral || estabelecimento.situacao_cadastral_id),
      ...cnpjAddressPayload({
        cep: estabelecimento.cep,
        tipoLogradouro: estabelecimento.tipo_logradouro,
        logradouro: estabelecimento.logradouro,
        bairro: estabelecimento.bairro,
        numero: estabelecimento.numero,
        complemento: estabelecimento.complemento,
        uf: estabelecimento.estado?.sigla,
        cidade: estabelecimento.cidade?.nome,
      }),
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
  const originalWriteHead = response.writeHead.bind(response);
  response.writeHead = (statusCode, statusMessageOrHeaders, headers) => {
    if (typeof statusMessageOrHeaders === "string") {
      return originalWriteHead(statusCode, statusMessageOrHeaders, securityHeaders(headers || {}));
    }
    return originalWriteHead(statusCode, securityHeaders(statusMessageOrHeaders || {}));
  };

  if (isStateChangingApiRequest(request, url) && !isAllowedRequestOrigin(request)) {
    sendJson(response, 403, { ok: false, error: "Origem da solicitação não autorizada." });
    return;
  }

  if (requiresCsrfToken(request, url) && !(await validateCsrfToken(request))) {
    sendJson(response, 403, { ok: false, error: "Sessão expirada ou solicitação inválida. Recarregue a página e tente novamente." });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/auth/login") {
    try {
      const payload = JSON.parse(await readBody(request));
      const loginIdentity = safeNormalizeEmail(payload.usuario || payload.email);
      if (!loginIdentity) {
        sendJson(response, 400, { ok: false, error: "Informe um e-mail válido." });
        return;
      }
      const loginLimit = rateLimitStatus("login", request, loginIdentity);
      if (loginLimit.limited) {
        sendRateLimitResponse(response, loginLimit);
        return;
      }

      const user = await findUserByLogin(loginIdentity);
      const passwordMatches = user ? verifyPassword(payload.senha || "", user.senha_hash) : false;
      if (user?.cadastro_pendente === true && passwordMatches) {
        recordRateLimitAttempt("login", request, loginIdentity);
        await logAudit(request, user, {
          acao: "auth.login.pendente",
          modulo: "seguranca",
          entidadeTipo: "usuario",
          entidadeId: user.usuario,
          detalhes: { motivo: "cadastro_aguardando_liberacao" },
        }).catch(() => {});
        sendJson(response, 403, { ok: false, error: "Cadastro aguardando liberação administrativa." });
        return;
      }
      const active = user?.ativo === true;
      if (!user || !active || !passwordMatches) {
        recordRateLimitAttempt("login", request, loginIdentity);
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

      clearRateLimit("login", request, loginIdentity);

      if (userMustChangePassword(user)) {
        sendJson(response, 200, {
          ok: true,
          passwordChangeRequired: true,
          user: { usuario: user.usuario, nome: user.nome },
        });
        return;
      }

      const session = await createSession(user.id);
      await logAudit(request, user, {
        acao: "auth.login.sucesso",
        modulo: "seguranca",
        entidadeTipo: "usuario",
        entidadeId: user.usuario,
      }).catch(() => {});
      sendJson(response, 200, { ok: true, user: publicUser(user), csrfToken: session.csrfToken }, { "Set-Cookie": sessionCookie(session.token, 60 * 60 * 12) });
    } catch (error) {
      sendJson(response, 500, { ok: false, error: error.message });
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/auth/first-access") {
    try {
      const payload = JSON.parse(await readBody(request));
      const email = safeNormalizeEmail(payload.email);
      const requestLimit = recordRateLimitAttempt("firstAccess", request, email || requestIp(request));
      if (requestLimit.limited) {
        sendRateLimitResponse(response, requestLimit);
        return;
      }

      const usuario = await requestFirstAccess(payload);
      await logAudit(request, usuario, {
        acao: "auth.primeiro_acesso.solicitado",
        modulo: "seguranca",
        entidadeTipo: "usuario",
        entidadeId: usuario.usuario,
        detalhes: {
          email: usuario.email,
          nome: usuario.nome,
          sobrenome: usuario.sobrenome,
        },
      }).catch(() => {});
      sendJson(response, 201, {
        ok: true,
        message: "Dados enviados com sucesso. Aguarde a liberação do administrador para acessar o sistema.",
      });
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error.message });
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/auth/guest") {
    try {
      const guestUser = process.env.GUEST_USER || "convidado";
      const guestLimit = recordRateLimitAttempt("guest", request, guestUser);
      if (guestLimit.limited) {
        sendRateLimitResponse(response, guestLimit);
        return;
      }

      const user = await findUserByLogin(guestUser);
      const active = user?.ativo === true;
      if (!user || !active || user.perfil !== "CONVIDADO") {
        sendJson(response, 403, { ok: false, error: "Acesso de convidado indisponível." });
        return;
      }

      const session = await createSession(user.id);
      await logAudit(request, user, {
        acao: "auth.login.convidado",
        modulo: "seguranca",
        entidadeTipo: "usuario",
        entidadeId: user.usuario,
      }).catch(() => {});
      sendJson(response, 200, { ok: true, user: publicUser(user), csrfToken: session.csrfToken }, { "Set-Cookie": sessionCookie(session.token, 60 * 60 * 12) });
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
      sendJson(response, 401, { ok: false, error: "Usuário não autenticado." });
      return;
    }
    try {
      const payload = JSON.parse(await readBody(request));
      const permission = String(payload.permission || "");
      const requireAdmin = payload.requireAdmin === true;
      const authorizer = String(payload.usuario || "").trim()
        ? await findUserByLogin(String(payload.usuario || ""))
        : await findUserByLogin(user.usuario);
      const authorizerActive = authorizer?.ativo === true;
      const authorizerPerfil = String(authorizer?.perfil || "").toUpperCase();

      if (!authorizer || !authorizerActive || !verifyPassword(payload.senha || "", authorizer.senha_hash)) {
        await logAudit(request, user, {
          acao: "auth.confirmar_senha.falha",
          modulo: "seguranca",
          entidadeTipo: "usuario",
          entidadeId: user.usuario,
          detalhes: { permissao: permission, autorizador: String(payload.usuario || "") },
        }).catch(() => {});
        sendJson(response, 401, { ok: false, error: "Credenciais inválidas." });
        return;
      }

      if (requireAdmin && authorizerPerfil !== "ADMIN") {
        await logAudit(request, user, {
          acao: "auth.confirmar_senha.negado",
          modulo: "seguranca",
          entidadeTipo: "usuario",
          entidadeId: user.usuario,
          detalhes: { permissao: permission, autorizador: authorizer.usuario, motivo: "autorizador_nao_admin" },
        }).catch(() => {});
        sendJson(response, 403, { ok: false, error: "Somente um administrador pode autorizar esta alteração." });
        return;
      }

      if (permission && !hasPermission(authorizer, permission)) {
        await logAudit(request, user, {
          acao: "auth.confirmar_senha.negado",
          modulo: "seguranca",
          entidadeTipo: "usuario",
          entidadeId: user.usuario,
          detalhes: { permissao: permission, autorizador: authorizer.usuario, motivo: "sem_permissao" },
        }).catch(() => {});
        sendJson(response, 403, { ok: false, error: "Administrador sem permissão para esta confirmação." });
        return;
      }

      await logAudit(request, user, {
        acao: "auth.confirmar_senha.sucesso",
        modulo: "seguranca",
        entidadeTipo: "usuario",
        entidadeId: user.usuario,
        detalhes: { permissao: permission, autorizador: authorizer.usuario, autorizadorNome: authorizer.nome },
      }).catch(() => {});
      sendJson(response, 200, {
        ok: true,
        approver: {
          usuario: authorizer.usuario,
          nome: authorizer.nome,
          perfil: authorizer.perfil,
        },
      });
    } catch (error) {
      sendJson(response, 500, { ok: false, error: error.message });
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/auth/forgot-password") {
    try {
      const payload = JSON.parse(await readBody(request));
      const recoveryEmail = safeNormalizeEmail(payload.email || payload.usuario);
      const resetLimit = recordRateLimitAttempt("forgotPassword", request, recoveryEmail);
      if (resetLimit.limited) {
        sendRateLimitResponse(response, resetLimit);
        return;
      }

      await resetUserPasswordByEmail(recoveryEmail, recoveryEmail);
      await logAudit(request, null, {
        acao: "auth.recuperar_senha",
        modulo: "seguranca",
        entidadeTipo: "usuario",
        entidadeId: recoveryEmail,
        detalhes: { email: recoveryEmail },
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
      const recoveryEmail = safeNormalizeEmail(payload.email || payload.usuario);
      if (!recoveryEmail) throw new Error("Informe um e-mail válido.");
      await changeTemporaryPassword(recoveryEmail, payload.senhaTemporaria, payload.novaSenha);
      await logAudit(request, null, {
        acao: "auth.trocar_senha_temporaria",
        modulo: "seguranca",
        entidadeTipo: "usuario",
        entidadeId: recoveryEmail,
      }).catch(() => {});
      sendJson(response, 200, { ok: true, message: "Senha alterada com sucesso. Faça login novamente com a nova senha." });
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error.message });
    }
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/auth/me") {
    const user = await currentUser(request);
    sendJson(response, 200, {
      ok: true,
      user: publicUser(user),
      csrfToken: user ? await sessionCsrfToken(request, true) : "",
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/usuarios") {
    const authUser = await requirePermission(request, response, "usuarios.view");
    if (!authUser) return;
    try {
      sendJson(response, 200, { ok: true, usuarios: await listUsers(authUser) });
    } catch (error) {
      sendJson(response, 500, { ok: false, error: error.message });
    }
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/auditoria") {
    const authUser = await requirePermission(request, response, "auditoria.view");
    if (!authUser) return;
    try {
      const result = await listAuditLogs({
        usuario: url.searchParams.get("usuario") || "",
        acao: url.searchParams.get("acao") || "",
        modulo: url.searchParams.get("modulo") || "",
        dataInicio: url.searchParams.get("dataInicio") || "",
        dataFim: url.searchParams.get("dataFim") || "",
        limit: url.searchParams.get("limit") || 100,
        page: url.searchParams.get("page") || 1,
      });
      await logAudit(request, authUser, {
        acao: "auditoria.consultar",
        modulo: "auditoria",
        entidadeTipo: "auditoria_logs",
        entidadeId: "",
        detalhes: { quantidade: result.logs.length, total: result.total, pagina: result.page },
      }).catch(() => {});
      sendJson(response, 200, { ok: true, ...result });
    } catch (error) {
      sendJson(response, 500, { ok: false, error: error.message });
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/auditoria/manutencao") {
    const authUser = await requirePermission(request, response, "auditoria.manage");
    if (!authUser) return;
    try {
      const payload = JSON.parse(await readBody(request));
      const mode = String(payload.mode || "preview");
      const deleteOld = mode === "delete";
      const result = await maintainAuditLogs({
        olderThanDays: payload.olderThanDays || 365,
        deleteOld,
      });
      await logAudit(request, authUser, {
        acao: deleteOld ? "auditoria.limpeza" : "auditoria.limpeza.simular",
        modulo: "auditoria",
        entidadeTipo: "auditoria_logs",
        entidadeId: "",
        detalhes: result,
      }).catch(() => {});
      sendJson(response, 200, { ok: true, ...result });
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error.message });
    }
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/arquivos") {
    const authUser = await requirePermission(request, response, "arquivos.view");
    if (!authUser) return;
    try {
      const arquivos = await listStoredPdfFiles();
      await logAudit(request, authUser, {
        acao: "arquivo.consultar",
        modulo: "arquivos",
        entidadeTipo: "arquivo",
        entidadeId: "",
        detalhes: { quantidade: arquivos.length },
      }).catch(() => {});
      sendJson(response, 200, { ok: true, arquivos });
    } catch (error) {
      sendJson(response, 500, { ok: false, error: error.message });
    }
    return;
  }

  if (request.method === "DELETE" && url.pathname.startsWith("/api/arquivos/")) {
    const authUser = await requirePermission(request, response, "arquivos.delete");
    if (!authUser) return;
    try {
      const parts = url.pathname.replace("/api/arquivos/", "").split("/");
      const categoria = safeFileName(decodeURIComponent(parts.shift() || ""));
      const nome = safeFileName(decodeURIComponent(parts.join("/") || ""));
      const allowedCategories = new Set(["orcamentos", "relatorios"]);

      if (!allowedCategories.has(categoria) || !nome) {
        sendJson(response, 400, { ok: false, error: "Arquivo inválido." });
        return;
      }

      const deleted = await deleteStoredFile(categoria, nome);
      const baseDir = categoria === "orcamentos" ? budgetsDir : reportsDir;
      const localPath = resolve(baseDir, nome);
      const deletedLocal = localPath.startsWith(baseDir) && existsSync(localPath);
      if (deletedLocal) {
        rmSync(localPath, { force: true });
      }

      await logAudit(request, authUser, {
        acao: "arquivo.excluir",
        modulo: "arquivos",
        entidadeTipo: "arquivo",
        entidadeId: `${categoria}/${nome}`,
        detalhes: {
          categoria,
          nome,
          removidoBanco: deleted,
          removidoLocal: deletedLocal,
          path: localPath.startsWith(baseDir) ? localPath : "",
        },
      }).catch(() => {});
      sendJson(response, 200, { ok: true, deleted });
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
      const usuario = await createUser(payload, authUser);
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

  const userPasswordResetMatch = url.pathname.match(/^\/api\/usuarios\/(\d+)\/reset-password$/);
  if (request.method === "POST" && userPasswordResetMatch) {
    const authUser = await requirePermission(request, response, "usuarios.edit");
    if (!authUser) return;
    try {
      const usuario = await resetUserPasswordById(userPasswordResetMatch[1], authUser);
      await logAudit(request, authUser, {
        acao: "usuario.redefinir_senha",
        modulo: "usuarios",
        entidadeTipo: "usuario",
        entidadeId: usuario.usuario,
        detalhes: { id: usuario.id, email: usuario.email },
      }).catch(() => {});
      sendJson(response, 200, { ok: true, usuario, message: "Senha temporária enviada para o e-mail do usuário." });
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error.message });
    }
    return;
  }

  const userMatch = url.pathname.match(/^\/api\/usuarios\/(\d+)$/);
  if ((request.method === "PUT" || request.method === "PATCH") && userMatch) {
    const authUser = await requirePermission(request, response, "usuarios.edit");
    if (!authUser) return;
    try {
      const payload = JSON.parse(await readBody(request));
      const usuario = await updateUser(userMatch[1], payload, authUser);
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

  if (request.method === "DELETE" && userMatch) {
    const authUser = await requirePermission(request, response, "usuarios.delete");
    if (!authUser) return;
    try {
      const result = await deleteOrInactivateUser(userMatch[1], authUser);
      await logAudit(request, authUser, {
        acao: result.action === "deleted" ? "usuario.excluir" : "usuario.inativar_por_vinculo",
        modulo: "usuarios",
        entidadeTipo: "usuario",
        entidadeId: result.usuario.usuario,
        detalhes: { id: result.usuario.id, perfil: result.usuario.perfil, vinculos: result.vinculos },
      }).catch(() => {});
      sendJson(response, 200, { ok: true, ...result });
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error.message });
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
      const storedFile = approved && payload.forceRegenerate !== true ? await readStoredFile("orcamentos", fileName) : null;

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
          url: storedFile.url,
          publicUrl: storedFile.publicUrl,
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
        await printHtmlToPdfPortable(String(payload.html), target, "Consult Orcamento");
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
      let fileLink = null;
      if (approved) {
        fileLink = await saveStoredFile({
          categoria: "orcamentos",
          nome: fileName,
          mimeType: "application/pdf",
          conteudo: pdfBuffer,
        });
      } else {
        fileLink = createTemporaryPublicFile({
          categoria: "orcamentos",
          nome: fileName,
          filePath: target,
          mimeType: "application/pdf",
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
        url: fileLink?.url || "",
        publicUrl: fileLink?.publicUrl || "",
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
      const report = payload.report && typeof payload.report === "object" ? payload.report : null;

      if (!fileName || fileName === ".pdf" || (!html && !report)) {
        response.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ ok: false, error: "Relatório inválido." }));
        return;
      }

      mkdirSync(reportsDir, { recursive: true });
      const target = resolve(reportsDir, fileName);
      if (!target.startsWith(reportsDir)) {
        response.writeHead(403, { "Content-Type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ ok: false, error: "Caminho inválido." }));
        return;
      }

      const generatedPdf = report ? await createReportPdf(report) : null;
      if (generatedPdf) {
        writeFileSync(target, generatedPdf);
      } else {
        await printHtmlToPdfPortable(html, target, "Consult Relatorio");
      }
      const pdfBuffer = generatedPdf || readFileSync(target);
      const fileLink = await saveStoredFile({
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
      response.end(JSON.stringify({
        ok: true,
        fileName,
        path: target,
        url: fileLink.url,
        publicUrl: fileLink.publicUrl,
        mimeType: "application/pdf",
        contentBase64: pdfBuffer.toString("base64"),
      }));
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
        response.end(JSON.stringify({ ok: false, error: "Relatório inválido." }));
        return;
      }

      mkdirSync(reportsDir, { recursive: true });
      const target = resolve(reportsDir, fileName);
      if (!target.startsWith(reportsDir)) {
        response.writeHead(403, { "Content-Type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ ok: false, error: "Caminho inválido." }));
        return;
      }

      const xlsxBuffer = createReportXlsx(payload.report);
      await logAudit(request, authUser, {
        acao: "relatorio.gerar_excel",
        modulo: "relatorios",
        entidadeTipo: "relatorio",
        entidadeId: fileName,
        detalhes: { armazenamento: "download", tamanho: xlsxBuffer.length, titulo: payload.report?.title || "" },
      }).catch(() => {});
      response.writeHead(200, {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Content-Length": xlsxBuffer.length,
        "Cache-Control": "no-store",
      });
      response.end(xlsxBuffer);
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
      const attachmentName = publicPdfFileName({ categoria: "orcamentos" });
      const attachmentPath = resolve(budgetsDir, fileName);
      const storedAttachment = await readStoredFile("orcamentos", fileName);
      const hasLocalAttachment = attachmentPath.startsWith(budgetsDir) && existsSync(attachmentPath);
      if (!storedAttachment && !hasLocalAttachment) {
        response.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ ok: false, error: "PDF do orçamento não encontrado. Salve o orçamento novamente." }));
        return;
      }

      const attachmentContent = sanitizePdfTitle(
        storedAttachment?.conteudo || readFileSync(attachmentPath),
        publicPdfTitle({ categoria: "orcamentos" }),
      );
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
        attachmentPath: "",
        attachmentContent,
        attachmentMimeType: storedAttachment?.mimeType || "application/pdf",
        attachmentName,
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
    response.end(JSON.stringify({ ok: true, version: serverVersion, saveBudget: true, database: "postgres" }));
    return;
  }

  if (request.method === "GET" && url.pathname.startsWith("/api/cnpj/")) {
    const authUser = await requireAnyPermission(request, response, ["clientes.create", "clientes.edit"]);
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
        cep: data.cep,
        bairro: data.bairro,
        endereco: data.endereco,
        numero: data.numero,
        complemento: data.complemento,
        uf: data.uf,
        cidade: data.cidade,
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

  if (request.method === "GET" && url.pathname.startsWith("/arquivo-publico/")) {
    const token = decodeURIComponent(url.pathname.replace("/arquivo-publico/", ""));
    const storedFile = await readStoredFileByPublicToken(token);

    if (!storedFile) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }

    sendPublicFile(response, storedFile);
    return;
  }

  if (request.method === "GET" && url.pathname.startsWith("/arquivo-temporario/")) {
    const token = decodeURIComponent(url.pathname.replace("/arquivo-temporario/", ""));
    const temporaryFile = readTemporaryPublicFile(token);

    if (!temporaryFile) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }

    sendPublicFile(response, temporaryFile);
    return;
  }

  if (request.method === "GET" && url.pathname.startsWith("/orcamentos/")) {
    const authUser = await currentUser(request);
    if (!authUser) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    const fileName = safeFileName(decodeURIComponent(url.pathname.replace("/orcamentos/", "")));
    const filePath = resolve(budgetsDir, fileName);
    const storedFile = await readStoredFile("orcamentos", fileName);

    if (storedFile) {
      sendPublicFile(response, storedFile);
      return;
    }

    if (!filePath.startsWith(budgetsDir) || !existsSync(filePath)) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }

    sendPublicFile(response, {
      categoria: "orcamentos",
      nome: fileName,
      mimeType: contentTypeForFile(filePath),
      conteudo: readFileSync(filePath),
    });
    return;
  }

  if (request.method === "GET" && url.pathname.startsWith("/relatorios/")) {
    const authUser = await currentUser(request);
    if (!authUser) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    const fileName = safeFileName(decodeURIComponent(url.pathname.replace("/relatorios/", "")));
    const filePath = resolve(reportsDir, fileName);
    const storedFile = await readStoredFile("relatorios", fileName);

    if (storedFile) {
      sendPublicFile(response, storedFile);
      return;
    }

    if (!filePath.startsWith(reportsDir) || !existsSync(filePath)) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }

    sendPublicFile(response, {
      categoria: "relatorios",
      nome: fileName,
      mimeType: contentTypeForFile(filePath),
      conteudo: readFileSync(filePath),
    });
    return;
  }

  if (!["GET", "HEAD"].includes(request.method)) {
    response.writeHead(405);
    response.end("Method not allowed");
    return;
  }

  const requested = normalize(decodeURIComponent(url.pathname)).replace(/^[/\\]+/, "");
  if (!isAllowedStaticPath(requested)) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }

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
