import type { NextFunction, Request, Response } from "express";

/**
 * Fixed-window, in-memory rate limit per client IP. Enough for a single instance (railway.json
 * runs one replica); move to Redis or Postgres if the API is ever scaled out.
 */
export function rateLimit(o: { windowMs: number; max: number }) {
  const hits = new Map<string, { n: number; reset: number }>();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
  }, o.windowMs).unref();
  return (req: Request, res: Response, next: NextFunction) => {
    const key = req.ip ?? "unknown";
    const now = Date.now();
    let e = hits.get(key);
    if (!e || e.reset <= now) hits.set(key, (e = { n: 0, reset: now + o.windowMs }));
    if (++e.n > o.max) {
      res.setHeader("Retry-After", String(Math.ceil((e.reset - now) / 1000)));
      res.status(429).json({ error: { code: "rate_limited", message: "Juda ko'p so'rov. Birozdan keyin urinib ko'ring" } });
      return;
    }
    next();
  };
}
