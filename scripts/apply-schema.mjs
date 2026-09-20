/**
 * Applies the SQLite schema, then any data migrations, on container start.
 *
 * The Prisma CLI is not usable inside the Next.js standalone bundle, so the
 * build emits `prisma/schema.sql` via `prisma migrate diff` and this script
 * applies it through the Prisma client that the app already ships.
 *
 * On a fresh volume it creates every table. On an existing volume it leaves
 * the tables alone and runs the migrations below. Each migration checks the
 * database's actual state before doing anything, so this whole script is
 * safe on every boot and a migration runs exactly once.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

const SCHEMA_SQL = path.join(process.cwd(), 'prisma', 'schema.sql');

async function tableExists(prisma, name) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = '${name}'`,
  );
  return rows.length > 0;
}

export async function columnNames(prisma, table) {
  const rows = await prisma.$queryRawUnsafe(`PRAGMA table_info("${table}")`);
  return new Set(rows.map((row) => row.name));
}

async function applyFreshSchema(prisma) {
  let sql;
  try {
    sql = readFileSync(SCHEMA_SQL, 'utf8');
  } catch {
    throw new Error(`Could not read ${SCHEMA_SQL}. Was it generated at build time?`);
  }

  const statements = sql
    .split(';')
    .map((statement) => statement.replace(/^\s*--.*$/gm, '').trim())
    .filter((statement) => statement.length > 0);

  for (const statement of statements) {
    await prisma.$executeRawUnsafe(statement);
  }
  console.log(`[scoresage] applied ${statements.length} statements`);
}

// ---------------------------------------------------------------------------
// Migrations: [name, async (prisma) => boolean]. Each returns true when it
// changed something. Add new ones at the end; never edit an existing one.
// ---------------------------------------------------------------------------
const MIGRATIONS = [];

async function main() {
  const { PrismaClient } = await import('@prisma/client');
  const { PrismaBetterSQLite3 } = await import('@prisma/adapter-better-sqlite3');
  const raw = (process.env.DATABASE_URL ?? 'file:./dev.db').trim().replace(/^"(.*)"$/, '$1');
  const url = raw.startsWith('file:') ? raw.slice('file:'.length) : raw;
  const prisma = new PrismaClient({ adapter: new PrismaBetterSQLite3({ url }), log: ['error'] });

  try {
    if (await tableExists(prisma, 'sports')) {
      console.log('[scoresage] schema already present, checking migrations');
    } else {
      console.log('[scoresage] no schema found, applying prisma/schema.sql');
      await applyFreshSchema(prisma);
    }
    for (const [name, migrate] of MIGRATIONS) {
      if (await migrate(prisma)) console.log(`[scoresage] migrated: ${name}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('[scoresage] schema apply failed:', error?.message ?? error);
  process.exit(1);
});
