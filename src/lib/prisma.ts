import { PrismaBetterSQLite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '@prisma/client';

/**
 * A single Prisma client per process.
 *
 * Next.js hot-reloads server modules in development, which would otherwise
 * open a new SQLite connection on every edit until the pool is exhausted.
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

/**
 * SQLite file from DATABASE_URL. A relative path is resolved against the
 * `prisma/` directory, which is how the Prisma CLI resolves it too, so
 * `file:./dev.db` means the same file for `prisma db push` and the app.
 */
export function databaseFile(): string {
  const raw = (process.env.DATABASE_URL ?? 'file:./dev.db').trim().replace(/^"(.*)"$/, '$1');
  const file = raw.startsWith('file:') ? raw.slice('file:'.length) : raw;
  if (file === ':memory:' || file.startsWith('/') || /^[A-Za-z]:[\\/]/.test(file)) return file;
  return `${process.cwd()}/prisma/${file.replace(/^\.\//, '')}`;
}

function createClient(): PrismaClient {
  const adapter = new PrismaBetterSQLite3({ url: databaseFile() });
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });
}

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

/**
 * Wrap a database operation so a broken or unmigrated database degrades to an
 * empty page with a logged error instead of throwing through the render.
 */
export async function withDatabase<T>(
  operation: () => Promise<T>,
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    return { ok: true, data: await operation() };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown database error';
    console.error('[scoresage] database operation failed:', message);
    return { ok: false, error: message };
  }
}

/**
 * True when the database is both reachable and migrated.
 *
 * A bare `SELECT 1` is not enough: SQLite happily opens an empty file, so a
 * connectivity-only probe reports success for a database with no tables.
 * Querying a real table proves the schema is applied.
 */
export async function isDatabaseReachable(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1 FROM sports LIMIT 1`;
    return true;
  } catch {
    return false;
  }
}

/** Parse a JSON column, returning the fallback on anything unreadable. */
export function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
