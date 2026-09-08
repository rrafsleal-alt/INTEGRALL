import {timingSafeEqual} from 'node:crypto';

export function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  res.setHeader('Origin-Agent-Cluster', '?1');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  const upgrade = req.secure ? '; upgrade-insecure-requests' : '';
  res.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-src 'self'; frame-ancestors 'self'; worker-src 'none'${upgrade}`);
  if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
}

export function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  return left.length === right.length && timingSafeEqual(left, right);
}

export function rateLimit({windowMs = 60_000, max = 60, maxBuckets = 20_000} = {}) {
  const buckets = new Map();
  let lastSweep = Date.now();
  return (req, res, next) => {
    const now = Date.now();
    if (now - lastSweep > windowMs * 2) {
      for (const [key, value] of buckets) if (value.reset <= now) buckets.delete(key);
      lastSweep = now;
    }
    const key = req.ip || req.socket?.remoteAddress || 'unknown';
    // Limita crescimento sob botnets/IPs rotativos. Evita memória sem teto sem
    // alterar a contagem de um IP já conhecido. Map preserva ordem de inserção.
    if (!buckets.has(key) && buckets.size >= Math.max(1000, Number(maxBuckets) || 20_000)) {
      for (const [oldKey, value] of buckets) {
        if (value.reset <= now) { buckets.delete(oldKey); break; }
      }
      if (buckets.size >= Math.max(1000, Number(maxBuckets) || 20_000)) buckets.delete(buckets.keys().next().value);
    }
    let bucket = buckets.get(key);
    if (!bucket || bucket.reset <= now) bucket = {count: 0, reset: now + windowMs};
    bucket.count += 1;
    buckets.set(key, bucket);
    res.setHeader('RateLimit-Limit', String(max));
    res.setHeader('RateLimit-Remaining', String(Math.max(0, max - bucket.count)));
    res.setHeader('RateLimit-Reset', String(Math.ceil(bucket.reset / 1000)));
    if (bucket.count > max) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil((bucket.reset - now) / 1000))));
      return res.status(429).json({error: 'Muitas solicitações. Tente novamente em instantes.'});
    }
    next();
  };
}
