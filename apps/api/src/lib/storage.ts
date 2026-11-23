import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** Files live outside the image in a persistent volume, partitioned by academy, named by UUID. */
export class Storage {
  constructor(private root: string) {}

  private resolve(key: string) {
    if (!/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(png|jpg|webp|txt)$/.test(key)) throw new Error('Invalid storage key');
    return path.join(this.root, key);
  }

  async save(academyId: string, data: Buffer, ext: 'png' | 'jpg' | 'webp' | 'txt'): Promise<string> {
    const key = `${academyId}/${randomUUID()}.${ext}`;
    const full = this.resolve(key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, data, { flag: 'wx' });
    return key;
  }

  /** Callers must have already checked that key belongs to the caller's academy. */
  read(key: string) { return readFile(this.resolve(key)); }
  stream(key: string) { return createReadStream(this.resolve(key)); }
  async exists(key: string) { try { await stat(this.resolve(key)); return true; } catch { return false; } }
}

/** Detects image type from magic bytes rather than trusting the client's MIME type. */
export function sniffImage(buf: Buffer): { ext: 'png' | 'jpg' | 'webp'; mime: string } | null {
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ext: 'png', mime: 'image/png' };
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: 'jpg', mime: 'image/jpeg' };
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return { ext: 'webp', mime: 'image/webp' };
  return null;
}
