import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { DATA_DIR, PREFERRED_STATS_PORT, normalizePort } from './config.mjs';
import { computeConversationStats } from './transcript.mjs';

export const TOKEN_PATH = path.join(DATA_DIR, 'qol-stats-token');
export const PORT_PATH = path.join(DATA_DIR, 'qol-stats-port');
export const PID_LOCK_PATH = path.join(DATA_DIR, 'qol-daemon.pid');

let activeStatsPort = null;
let activeStatsServer = null;
let statsServerPromise = null;
let cachedToken = null;

export function claimSingleInstanceLock(pidPath = PID_LOCK_PATH) {
  try {
    fs.mkdirSync(path.dirname(pidPath), { recursive: true });
    fs.writeFileSync(pidPath, String(process.pid), 'utf8');
  } catch {
    // ignore
  }
}

export function isCurrentInstanceOwner(pidPath = PID_LOCK_PATH) {
  try {
    if (!fs.existsSync(pidPath)) return true;
    const ownerPid = Number(fs.readFileSync(pidPath, 'utf8').trim());
    return !ownerPid || ownerPid === process.pid;
  } catch {
    return true;
  }
}

export function getActiveStatsPort() {
  return activeStatsPort;
}

export function getStatsToken(tokenPath = TOKEN_PATH) {
  if (cachedToken && tokenPath === TOKEN_PATH) return cachedToken;
  try {
    const t = fs.readFileSync(tokenPath, 'utf8').trim();
    if (t.length >= 32) {
      if (tokenPath === TOKEN_PATH) cachedToken = t;
      return t;
    }
  } catch {
    // generate below
  }
  const t = crypto.randomBytes(24).toString('hex');
  try {
    fs.mkdirSync(path.dirname(tokenPath), { recursive: true });
    fs.writeFileSync(tokenPath, t, { mode: 0o600 });
  } catch {
    // 无法持久化则仅本进程有效
  }
  if (tokenPath === TOKEN_PATH) cachedToken = t;
  return t;
}

export function verifyStatsToken(candidate, expected = getStatsToken()) {
  if (typeof candidate !== 'string' || typeof expected !== 'string') return false;
  const a = Buffer.from(candidate, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length === 0 || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function saveStatsPort(port, portPath = PORT_PATH) {
  try {
    fs.mkdirSync(path.dirname(portPath), { recursive: true });
    fs.writeFileSync(portPath, String(port), { mode: 0o600 });
  } catch {
    // ignore
  }
}

export function readSavedStatsPort(portPath = PORT_PATH) {
  try {
    if (!fs.existsSync(portPath)) return null;
    const raw = fs.readFileSync(portPath, 'utf8').trim();
    return normalizePort(raw, null);
  } catch {
    return null;
  }
}

export function createStatsRequestHandler(opts = {}) {
  const getToken = opts.getToken || (() => getStatsToken());
  const computeStats = opts.computeStats || ((id) => computeConversationStats(id));
  const getPort = opts.getPort || (() => activeStatsPort || PREFERRED_STATS_PORT);

  return (req, res) => {
    try {
      const origin = req.headers.origin;
      res.setHeader('Access-Control-Allow-Origin', origin || '*');
      if (origin) res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'X-QoL-Token');
      res.setHeader('Access-Control-Max-Age', '600');
      if (req.headers['access-control-request-private-network'] === 'true') {
        res.setHeader('Access-Control-Allow-Private-Network', 'true');
      }
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Type', 'application/json; charset=utf-8');

      if (req.method === 'OPTIONS') {
        res.statusCode = 204;
        res.end();
        return;
      }

      const rawUrl = typeof req.url === 'string' ? req.url : '/';
      const url = new URL(rawUrl, `http://127.0.0.1:${getPort()}`);

      if (
        (req.method === 'GET' && (url.pathname === '/stats' || url.pathname === '/health')) ||
        (req.method === 'POST' && url.pathname === '/shutdown')
      ) {
        const expected = getToken();
        const headerToken = req.headers['x-qol-token'];
        const provided =
          typeof headerToken === 'string' && headerToken
            ? headerToken
            : url.searchParams.get('t') || '';

        if (!verifyStatsToken(provided, expected)) {
          res.statusCode = 403;
          res.end('{}');
          return;
        }

        if (req.method === 'POST' && url.pathname === '/shutdown') {
          res.statusCode = 200;
          res.end(JSON.stringify({ ok: true }));
          if (typeof opts.onShutdown === 'function') {
            opts.onShutdown();
          } else {
            setTimeout(() => {
              try {
                activeStatsServer?.close();
              } catch {
                // ignore
              }
              process.exit(0);
            }, 50).unref();
          }
          return;
        }

        if (url.pathname === '/health') {
          res.statusCode = 200;
          res.end(JSON.stringify({ ok: true, service: 'agy-desktop-qol', port: getPort() }));
          return;
        }

        const id = url.searchParams.get('id') || '';
        const data = computeStats(id);
        res.statusCode = 200;
        res.end(
          JSON.stringify(
            data || {
              turns: 0,
              steps: 0,
              totalTokens: 0,
              outputTokens: 0,
              cacheHitRate: 0,
              tps: 0,
            }
          )
        );
        return;
      }

      res.statusCode = 404;
      res.end('{}');
    } catch {
      if (!res.headersSent) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
      }
      res.end('{}');
    }
  };
}

