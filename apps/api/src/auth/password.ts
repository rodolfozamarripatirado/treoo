import { hash, verify } from '@node-rs/argon2';

// Argon2id with OWASP-recommended baseline parameters (m=19 MiB, t=2, p=1).
const OPTS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export const hashPassword = (plain: string) => hash(plain, OPTS);
export const verifyPassword = async (stored: string, plain: string) => {
  try { return await verify(stored, plain); } catch { return false; }
};
