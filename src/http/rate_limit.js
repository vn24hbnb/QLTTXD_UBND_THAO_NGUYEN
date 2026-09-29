import crypto from 'node:crypto';
import { isIP } from 'node:net';
import dbService from '../db/database.js';
import { isProduction } from './helpers.js';

const requestCounts = new Map();
const WINDOW_MS = 60_000;
let lastLimitCleanup = 0;

export function clientIp(req) {
  // Only the platform-owned header is trusted; arbitrary X-Forwarded-For is ignored.
  const platformIp = process.env.VERCEL === '1' ? req.headers['x-vercel-forwarded-for'] : null;
  if (typeof platformIp === 'string' && isIP(platformIp.trim())) return platformIp.trim();
  return req.socket?.remoteAddress || 'unknown';
}

export async function checkRateLimit(identity, limit = 120) {
  const now = Date.now();
  const windowStart = Math.floor(now / WINDOW_MS) * WINDOW_MS;
  if (isProduction()) {
    const key = crypto.createHash('sha256').update(identity).digest('hex');
    if (now - lastLimitCleanup > WINDOW_MS) {
      lastLimitCleanup = now;
      await dbService.run('DELETE FROM rate_limits WHERE window_start < ?', [windowStart - WINDOW_MS]);
    }
    const result = await dbService.get(
      `INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 1)
       ON CONFLICT(key) DO UPDATE SET
         count = CASE WHEN rate_limits.window_start = excluded.window_start THEN rate_limits.count + 1 ELSE 1 END,
         window_start = excluded.window_start RETURNING count`, [key, windowStart]
    );
    return Number(result.count) <= limit;
  }
  if (now - lastLimitCleanup > WINDOW_MS) {
    lastLimitCleanup = now;
    for (const [key, entry] of requestCounts) if (entry.windowStart !== windowStart) requestCounts.delete(key);
  }
  const entry = requestCounts.get(identity);
  if (!entry || entry.windowStart !== windowStart) {
    if (requestCounts.size >= 10_000) return false;
    requestCounts.set(identity, { windowStart, count: 1 });
    return true;
  }
  entry.count++;
  return entry.count <= limit;
}

