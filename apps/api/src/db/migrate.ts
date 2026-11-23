import { migrate } from 'drizzle-orm/node-postgres/migrator';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDb } from './client.js';
import { loadEnv } from '../env.js';

export const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../drizzle');

export async function runMigrations(url: string): Promise<void> {
  const { db, pool } = createDb(url);
  try {
    await migrate(db, { migrationsFolder, migrationsSchema: 'treoo' });
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  runMigrations(loadEnv().DATABASE_URL)
    .then(() => console.log('Migrations applied.'))
    .catch((err) => { console.error(err); process.exit(1); });
}
