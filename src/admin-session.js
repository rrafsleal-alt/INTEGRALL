import {cleanText} from './catalog.js';

/** Shared production controllers. Express retains its existing body parsers,
 * rate limits, session middleware and error handling in server.js. */
export function createAdminSessionHandlers({adminAuth, auditAdmin}) {
  if (!adminAuth || typeof auditAdmin !== 'function') throw new TypeError('Dependências de sessão administrativa inválidas.');
  const noCache = res => {res.setHeader('Cache-Control', 'no-store');res.setHeader('Vary', 'Cookie');};
  return {
    async read(req, res) {
      noCache(res);
      const session = await adminAuth.readSession(req);
      if (!session) return res.json({configured: adminAuth.configured, authenticated: false});
      return res.json({configured:true,authenticated:true,user:{email:session.sub,role:session.role},csrfToken:session.csrf,expiresAt:new Date(session.exp*1000).toISOString()});
    },
    async login(req, res) {
      noCache(res);
      if (!adminAuth.configured) return res.status(503).json({code:'ADMIN_NOT_CONFIGURED',error:'A administração segura ainda não foi configurada.'});
      if (!adminAuth.sameOrigin(req)) return res.status(403).json({code:'ADMIN_ORIGIN_INVALID',error:'Origem de acesso não permitida.'});
      const email = cleanText(req.body?.email,254).toLowerCase();
      const password = String(req.body?.password || '');
      const user = await adminAuth.authenticate(email,password);
      if (!user) {
        await auditAdmin(req,'login_failed','admin_session','',{emailProvided:Boolean(email)});
        return res.status(401).json({code:'ADMIN_LOGIN_INVALID',error:'E-mail ou senha inválidos.'});
      }
      const session = await adminAuth.createSession(user);
      res.setHeader('Set-Cookie',session.cookie);
      await auditAdmin({...req,admin:user},'login_succeeded','admin_session',user.email);
      return res.json({authenticated:true,user,csrfToken:session.payload.csrf,expiresAt:session.expiresAt});
    },
    async logout(req, res) {
      noCache(res);
      await adminAuth.revokeSession(req.admin);
      res.setHeader('Set-Cookie',adminAuth.clearCookie());
      await auditAdmin(req,'logout','admin_session',req.admin.email);
      return res.json({ok:true});
    }
  };
}