export function ensureStatsServer(preferredPort = PREFERRED_STATS_PORT, opts = {}) {
  if (activeStatsPort !== null) return Promise.resolve(activeStatsPort);
  if (statsServerPromise) return statsServerPromise;

  const takeover = Boolean(opts.takeover);
  if (takeover) {
    claimSingleInstanceLock();
  }

  statsServerPromise = new Promise((resolve, reject) => {
    const server = http.createServer(createStatsRequestHandler());
    const initialPort =
      Number.isInteger(preferredPort) && preferredPort >= 0 && preferredPort <= 65535
        ? preferredPort
        : 9223;

    let triedTakeover = false;
    let triedFallback = false;
    const onListening = () => {
      server.off('error', onStartupError);
      server.on('error', (err) => {
        console.error('[warn] 统计服务错误:', err && err.message);
      });
      const addr = server.address();
      activeStatsPort = typeof addr === 'object' && addr ? addr.port : preferredPort;
      activeStatsServer = server;
      saveStatsPort(activeStatsPort);
      resolve(activeStatsPort);
    };

    const onStartupError = (err) => {
      if (takeover && err && err.code === 'EADDRINUSE' && !triedTakeover && initialPort > 0) {
        triedTakeover = true;
        fetch(`http://127.0.0.1:${initialPort}/shutdown`, {
          method: 'POST',
          headers: { 'X-QoL-Token': getStatsToken() },
          signal: AbortSignal.timeout(500),
        })
          .catch(() => {})
          .finally(() => {
            setTimeout(() => {
              server.listen(initialPort, '127.0.0.1');
            }, 150);
          });
        return;
      }
      if (err && err.code === 'EADDRINUSE' && !triedFallback) {
        triedFallback = true;
        console.error(`[info] 统计端口 ${preferredPort} 已被占用，正在分配随机可用端口...`);
        server.listen(0, '127.0.0.1');
        return;
      }
      statsServerPromise = null;
      console.error('[warn] 统计服务错误:', err && err.message);
      reject(err);
    };

    server.once('listening', onListening);
    server.on('error', onStartupError);
    server.listen(initialPort, '127.0.0.1');
  });

  return statsServerPromise;
}

export async function closeStatsServer() {
  if (!activeStatsServer) return;
  const srv = activeStatsServer;
  activeStatsServer = null;
  activeStatsPort = null;
  statsServerPromise = null;
  await new Promise((resolve) => srv.close(() => resolve()));
}

export async function probeRunningStatsServer(port, token = getStatsToken()) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) return false;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, {
      headers: { 'X-QoL-Token': token },
      signal: AbortSignal.timeout(600),
    });
    if (!res.ok) return false;
    const j = await res.json();
    return Boolean(j && j.ok && j.service === 'agy-desktop-qol');
  } catch {
    return false;
  }
}

export async function resolveStatsPort(opts = {}) {
  if (activeStatsPort !== null) return activeStatsPort;
  if (opts.startServer) {
    return await ensureStatsServer();
  }
  const saved = readSavedStatsPort();
  const candidates = [...new Set([saved, PREFERRED_STATS_PORT].filter(Boolean))];
  const token = getStatsToken();
  for (const port of candidates) {
    if (await probeRunningStatsServer(port, token)) {
      return port;
    }
  }
  return saved || PREFERRED_STATS_PORT;
}
