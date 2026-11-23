import { buildApp } from './app.js';
import { createDb } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import { loadEnv } from './env.js';

const env = loadEnv();
if (process.env.MIGRATE_ON_START !== 'false') await runMigrations(env.DATABASE_URL);
const { db, pool } = createDb(env.DATABASE_URL);
const app = await buildApp({ env, db });

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'Shutting down');
  await app.close();
  await pool.end();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ port: env.PORT, host: env.HOST });
