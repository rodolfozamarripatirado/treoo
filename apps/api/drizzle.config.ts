import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  schemaFilter: ['treoo'],
  dbCredentials: { url: process.env.DATABASE_URL ?? 'postgres://treoo:treoo@localhost:5432/treoo' },
});
