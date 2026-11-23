import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().url().default('postgres://treoo:treoo@localhost:5432/treoo'),
  UPLOAD_DIR: z.string().default('./data/uploads'),
  MAX_UPLOAD_MB: z.coerce.number().positive().default(10),
  LOGIN_RATE_LIMIT: z.coerce.number().int().positive().default(10),
  SESSION_TTL_HOURS: z.coerce.number().positive().default(12),
  COOKIE_SECURE: z.enum(['true', 'false', 'auto']).default('auto'),
  WEB_DIST: z.string().optional(),
  /** manual = no AI, mock = labelled simulated output, ollama = real inference */
  AI_MODE: z.enum(['manual', 'mock', 'ollama', 'openrouter']).default('mock'),
  OLLAMA_URL: z.string().url().default('http://localhost:11434'),
  OLLAMA_TEXT_MODEL: z.string().default('qwen3:8b'),
  OLLAMA_VISION_MODEL: z.string().default('qwen3-vl:4b-instruct'),
  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_BASE_URL: z.string().url().default('https://openrouter.ai/api/v1'),
  OPENROUTER_TEXT_MODEL: z.string().default('qwen/qwen3-vl-30b-a3b-instruct'),
  OPENROUTER_VISION_MODEL: z.string().default('qwen/qwen3-vl-30b-a3b-instruct'),
  /** Public URL of the app, sent to OpenRouter as HTTP-Referer for attribution (optional). */
  APP_URL: z.string().optional(),
  OLLAMA_TIMEOUT_MS: z.coerce.number().positive().default(180_000),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(overrides: Partial<Record<keyof Env, string>> = {}): Env {
  return EnvSchema.parse({ ...process.env, ...overrides });
}
