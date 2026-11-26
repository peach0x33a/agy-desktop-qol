import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MAX_IMAGE_BYTES, MIME_MAP, t } from './config.mjs';

export function expandHomePath(inputPath, opts = {}) {
  const raw = String(inputPath || '').trim();
  if (raw === '~') return os.homedir();
  if (raw.startsWith('~/') || raw.startsWith('~\\')) {
    return path.join(os.homedir(), raw.slice(2));
  }
  const platform = opts.platform || process.platform;
  if (platform === 'linux') {
    const winMatch = raw.match(/^([a-zA-Z]):[\\/](.*)$/);
    if (winMatch) {
      const mntRoot = opts.mntRoot || '/mnt';
      const driveDir = path.posix.join(mntRoot, winMatch[1].toLowerCase());
      const checkExists = opts.existsSync || fs.existsSync;
      if (checkExists(driveDir)) {
        return path.posix.join(driveDir, winMatch[2].replace(/\\/g, '/'));
      }
    }
  }
  return raw;
}

async function readResponseWithLimit(res, maxBytes, errTooLargeMsg) {
  const cl = Number(res.headers.get('content-length'));
  if (Number.isFinite(cl) && cl > maxBytes) {
    throw new Error(errTooLargeMsg);
  }
  if (!res.body || typeof res.body.getReader !== 'function') {
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > maxBytes) throw new Error(errTooLargeMsg);
    return buf;
  }
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel().catch(() => {});
          throw new Error(errTooLargeMsg);
        }
        chunks.push(Buffer.from(value));
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // ignore
    }
  }
  return Buffer.concat(chunks, total);
}

export async function resolveWallpaperBgUrl(imagePath, lang = 'zh') {
  const tr = t({ lang });
  const raw = String(imagePath || '').trim();
  if (!raw) throw new Error(tr.errNoImage);

  if (raw.startsWith('data:image/')) {
    // base64 数据长度约等于原始字节的 4/3
    if (Buffer.byteLength(raw, 'utf8') > Math.ceil(MAX_IMAGE_BYTES * 1.4)) {
      throw new Error(tr.errImageTooLarge);
    }
    return raw;
  }

  if (/^https?:\/\//i.test(raw)) {
    let res;
    try {
      res = await fetch(raw, { signal: AbortSignal.timeout(15000) });
    } catch (err) {
      throw new Error(tr.errImageFetch(err?.message || String(err)));
    }
    if (!res.ok) {
      throw new Error(tr.errImageFetch(`HTTP ${res.status}`));
    }
    const ct = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    const extMime = MIME_MAP[path.extname(new URL(raw).pathname).toLowerCase()];
    const mime = /^image\/[a-z0-9.+-]+$/.test(ct) ? ct : extMime || 'image/png';
    const buf = await readResponseWithLimit(res, MAX_IMAGE_BYTES, tr.errImageTooLarge);
    return `data:${mime};base64,${buf.toString('base64')}`;
  }

  const imgPath = path.resolve(expandHomePath(raw));
  if (!fs.existsSync(imgPath)) {
    throw new Error(tr.errImageNotFound(imgPath));
  }
  const ext = path.extname(imgPath).toLowerCase();
  if (!MIME_MAP[ext]) {
    throw new Error(tr.errImageType(ext));
  }
  if (fs.statSync(imgPath).size > MAX_IMAGE_BYTES) {
    throw new Error(tr.errImageTooLarge);
  }
  const mime = MIME_MAP[ext];
  const base64 = fs.readFileSync(imgPath).toString('base64');
  return `data:${mime};base64,${base64}`;
}
