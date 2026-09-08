import {createHash, createHmac, randomBytes, randomInt, timingSafeEqual} from 'node:crypto';

const COOKIE = 'integrall_customer_session';
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const hash = value => createHash('sha256').update(String(value || '')).digest('hex');

function loginCodeHash(secret, email, code) {
  return `hmac-sha256$${createHmac('sha256', secret)
    .update('integrall-customer-login-code\0')
    .update(String(email || ''))
    .update('\0')
    .update(String(code || ''))
    .digest('hex')}`;
}

function cookieValue(req, name) {
  const raw = String(req.headers?.cookie || '');
  for (const part of raw.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) {
      try { return decodeURIComponent(rest.join('=')); } catch { return ''; }
    }
  }
  return '';
}

function equal(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  return left.length === right.length && timingSafeEqual(left, right);
}

export class CustomerAuth {
  constructor({repository, secureCookies = false, sessionDays = 30, codeMinutes = 10, codeSecret = '', publicUrl = ''}) {
    this.repository = repository;
    this.secureCookies = Boolean(secureCookies);
    this.sessionDays = Math.max(1, Math.min(90, Number(sessionDays) || 30));
    this.codeMinutes = Math.max(5, Math.min(30, Number(codeMinutes) || 10));
    this.codeSecret = String(codeSecret || '');
    if (this.codeSecret.length < 32) throw new Error('CUSTOMER_AUTH_SECRET precisa ter pelo menos 32 caracteres.');
    this.publicOrigin = '';
    try { this.publicOrigin = publicUrl ? new URL(publicUrl).origin : ''; } catch { this.publicOrigin = ''; }
  }

  normalizeEmail(value) {
    const email = String(value || '').trim().toLowerCase();
    return email.length <= 254 && emailPattern.test(email) ? email : '';
  }

  async createLoginCode(email) {
    const normalized = this.normalizeEmail(email);
    if (!normalized) throw Object.assign(new Error('Informe um e-mail válido.'), {status: 400, code: 'ACCOUNT_EMAIL_INVALID'});
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const expiresAt = new Date(Date.now() + this.codeMinutes * 60_000).toISOString();
    await this.repository.saveCustomerLoginCode({email: normalized, codeHash: loginCodeHash(this.codeSecret, normalized, code), expiresAt});
    return {email: normalized, code, expiresAt};
  }

  async verifyLoginCode(email, code) {
    const normalized = this.normalizeEmail(email);
    const safeCode = String(code ?? '').trim();
    // Never turn malformed input into a different, valid one-time code.
    if (!normalized || !/^[0-9]{6}$/.test(safeCode)) return null;
    const consumed = await this.repository.consumeCustomerLoginCode(
      normalized,
      loginCodeHash(this.codeSecret, normalized, safeCode)
    );
    if (!consumed) return null;
    const account = await this.repository.ensureCustomerAccount(normalized);
    const token = randomBytes(32).toString('base64url');
    const csrfToken = randomBytes(24).toString('base64url');
    const expiresAt = new Date(Date.now() + this.sessionDays * 86_400_000).toISOString();
    await this.repository.saveCustomerSession({tokenHash: hash(token), email: normalized, csrfToken, expiresAt});
    return {token, csrfToken, expiresAt, account};
  }

  cookie(token, expiresAt) {
    const parts = [`${COOKIE}=${encodeURIComponent(token)}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', `Expires=${new Date(expiresAt).toUTCString()}`];
    if (this.secureCookies) parts.push('Secure');
    return parts.join('; ');
  }

  clearCookie() {
    return `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${this.secureCookies ? '; Secure' : ''}`;
  }

  async readSession(req) {
    const token = cookieValue(req, COOKIE);
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const session = await this.repository.getCustomerSession(hash(token));
    const expiresAt = Date.parse(session?.expiresAt);
    if (!session || !Number.isFinite(expiresAt) || expiresAt <= Date.now()
      || !this.normalizeEmail(session.email) || !session.csrfToken) {
      if (session) await this.repository.deleteCustomerSession(hash(token)).catch(() => {});
      return null;
    }
    return {...session, tokenHash: hash(token)};
  }

  sameOrigin(req) {
    const fetchSite = String(req.headers?.['sec-fetch-site'] || '').toLowerCase();
    if (fetchSite === 'cross-site') return false;
    const origin = String(req.headers?.origin || '').trim();
    if (!origin) return true; // Clientes não-navegador ainda precisam do token CSRF.
    const host = typeof req.get === 'function' ? req.get('host') : req.headers?.host;
    const requestOrigin = host && req.protocol ? `${req.protocol}://${host}` : '';
    return origin === requestOrigin || Boolean(this.publicOrigin && origin === this.publicOrigin);
  }

  requireSession() {
    return async (req, res, next) => {
      res.setHeader?.('Cache-Control', 'no-store');
      const session = await this.readSession(req);
      if (!session) return res.status(401).json({code: 'ACCOUNT_AUTH_REQUIRED', error: 'Entre na sua conta para continuar.'});
      req.customerSession = session;
      next();
    };
  }

  requireCsrf() {
    return async (req, res, next) => {
      res.setHeader?.('Cache-Control', 'no-store');
      const session = req.customerSession || await this.readSession(req);
      if (!session) return res.status(401).json({code: 'ACCOUNT_AUTH_REQUIRED', error: 'Entre na sua conta para continuar.'});
      const supplied = String(req.headers['x-customer-csrf'] || '');
      if (!this.sameOrigin(req) || !supplied || !equal(supplied, session.csrfToken)) return res.status(403).json({code: 'ACCOUNT_CSRF_INVALID', error: 'Sessão inválida. Atualize a página e tente novamente.'});
      req.customerSession = session;
      next();
    };
  }
}
