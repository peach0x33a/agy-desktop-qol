import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inspectLanguageServerLog, resolveConvHomeDir } from './logs.mjs';
import { readDbMaxTokenLimit, readDbTimingStats } from './proto-db.mjs';

const transcriptCache = new Map();

export function newTranscriptState() {
  return {
    offset: 0,
    turns: 0,
    steps: 0,
    inputTokens: 0,
    cacheReadTokens: 0,
    outputTokens: 0,
    lastContextTokens: 0,
    lastCacheHitRate: 0,
    lastModel: '',
    modelMs: 0,
    pendingTs: null,
    pendingOut: 0,
    tpsOut: 0,
    tpsMs: 0,
    lastStep: null,
  };
}

export function clearTranscriptCache() {
  transcriptCache.clear();
}

// 按字节偏移增量解析 transcript.jsonl：只处理新增的完整行
export function readTranscriptIncremental(convId, logPath) {
  let size;
  try {
    size = fs.statSync(logPath).size;
  } catch {
    return null;
  }
  let st = transcriptCache.get(convId);
  if (!st || size < st.offset) {
    st = newTranscriptState();
    transcriptCache.set(convId, st);
    if (transcriptCache.size > 50) {
      transcriptCache.delete(transcriptCache.keys().next().value);
    }
  }
  if (size > st.offset) {
    const fd = fs.openSync(logPath, 'r');
    let buf;
    try {
      buf = Buffer.alloc(size - st.offset);
      fs.readSync(fd, buf, 0, buf.length, st.offset);
    } finally {
      fs.closeSync(fd);
    }
    const lastNl = buf.lastIndexOf(0x0a);
    if (lastNl >= 0) {
      const text = buf.subarray(0, lastNl + 1).toString('utf8');
      st.offset += lastNl + 1;
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        try {
          const obj = JSON.parse(line);
          if (obj.type !== 'SYSTEM_MESSAGE') st.lastStep = obj;
          const t = obj.created_at ? Date.parse(obj.created_at) : null;
          if (obj.type === 'USER_INPUT') {
            st.turns++;
          } else if (obj.type === 'PLANNER_RESPONSE') {
            st.steps++;
            if (obj.model) st.lastModel = String(obj.model);
            const stepIn = Number(obj.input_tokens || 0);
            const stepCache = Number(obj.cache_read_tokens || 0);
            const stepOut = Number(obj.output_tokens || 0);
            st.inputTokens += stepIn;
            st.cacheReadTokens += stepCache;
            st.outputTokens += stepOut;
            const stepCtx = stepIn + stepCache + stepOut;
            if (stepCtx > 0) {
              st.lastContextTokens = stepCtx;
            }
            if (stepIn + stepCache > 0) {
              st.lastCacheHitRate = Math.round((stepCache / (stepIn + stepCache)) * 100);
            }
          } else if (obj.type === 'CHECKPOINT') {
            const cpOut = Number(obj.output_tokens || 0);
            const cpEst = cpOut > 0 ? cpOut : Math.ceil(String(obj.content || '').length / 3.8);
            if (cpEst > 0) {
              st.lastContextTokens = cpEst;
            }
          }
          // PLANNER_RESPONSE 的 created_at 是该步开始时间; 紧随其后的工具步骤 (GENERIC) 在生成结束时创建，
          // 因此 (工具步骤时间 - 本步时间) 即纯生成耗时，不含工具执行时间。
          // 无论后续步骤是否与 pendingTs 同毫秒，都必须清除 pendingTs，防止将工具执行耗时误算入下一条 GENERIC。
          if (t && st.pendingTs !== null) {
            if (obj.type === 'GENERIC' && t > st.pendingTs) {
              const dt = t - st.pendingTs;
              if (dt < 120000) {
                st.modelMs += dt;
                if (st.pendingOut >= 100) {
                  st.tpsOut += st.pendingOut;
                  st.tpsMs += dt;
                }
              }
            }
            st.pendingTs = null;
            st.pendingOut = 0;
          }
          if (
            t &&
            obj.type === 'PLANNER_RESPONSE' &&
            Number(obj.output_tokens || 0) > 0 &&
            Array.isArray(obj.tool_calls) &&
            obj.tool_calls.length > 0
          ) {
            st.pendingTs = t;
            st.pendingOut = Number(obj.output_tokens || 0);
          }
        } catch {
          // ignore malformed line
        }
      }
    }
  }
  return st;
}

export function inferContextLimit(model, convId, opts = {}) {
  const dbLimit = readDbMaxTokenLimit(convId, opts);
  if (dbLimit > 0) return dbLimit;
  // 旧版 .pbtxt 会话仍可直接读取
  try {
    const convDir =
      opts.conversationsDir ||
      path.join(opts.homeDir || os.homedir(), '.gemini', 'antigravity', 'conversations');
    const pbtxtPath = path.join(convDir, `${convId}.pbtxt`);
    if (fs.existsSync(pbtxtPath)) {
      const m = fs
        .readFileSync(pbtxtPath, 'utf8')
        .slice(0, 65536)
        .match(/max_token_limit:\s*(\d+)/);
      if (m && Number(m[1]) > 0) return Number(m[1]);
    }
  } catch {
    // fall through
  }
  const id = String(model || '')
    .toLowerCase()
    .replace(/\s+/g, '-');
  if (id.includes('orchestrator')) return 512000;
  if (/^gemini-4(?:$|-)/.test(id)) return 512000;
  if (
    /^claude-(?:sonnet|opus|haiku)-5(?:$|-)/.test(id) ||
    /^claude-(?:sonnet|opus)-4-(?:6|7|8)(?:$|-)/.test(id)
  ) {
    return 840000;
  }
  let modelMax = 1048576;
  if (/gpt-oss-120b/.test(id)) modelMax = 131072;
  else if (/claude-(sonnet|opus|haiku)-4-5|claude-(sonnet|opus)-4(-|$)/.test(id)) {
    modelMax = 200000;
  }
  return Math.min(modelMax, 256000);
}

