import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let wslDistrosCache = { distros: null, at: 0 };
export function discoverWslDistros() {
  if (process.platform !== 'win32') return [];
  const now = Date.now();
  if (wslDistrosCache.distros && now - wslDistrosCache.at < 60000) {
    return wslDistrosCache.distros;
  }
  const distros = [];
  try {
    const out = execFileSync('wsl.exe', ['-l', '-q'], {
      timeout: 1500,
      windowsHide: true,
    });
    const text = out
      .toString('utf16le')
      .replace(/\0/g, '')
      .trim();
    for (const line of text.split(/\r?\n/)) {
      const d = line.trim();
      if (d && !d.startsWith('docker-desktop')) distros.push(d);
    }
  } catch {
    for (const d of ['Ubuntu', 'Ubuntu-24.04', 'Ubuntu-22.04', 'Debian']) {
      try {
        if (fs.existsSync(`\\\\wsl.localhost\\${d}\\home`)) distros.push(d);
      } catch {
        // ignore
      }
    }
  }
  wslDistrosCache = { distros, at: now };
  return distros;
}

let candidateHomeDirsCache = { dirs: null, at: 0 };
export function getCandidateHomeDirs() {
  const now = Date.now();
  if (candidateHomeDirsCache.dirs && now - candidateHomeDirsCache.at < 30000) {
    return candidateHomeDirsCache.dirs;
  }
  const dirs = [os.homedir()];
  if (process.platform === 'win32') {
    for (const distro of discoverWslDistros()) {
      const wslHomeRoot = `\\\\wsl.localhost\\${distro}\\home`;
      try {
        for (const entry of fs.readdirSync(wslHomeRoot, { withFileTypes: true })) {
          if (entry.isDirectory()) {
            const candidate = path.join(wslHomeRoot, entry.name);
            if (!dirs.includes(candidate)) dirs.push(candidate);
          }
        }
      } catch {
        // ignore unreachable WSL distro
      }
    }
  } else if (process.platform === 'linux') {
    try {
      if (fs.existsSync('/mnt/c/Users')) {
        for (const entry of fs.readdirSync('/mnt/c/Users', { withFileTypes: true })) {
          if (
            entry.isDirectory() &&
            !['Public', 'Default', 'Default User', 'All Users'].includes(entry.name)
          ) {
            const candidate = path.join('/mnt/c/Users', entry.name);
            if (!dirs.includes(candidate)) dirs.push(candidate);
          }
        }
      }
    } catch {
      // ignore
    }
  }
  candidateHomeDirsCache = { dirs, at: now };
  return dirs;
}

const convHomeCache = new Map();
export function resolveConvHomeDir(convId) {
  const cached = convHomeCache.get(convId);
  if (cached) {
    const tr = path.join(
      cached,
      '.gemini',
      'antigravity',
      'brain',
      convId,
      '.system_generated',
      'logs',
      'transcript.jsonl'
    );
    try {
      if (fs.existsSync(tr)) return cached;
    } catch {
      // invalidate below
    }
    convHomeCache.delete(convId);
  }
  for (const home of getCandidateHomeDirs()) {
    const tr = path.join(
      home,
      '.gemini',
      'antigravity',
      'brain',
      convId,
      '.system_generated',
      'logs',
      'transcript.jsonl'
    );
    try {
      if (fs.existsSync(tr)) {
        convHomeCache.set(convId, home);
        if (convHomeCache.size > 100) {
          convHomeCache.delete(convHomeCache.keys().next().value);
        }
        return home;
      }
    } catch {
      // ignore
    }
  }
  return os.homedir();
}

export function getLanguageServerLogPath(homeDir) {
  const home = homeDir || os.homedir();
  const hubLogDir = path.join(home, '.antigravity-hub-server', 'data');
  try {
    if (fs.existsSync(hubLogDir)) {
      const files = fs
        .readdirSync(hubLogDir)
        .filter((f) => /^ls-.*\.log$/.test(f))
        .map((f) => {
          const full = path.join(hubLogDir, f);
          try {
            return { full, mtimeMs: fs.statSync(full).mtimeMs };
          } catch {
            return { full, mtimeMs: 0 };
          }
        })
        .filter((x) => x.mtimeMs > 0)
        .sort((a, b) => b.mtimeMs - a.mtimeMs);
      if (files.length > 0) return files[0].full;
    }
  } catch {
    // ignore
  }
  const candidates =
    process.platform === 'darwin'
      ? [path.join(home, 'Library', 'Logs', 'Antigravity', 'language_server.log')]
      : process.platform === 'win32' && home === os.homedir()
        ? [
            path.join(process.env.APPDATA || '', 'Antigravity', 'logs', 'language_server.log'),
            path.join(process.env.LOCALAPPDATA || '', 'Antigravity', 'logs', 'language_server.log'),
          ]
        : [
            path.join(home, '.config', 'Antigravity', 'logs', 'language_server.log'),
            path.join(home, '.local', 'state', 'Antigravity', 'logs', 'language_server.log'),
            path.join(home, 'AppData', 'Roaming', 'Antigravity', 'logs', 'language_server.log'),
            path.join(home, 'AppData', 'Local', 'Antigravity', 'logs', 'language_server.log'),
          ];
  return candidates.find((p) => p && fs.existsSync(p)) || null;
}

