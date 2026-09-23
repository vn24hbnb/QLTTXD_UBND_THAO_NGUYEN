import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AsyncLocalStorage } from 'node:async_hooks';
import { DatabaseSync } from 'node:sqlite';

const here = path.dirname(fileURLToPath(import.meta.url));
const context = new AsyncLocalStorage();
const isPostgres = Boolean(process.env.DATABASE_URL);
let instance;
let poolPromise;
let sqliteTail = Promise.resolve();

export function getDatabase(dbPath = process.env.DB_PATH || path.resolve(here, '../../data/qlttxd.db')) {
  if (isPostgres) throw new Error('Kết nối PostgreSQL phải dùng dbService bất đồng bộ.');
  if (process.env.NODE_ENV === 'production') throw new Error('DATABASE_URL bắt buộc trong môi trường sản xuất.');
  if (instance?.dbPath === dbPath) return instance.db;
  if (instance) instance.db.close();
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  if (dbPath !== ':memory:') db.exec('PRAGMA journal_mode=WAL;');
  db.exec(fs.readFileSync(path.join(here, 'schema.sql'), 'utf8'));
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const directory = path.join(here, 'migrations');
  for (const name of fs.readdirSync(directory).filter(n => n.endsWith('.json')).sort()) {
    if (db.prepare('SELECT version FROM schema_migrations WHERE version=?').get(name)) continue;
    const migration = JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'));
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const [table, columns] of Object.entries(migration.addColumns || {})) {
        const existing = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name));
        for (const [column, definition] of Object.entries(columns)) {
          if (!existing.has(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
        }
      }
      for (const sql of migration.statements || []) db.exec(sql);
      db.prepare('INSERT INTO schema_migrations VALUES (?,?)').run(name, new Date().toISOString());
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); db.close(); throw error; }
  }
  instance = { dbPath, db };
  return db;
}

async function getPool() {
  if (!poolPromise) poolPromise = import('pg').then(({ default: pg }) => {
    // Keep counts consistent with SQLite without sacrificing BIGINT precision.
    pg.types.setTypeParser(20, value => {
      const n = Number(value); return Number.isSafeInteger(n) ? n : value;
    });
    const connection = new URL(process.env.DATABASE_URL);
    const local = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(connection.hostname);
    for (const key of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert']) connection.searchParams.delete(key);
    return new pg.Pool({
      connectionString: connection.toString(),
      max: Number(process.env.DB_POOL_MAX || 3),
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 10000,
      statement_timeout: 15000,
      ssl: local ? false : { rejectUnauthorized: true, ...(process.env.DATABASE_CA_CERT ? { ca: process.env.DATABASE_CA_CERT.replace(/\\n/g, '\n') } : {}) }
    });
  });
  return poolPromise;
}

// All application queries use positional '?' parameters, never string interpolation.
export function postgresSql(sql) {
  let index = 0;
  return sql.replace(/'(?:''|[^'])*'|"(?:""|[^"])*"|\?/g, part => part === '?' ? `$${++index}` : part);
}

async function withSqliteLock(fn) {
  if (context.getStore()?.sqlite) return fn();
  const previous = sqliteTail;
  let release;
  sqliteTail = new Promise(resolve => { release = resolve; });
  await previous;
  try { return await fn(); } finally { release(); }
}

async function query(sql, params = [], mode = 'all') {
  if (isPostgres) {
    const client = context.getStore()?.client || await getPool();
    const result = await client.query(postgresSql(sql), params);
    if (mode === 'run') return { changes: result.rowCount, rows: result.rows };
    return mode === 'get' ? result.rows[0] : result.rows;
  }
  return withSqliteLock(() => {
    const stmt = getDatabase().prepare(sql);
    return stmt[mode](...params);
  });
}

export async function closeDatabase() {
  if (instance) { instance.db.close(); instance = null; }
  if (poolPromise) { const pool = await poolPromise; poolPromise = undefined; await pool.end(); }
}

export const dbService = {
  dialect: isPostgres ? 'postgres' : 'sqlite',
  getDb: () => getDatabase(),
  ready: () => query('SELECT 1 AS ok', [], 'get'),
  all: (sql, params = []) => query(sql, params, 'all'),
  get: (sql, params = []) => query(sql, params, 'get'),
  run: (sql, params = []) => query(sql, params, 'run'),
  async exec(sql) {
    if (isPostgres) return (context.getStore()?.client || await getPool()).query(sql);
    return withSqliteLock(() => getDatabase().exec(sql));
  },
  async transaction(fn) {
    if (context.getStore()) return fn(dbService);
    if (!isPostgres) return withSqliteLock(async () => {
      const db = getDatabase();
      db.exec('BEGIN IMMEDIATE');
      try {
        const result = await context.run({ sqlite: true }, () => fn(dbService));
        db.exec('COMMIT'); return result;
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    });
    const client = await (await getPool()).connect();
    try {
      await client.query('BEGIN');
      const result = await context.run({ client }, () => fn(dbService));
      await client.query('COMMIT'); return result;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
};
export default dbService;