export function computeConversationStats(convId, opts = {}) {
  if (!/^[a-zA-Z0-9_-]+$/.test(convId)) return null;
  const homeDir = opts.homeDir || (opts.brainDir ? os.homedir() : resolveConvHomeDir(convId));
  const brainDir =
    opts.brainDir || path.join(homeDir, '.gemini', 'antigravity', 'brain');
  const logPath = path.join(
    brainDir,
    convId,
    '.system_generated',
    'logs',
    'transcript.jsonl'
  );
  if (!fs.existsSync(logPath)) return null;

  const st = readTranscriptIncremental(convId, logPath);
  if (!st) return null;
  const {
    turns,
    steps,
    inputTokens,
    cacheReadTokens,
    outputTokens,
    lastContextTokens,
    lastModel,
    modelMs,
    lastStep,
    tpsOut,
    tpsMs,
  } = st;

  const nowMs = opts.nowMs || Date.now();
  let live = {
    phase: 'idle',
    elapsedSec: 0,
    model: lastModel,
    tools: [],
    detail: '',
  };

  if (lastStep) {
    const stepTs = lastStep.created_at ? Date.parse(lastStep.created_at) : nowMs;
    const elapsedSec = Math.max(0, Math.round((nowMs - stepTs) / 1000));
    const isToolCall =
      lastStep.type === 'PLANNER_RESPONSE' &&
      Array.isArray(lastStep.tool_calls) &&
      lastStep.tool_calls.length > 0;
    const isTerminated =
      lastStep.status === 'CANCELLED' ||
      lastStep.status === 'CANCELED' ||
      lastStep.status === 'ERROR' ||
      lastStep.status === 'FAILED';
    const isRecentError = lastStep.type === 'ERROR_MESSAGE' && elapsedSec <= 120;
    const isWorking =
      !isTerminated &&
      (isToolCall ||
        lastStep.type === 'USER_INPUT' ||
        lastStep.type === 'GENERIC' ||
        isRecentError);

    if (isWorking) {
      const ls = inspectLanguageServerLog(stepTs, {
        logPath: opts.lsLogPath,
        homeDir,
        nowMs,
      });

      if (lastStep.type === 'ERROR_MESSAGE') {
        const errStr = String(lastStep.error || '');
        const att = errStr.match(/attempt\s+(\d+)/i);
        const code = errStr.match(/code\s+(\d{3})/i);
        live = {
          phase: ls?.retryInfo ? 'retry' : 'error',
          elapsedSec,
          model: lastModel,
          tools: [],
          attempt: ls?.retryInfo?.attempt || (att ? Number(att[1]) : 0),
          retryIn: ls?.retryInfo?.retryIn || '',
          code: ls?.retryInfo?.code || (code ? code[1] : ''),
          noCapacity: ls?.retryInfo?.noCapacity || /no capacity/i.test(errStr),
          detail: ls?.retryInfo?.error || errStr.slice(0, 140),
        };
      } else if (isToolCall) {
        const tools = lastStep.tool_calls.map((tc) => tc.name).filter(Boolean);
        live = {
          phase: ls?.activeMonitor ? 'monitor' : 'tool',
          elapsedSec,
          model: lastModel,
          tools,
          detail: ls?.activeMonitor || tools.join(', '),
        };
      } else if (ls?.retryInfo && ls.retryInfo.ts >= stepTs - 2000) {
        live = {
          phase: 'retry',
          elapsedSec,
          model: lastModel,
          tools: [],
          attempt: ls.retryInfo.attempt,
          retryIn: ls.retryInfo.retryIn,
          code: ls.retryInfo.code,
          noCapacity: ls.retryInfo.noCapacity,
          detail: ls.retryInfo.error,
        };
      } else if (ls?.activeMonitor) {
        live = {
          phase: 'monitor',
          elapsedSec,
          model: lastModel,
          tools: [],
          detail: ls.activeMonitor,
        };
      } else {
        live = {
          phase: ls?.requestSent ? 'streaming' : 'waiting',
          elapsedSec,
          model: lastModel,
          tools: [],
          detail: '',
        };
      }
    }
  }

  const resolvedOpts = { ...opts, homeDir };
  const maxContext = inferContextLimit(lastModel, convId, resolvedOpts);
  const dbTiming = readDbTimingStats(convId, resolvedOpts);
  const totalTokens = inputTokens + cacheReadTokens + outputTokens;
  const promptTokens = inputTokens + cacheReadTokens;
  const cacheHitRate = promptTokens > 0 ? Math.round((cacheReadTokens / promptTokens) * 100) : 0;
  const tps = dbTiming?.hasData
    ? dbTiming.tps
    : tpsMs > 0
      ? Math.round(tpsOut / (tpsMs / 1000))
      : 0;
  const effectiveModelMs = dbTiming?.hasData ? dbTiming.modelMs : modelMs;
  const contextPct = Math.min(100, Math.round((lastContextTokens / maxContext) * 100));

  return {
    turns,
    steps,
    totalTokens,
    outputTokens,
    cacheHitRate,
    lastCacheHitRate: st.lastCacheHitRate,
    tps,
    contextPct,
    modelSeconds: Math.round(effectiveModelMs / 1000),
    lastContextTokens,
    maxContext,
    live,
  };
}