export function readLogTail(filePath, maxBytes = 24576) {
  try {
    const stat = fs.statSync(filePath);
    const size = stat.size;
    if (size === 0) return '';
    const start = Math.max(0, size - maxBytes);
    const len = size - start;
    const fd = fs.openSync(filePath, 'r');
    try {
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, start);
      const raw = buf.toString('utf8');
      if (start > 0) {
        const firstNl = raw.indexOf('\n');
        return firstNl >= 0 ? raw.slice(firstNl + 1) : '';
      }
      return raw;
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return '';
  }
}

export function parseGlogTimestamp(line, now = new Date()) {
  // e.g. I1119 12:01:59.123456
  const m = String(line || '').match(/[IWEF](\d{2})(\d{2})\s+(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?/);
  if (!m) return null;
  const month = Number(m[1]) - 1;
  const day = Number(m[2]);
  const hour = Number(m[3]);
  const minute = Number(m[4]);
  const second = Number(m[5]);
  const ms = m[6] ? Number(m[6].padEnd(3, '0').slice(0, 3)) : 0;

  let year = now.getFullYear();
  let dt = new Date(year, month, day, hour, minute, second, ms);
  // 跨年边界修复: 1月1日读到12月31日的日志时年份减 1
  if (dt.getTime() > now.getTime() + 86400000) {
    year -= 1;
    dt = new Date(year, month, day, hour, minute, second, ms);
  }
  return dt.getTime();
}

export function inspectLanguageServerLogText(tail, sinceMs, nowMs = Date.now()) {
  if (!tail) return null;

  const lines = tail.split('\n').filter(Boolean);
  const nowDate = new Date(nowMs);
  const cutoff = Math.max(0, (sinceMs || nowMs) - 15000);
  let retryInfo = null;
  const activeMonitors = new Map();
  let requestSent = false;
  let requestSentTs = 0;

  for (const raw of lines) {
    if (raw.includes('csrf_interceptor.go')) continue;
    const ts = parseGlogTimestamp(raw, nowDate);
    if (ts && ts < cutoff) continue;
    const eventTs = ts || nowMs;

    // 1. Run retry / API failure
    const retryMatch = raw.match(
      /Run:\s*attempt\s+(\d+)\s+failed\s+\((.+?)\)(?:,\s*retrying in\s+([0-9.]+[a-z0-9]+))?/i
    );
    if (retryMatch) {
      const errText = retryMatch[2];
      const codeMatch = errText.match(/code\s+(\d{3})/i);
      retryInfo = {
        attempt: Number(retryMatch[1]),
        error: errText,
        code: codeMatch ? codeMatch[1] : '',
        noCapacity: /no capacity/i.test(errText),
        retryIn: retryMatch[3] || '',
        ts: eventTs,
      };
    }

    // 2. LLM safety monitor start / finish
    const monStart = raw.match(/LLM Monitor\s+(\S+?):\s+(Starting evaluation|Calling LLM)/);
    if (monStart) {
      activeMonitors.set(monStart[1], eventTs);
    }
    const monDone = raw.match(/Monitor\s+(\S+)\s+FINISHED:/);
    if (monDone) {
      activeMonitors.delete(monDone[1]);
    }

    // 3. Stream request reached server
    const urlMatch = raw.match(/URL:\s+(https:\/\/\S+streamGenerateContent\S*)/);
    if (urlMatch && (!sinceMs || !ts || ts >= sinceMs - 2000)) {
      requestSent = true;
      requestSentTs = eventTs;
      // 如果新的流式请求在 retry 之后发出，说明重试已发出新请求，清除过期的 retry 状态
      if (retryInfo && eventTs > retryInfo.ts) {
        retryInfo = null;
      }
    }
  }

  let activeMonitor = null;
  for (const [name, startTs] of activeMonitors.entries()) {
    if (nowMs - startTs <= 60000) {
      activeMonitor = name;
    }
  }

  return {
    retryInfo,
    activeMonitor,
    requestSent,
    requestSentTs,
  };
}

export function inspectLanguageServerLog(sinceMs, opts = {}) {
  const logPath = opts.logPath || getLanguageServerLogPath(opts.homeDir);
  if (!logPath) return null;
  const tail = readLogTail(logPath, 24576);
  if (!tail) return null;
  return inspectLanguageServerLogText(tail, sinceMs, opts.nowMs || Date.now());
}
