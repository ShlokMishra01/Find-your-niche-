import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { Pool } = require("pg");
const envPath = path.resolve(".env.local");
if (fs.existsSync(envPath)) for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (!match || process.env[match[1]]) continue;
  const value = match[2].replace(/^(['"])(.*)\1$/, "$2"); process.env[match[1]] = value;
}
if (!process.env.DATABASE_URL) { console.error("DATABASE_URL is required; no migration was run."); process.exit(1); }
const sql = fs.readFileSync(path.resolve("db/migrations/001_core.sql"), "utf8");
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
try { await pool.query(sql); console.log("Applied db/migrations/001_core.sql"); }
catch (error) { console.error("Migration failed:", error instanceof Error ? error.message : "unknown database error"); process.exitCode = 1; }
finally { await pool.end(); }
