import {timingSafeEqual} from 'node:crypto';

export function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
  if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
}

export function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  return left.length === right.length && timingSafeEqual(left, right);
}

export function adminAuth(expectedToken) {
  return (req, res, next) => {
    if (!expectedToken) return res.status(503).json({error: 'Área administrativa não configurada.'});
    const auth = String(req.headers.authorization || '');
    const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    // Aceita também o cabeçalho X-Admin-Token: alguns proxies/túneis de preview
    // consomem ou removem o cabeçalho Authorization padrão no caminho.
    const custom = String(req.headers['x-admin-token'] || '');
    const token = bearer || custom;
    if (!safeEqual(token, expectedToken)) {
      if (process.env.ADMIN_AUTH_DEBUG === 'true') {
        // Diagnóstico SEM vazar o conteúdo: um token quase-correto nos logs
        // seria praticamente a senha. Registra apenas tamanho e categorias.
        const text = String(token);
        const nonAscii = [...text].filter((ch) => ch.codePointAt(0) > 126 || ch.codePointAt(0) < 32).length;
        const spaces = (text.match(/\s/g) || []).length;
        console.warn(`[admin-auth] token recusado: ${text.length} caracteres (esperado ${expectedToken.length}); nãoASCII=${nonAscii}; espaços=${spaces}; viaBearer=${Boolean(bearer)}; viaXAdminToken=${Boolean(custom)}`);
      }
      return res.status(401).json({error: 'Não autorizado.'});
    }
    res.setHeader('Cache-Control', 'no-store');
    next();
  };
}

export function rateLimit({windowMs = 60_000, max = 60} = {}) {
  const buckets = new Map();
  let lastSweep = Date.now();
  return (req, res, next) => {
    const now = Date.now();
    if (now - lastSweep > windowMs * 2) {
      for (const [key, value] of buckets) if (value.reset <= now) buckets.delete(key);
      lastSweep = now;
    }
    const key = req.ip || req.socket?.remoteAddress || 'unknown';
    let bucket = buckets.get(key);
    if (!bucket || bucket.reset <= now) bucket = {count: 0, reset: now + windowMs};
    bucket.count += 1;
    buckets.set(key, bucket);
    res.setHeader('RateLimit-Limit', String(max));
    res.setHeader('RateLimit-Remaining', String(Math.max(0, max - bucket.count)));
    if (bucket.count > max) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil((bucket.reset - now) / 1000))));
      return res.status(429).json({error: 'Muitas solicitações. Tente novamente em instantes.'});
    }
    next();
  };
}
