import { existsSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path, { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, "..");
const cacheDir = process.env.PUPPETEER_CACHE_DIR || resolve(root, ".cache", "puppeteer");
const cliPath = path.join(root, "node_modules", "puppeteer", "lib", "puppeteer", "node", "cli.js");

if (!existsSync(cliPath)) {
  console.warn("Puppeteer nao encontrado. Pulando instalacao do Chrome.");
  process.exit(0);
}

mkdirSync(cacheDir, { recursive: true });

const result = spawnSync(process.execPath, [cliPath, "browsers", "install", "chrome"], {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
    PUPPETEER_CACHE_DIR: cacheDir,
  },
});

process.exit(result.status || 0);
