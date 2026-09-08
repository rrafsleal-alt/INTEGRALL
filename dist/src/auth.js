import {createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';

const scrypt = promisify(scryptCallback);
const COOKIE_NAME = 'integrall_admin_session';
const DEFAULT_SESSION_HOURS = 8;
const PASSWORD_MIN_LENGTH = 10;
const PASSWORD_MAX_LENGTH = 256;

export const ADMIN_ROLES = Object.freeze({
  admin: Object.freeze(['*']),
  editor: Object.freeze(['catalog:read', 'catalog:write', 'media:read', 'media:write', 'orders:read']),
  operator: Object.freeze(['catalog:read', 'orders:read', 'orders:write', 'customers:read'])
});

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

function safeEqualText(left, right) {
  const a = Buffer.from(String(left ?? ''));
  const b = Buffer.from(String(right ?? ''));
  return a.length === b.length && timingSafeEqual(a, b);
}

function parseCookies(header) {
  const result = new Map();
  const source = String(header || '').slice(0, 16_384);
  for (const pair of source.split(';')) {
    const index = pair.indexOf('=');
    if (index <= 0) continue;
    const key = pair.slice(0, index).trim();
    const value = pair.slice(index + 1).trim();
    if (key && !result.has(key)) result.set(key, value);
  }
  return result;
}

function serializeCookie(name, value, {maxAge = 0, secure = false, sameSite = 'Strict'} = {}) {
  const parts = [`${name}=${value}`, 'Path=/', 'HttpOnly', `SameSite=${sameSite}`];
  if (secure) parts.push('Secure');
  if (maxAge > 0) parts.push(`Max-Age=${Math.floor(maxAge)}`);
  else if (maxAge === 0) parts.push('Max-Age=0', 'Expires=Thu, 01 Jan 1970 00:00:00 GMT');
  return parts.join('; ');
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase().slice(0, 254);
}

function validRole(value) {
  const role = String(value || '').trim().toLowerCase();
  return Object.hasOwn(ADMIN_ROLES, role) ? role : '';
}

function validateScryptParameters(cost, blockSize, parallelization) {
  return Number.isInteger(cost) && cost >= 4096 && cost <= 131072 && (cost & (cost - 1)) === 0
    && Number.isInteger(blockSize) && blockSize >= 8 && blockSize <= 32
    && Number.isInteger(parallelization) && parallelization >= 1 && parallelization <= 4;
}

export async function hashPassword(password, {cost = 32768, blockSize = 8, parallelization = 1, salt = randomBytes(16)} = {}) {
  const text = String(password || '');
  if (text.length < PASSWORD_MIN_LENGTH || text.length > PASSWORD_MAX_LENGTH) {
    throw new Error(`A senha administrativa deve ter entre ${PASSWORD_MIN_LENGTH} e 256 caracteres.`);
  }
  if (!validateScryptParameters(cost, blockSize, parallelization)) throw new Error('Parâmetros scrypt inválidos.');
  const saltBuffer = Buffer.isBuffer(salt) ? salt : Buffer.from(salt);
  if (saltBuffer.length < 16 || saltBuffer.length > 64) throw new Error('Salt scrypt inválido.');
  const maxmem = Math.max(64 * 1024 * 1024, 256 * cost * blockSize);
  const digest = await scrypt(text, saltBuffer, 64, {N: cost, r: blockSize, p: parallelization, maxmem});
  return `scrypt$${cost}$${blockSize}$${parallelization}$${saltBuffer.toString('base64url')}$${Buffer.from(digest).toString('base64url')}`;
}

export async function verifyPassword(password, encoded) {
  const text = String(password || '');
  if (!text || text.length > PASSWORD_MAX_LENGTH) return false;
  const parts = String(encoded || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const cost = Number(parts[1]);
  const blockSize = Number(parts[2]);
  const parallelization = Number(parts[3]);
  if (!validateScryptParameters(cost, blockSize, parallelization)) return false;
  let salt;
  let expected;
  try {
    salt = Buffer.from(parts[4], 'base64url');
    expected = Buffer.from(parts[5], 'base64url');
  } catch {
    return false;
  }
  if (salt.length < 16 || salt.length > 64 || expected.length !== 64) return false;
  const maxmem = Math.max(64 * 1024 * 1024, 256 * cost * blockSize);
  const actual = Buffer.from(await scrypt(text, salt, expected.length, {N: cost, r: blockSize, p: parallelization, maxmem}));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function hasPermission(role, permission) {
  const grants = ADMIN_ROLES[validRole(role)] || [];
  return grants.includes('*') || grants.includes(permission);
}

export class AdminAuth {
  constructor({email = '', passwordHash = '', role = 'admin', sessionSecret = '', sessionHours = DEFAULT_SESSION_HOURS, secureCookies = false, publicUrl = '', sessionStore = null} = {}) {
    this.email = normalizeEmail(email);
    this.passwordHash = String(passwordHash || '').trim();
    this.role = validRole(role);
    this.sessionSecret = String(sessionSecret || '');
    this.sessionHours = Math.max(1, Math.min(24, Number(sessionHours) || DEFAULT_SESSION_HOURS));
    this.secureCookies = Boolean(secureCookies);
    this.sessionStore = sessionStore;
    this.publicOrigin = '';
    try { this.publicOrigin = publicUrl ? new URL(publicUrl).origin : ''; } catch { this.publicOrigin = ''; }
  }

  get configured() {
    return Boolean(this.email && this.passwordHash && Object.hasOwn(ADMIN_ROLES, this.role) && this.sessionSecret.length >= 32);
  }

  async authenticate(email, password) {
    if (!this.configured) return null;
    // O e-mail não é tratado como segredo: quando fica em branco, usa a conta
    // administrativa configurada. Assim o acesso padrão depende apenas da senha.
    const normalized = normalizeEmail(email) || this.email;
    const emailMatches = safeEqualText(normalized, this.email);
    const passwordMatches = await verifyPassword(password, this.passwordHash).catch(() => false);
    return emailMatches && passwordMatches ? {email: this.email, role: this.role} : null;
  }

  credentialVersion() {
    return createHmac('sha256', this.sessionSecret).update(JSON.stringify([this.email, this.role, this.passwordHash])).digest('base64url');
  }

  signPayload(payload) {
    const body = base64url(JSON.stringify(payload));
    const signature = createHmac('sha256', this.sessionSecret).update(body).digest('base64url');
    return `${body}.${signature}`;
  }

  verifyToken(token) {
    const text = String(token || '');
    const index = text.lastIndexOf('.');
    if (index <= 0 || text.length > 4096) return null;
    const body = text.slice(0, index);
    const signature = text.slice(index + 1);
    const expected = createHmac('sha256', this.sessionSecret).update(body).digest('base64url');
    if (!safeEqualText(signature, expected)) return null;
    let payload;
    try { payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { return null; }
    if (!payload || payload.v !== 2 || payload.sub !== this.email || payload.role !== this.role || !Object.hasOwn(ADMIN_ROLES, payload.role)) return null;
    if (!safeEqualText(payload.credentialVersion, this.credentialVersion())) return null;
    if (!Number.isInteger(payload.iat) || payload.iat > Math.floor(Date.now() / 1000) + 30 || payload.iat < 0) return null;
    if (!/^[A-Za-z0-9_-]{20,64}$/.test(String(payload.jti || ''))) return null;
    if (!Number.isInteger(payload.exp) || payload.exp <= payload.iat || payload.exp - payload.iat > 24 * 60 * 60 || payload.exp <= Math.floor(Date.now() / 1000)) return null;
    if (!/^[A-Za-z0-9_-]{20,}$/.test(String(payload.csrf || ''))) return null;
    return payload;
  }

  async createSession(user) {
    if (!this.configured || user?.email !== this.email || user?.role !== this.role) throw new Error('Usuário administrativo inválido.');
    const issuedAt = Math.floor(Date.now() / 1000);
    const maxAge = Math.floor(this.sessionHours * 60 * 60);
    const payload = {
      v: 2,
      credentialVersion: this.credentialVersion(),
      sub: user.email,
      role: validRole(user.role),
      iat: issuedAt,
      exp: issuedAt + maxAge,
      csrf: randomBytes(24).toString('base64url'),
      jti: randomBytes(16).toString('base64url')
    };
    const token = this.signPayload(payload);
    if (typeof this.sessionStore?.saveAdminSession === 'function') {
      await this.sessionStore.saveAdminSession({
        jti: payload.jti,
        email: payload.sub,
        role: payload.role,
        expiresAt: new Date(payload.exp * 1000).toISOString()
      });
    }
    return {
      payload,
      cookie: serializeCookie(COOKIE_NAME, token, {maxAge, secure: this.secureCookies}),
      expiresAt: new Date(payload.exp * 1000).toISOString()
    };
  }

  clearCookie() {
    return serializeCookie(COOKIE_NAME, '', {maxAge: 0, secure: this.secureCookies});
  }

  async readSession(req) {
    if (!this.configured) return null;
    const token = parseCookies(req.headers.cookie).get(COOKIE_NAME);
    const payload = this.verifyToken(token);
    if (!payload || typeof this.sessionStore?.getAdminSession !== 'function') return payload;
    const stored = await this.sessionStore.getAdminSession(payload.jti);
    if (!stored) return null;
    const expiresAt = Date.parse(stored.expiresAt);
    const matches = safeEqualText(stored.email, payload.sub)
      && safeEqualText(stored.role, payload.role)
      && Number.isFinite(expiresAt)
      && expiresAt > Date.now();
    if (!matches) {
      await this.sessionStore.deleteAdminSession?.(payload.jti).catch?.(() => {});
      return null;
    }
    return payload;
  }

  async revokeSession(session) {
    if (!session?.jti || typeof this.sessionStore?.deleteAdminSession !== 'function') return false;
    return this.sessionStore.deleteAdminSession(session.jti);
  }

  sameOrigin(req) {
    const fetchSite = String(req.headers['sec-fetch-site'] || '').toLowerCase();
    if (fetchSite === 'cross-site') return false;
    const origin = String(req.headers.origin || '').trim();
    if (!origin) return true; // curl/server-to-server; CSRF token ainda é obrigatório.
    const requestOrigin = `${req.protocol}://${req.get('host')}`;
    return origin === requestOrigin || (this.publicOrigin && origin === this.publicOrigin);
  }

  async authorizeRequest(req, res, {csrf = true} = {}) {
    res.setHeader('Cache-Control', 'no-store');
    if (!this.configured) {
      res.status(503).json({code: 'ADMIN_NOT_CONFIGURED', error: 'A administração segura ainda não foi configurada.'});
      return null;
    }
    const session = await this.readSession(req);
    if (!session) {
      res.status(401).json({code: 'ADMIN_AUTH_REQUIRED', error: 'Faça login para continuar.'});
      return null;
    }
    const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    if (csrf && unsafe) {
      const token = String(req.headers['x-csrf-token'] || '');
      if (!this.sameOrigin(req) || !safeEqualText(token, session.csrf)) {
        res.status(403).json({code: 'ADMIN_CSRF_INVALID', error: 'A sessão de segurança expirou. Atualize a página e tente novamente.'});
        return null;
      }
    }
    return session;
  }

  requireSession(options = {}) {
    return async (req, res, next) => {
      try {
        const session = await this.authorizeRequest(req, res, options);
        if (!session) return;
        req.admin = Object.freeze({email: session.sub, role: session.role, csrf: session.csrf, jti: session.jti, exp: session.exp});
        next();
      } catch (error) {
        next(error);
      }
    };
  }

  requirePermission(permission, options = {}) {
    return async (req, res, next) => {
      try {
        const session = await this.authorizeRequest(req, res, options);
        if (!session) return;
        if (!hasPermission(session.role, permission)) {
          return res.status(403).json({code: 'ADMIN_FORBIDDEN', error: 'Seu perfil não possui permissão para esta ação.'});
        }
        req.admin = Object.freeze({email: session.sub, role: session.role, csrf: session.csrf, jti: session.jti, exp: session.exp});
        next();
      } catch (error) {
        next(error);
      }
    };
  }
}

export const adminCookieName = COOKIE_NAME;
