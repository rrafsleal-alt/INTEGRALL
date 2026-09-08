import {AdminAuth} from '../src/auth.js';

for (const key of [
  'ADMIN_EMAIL',
  'ADMIN_PASSWORD_HASH',
  'ADMIN_DEFAULT_LOGIN_ENABLED',
  'ADMIN_ROLE',
  'ADMIN_SESSION_SECRET'
]) delete process.env[key];

const {config} = await import(`../src/config.js?default-admin-check=${Date.now()}`);
const auth = new AdminAuth({
  email: config.adminEmail,
  passwordHash: config.adminPasswordHash,
  role: config.adminRole,
  sessionSecret: config.adminSessionSecret,
  sessionHours: config.adminSessionHours,
  secureCookies: false,
  publicUrl: config.publicUrl
});

const initialPassword = ['159213', 'Rafs'].join('');
const user = await auth.authenticate('', initialPassword);
if (!user) {
  console.error('FALHA: a credencial administrativa inicial nao autenticou com e-mail em branco.');
  process.exitCode = 1;
} else {
  console.log(`OK: senha padrao validada para ${user.email}; e-mail pode ficar em branco.`);
}
