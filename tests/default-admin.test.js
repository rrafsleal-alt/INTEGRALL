import test from 'node:test';
import assert from 'node:assert/strict';
import {AdminAuth, hashPassword} from '../src/auth.js';

const INITIAL_PASSWORD = ['159213', 'Rafs'].join('');
const ADMIN_ENV_KEYS = [
  'NODE_ENV',
  'DATABASE_URL',
  'DATABASE_SSL_MODE',
  'PUBLIC_URL',
  'ADMIN_EMAIL',
  'ADMIN_PASSWORD_HASH',
  'ADMIN_DEFAULT_LOGIN_ENABLED',
  'ADMIN_ROLE',
  'ADMIN_SESSION_SECRET'
];

async function withAdminEnv(values, callback) {
  const previous = new Map(ADMIN_ENV_KEYS.map(key => [key, process.env[key]]));
  try {
    for (const key of ADMIN_ENV_KEYS) delete process.env[key];
    for (const [key, value] of Object.entries(values || {})) {
      if (value != null) process.env[key] = String(value);
    }
    return await callback();
  } finally {
    for (const [key, value] of previous) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function authFromConfig(config) {
  return new AdminAuth({
    email: config.adminEmail,
    passwordHash: config.adminPasswordHash,
    role: config.adminRole,
    sessionSecret: config.adminSessionSecret
  });
}

test('credencial administrativa inicial autentica com e-mail em branco e diferencia maiúsculas', async () => {
  await withAdminEnv({}, async () => {
    const {config} = await import(`../src/config.js?default-admin=${Date.now()}-${Math.random()}`);
    const auth = authFromConfig(config);

    assert.equal(auth.configured, true);
    assert.equal(config.adminUsesBuiltInPasswordHash, true);
    assert.deepEqual(await auth.authenticate('', INITIAL_PASSWORD), {email: 'admin@integrall.local', role: 'admin'});
    assert.equal(await auth.authenticate('', INITIAL_PASSWORD.toLowerCase()), null);
    assert.equal(await auth.authenticate('', 'senha-incorreta'), null);
  });
});

test('modo personalizado explícito substitui integralmente a credencial inicial', async () => {
  const customPassword = 'Nova-Senha-Administrativa-2026!';
  const customHash = await hashPassword(customPassword, {cost: 4096, salt: Buffer.alloc(16, 12)});

  await withAdminEnv({
    ADMIN_EMAIL: 'responsavel@example.com',
    ADMIN_PASSWORD_HASH: customHash,
    ADMIN_DEFAULT_LOGIN_ENABLED: 'false',
    ADMIN_ROLE: 'admin',
    ADMIN_SESSION_SECRET: 's'.repeat(64)
  }, async () => {
    const {config} = await import(`../src/config.js?custom-admin=${Date.now()}-${Math.random()}`);
    const auth = authFromConfig(config);

    assert.equal(config.adminUsesBuiltInPasswordHash, false);
    assert.deepEqual(await auth.authenticate('', customPassword), {email: 'responsavel@example.com', role: 'admin'});
    assert.equal(await auth.authenticate('', INITIAL_PASSWORD), null);
  });
});

test('produção exige hash próprio e segredo de sessão persistente', async () => {
  const base = {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://example.invalid/integrall',
    DATABASE_SSL_MODE: 'verify-full',
    PUBLIC_URL: 'https://integrall.example',
    ADMIN_DEFAULT_LOGIN_ENABLED: 'true'
  };

  await withAdminEnv(base, async () => {
    const module = await import(`../src/config.js?prod-missing-secret=${Date.now()}-${Math.random()}`);
    assert.throws(() => module.assertProductionConfig(), /ADMIN_PASSWORD_HASH|ADMIN_SESSION_SECRET/);
  });

  await withAdminEnv({...base, ADMIN_SESSION_SECRET: 'p'.repeat(64)}, async () => {
    const module = await import(`../src/config.js?prod-built-in-password=${Date.now()}-${Math.random()}`);
    assert.throws(() => module.assertProductionConfig(), /ADMIN_PASSWORD_HASH/);
  });

  const productionPassword = 'Senha-De-Producao-2026!';
  const productionHash = await hashPassword(productionPassword, {cost: 4096, salt: Buffer.alloc(16, 14)});
  await withAdminEnv({
    ...base,
    ADMIN_DEFAULT_LOGIN_ENABLED: 'false',
    ADMIN_PASSWORD_HASH: productionHash,
    ADMIN_SESSION_SECRET: 'p'.repeat(64)
  }, async () => {
    const module = await import(`../src/config.js?prod-valid=${Date.now()}-${Math.random()}`);
    assert.doesNotThrow(() => module.assertProductionConfig());
  });
});

// Regressão do conflito relatado: modo padrão explícito nunca consulta hash legado.
test('modo padrão recusa hash legado configurado e aceita somente a credencial inicial', async () => {
  const legacyPassword = 'Credencial-Legada-De-Teste-2026!';
  const legacyHash = await hashPassword(legacyPassword, {cost:4096,salt:Buffer.alloc(16,31)});
  await withAdminEnv({ADMIN_PASSWORD_HASH:legacyHash,ADMIN_DEFAULT_LOGIN_ENABLED:'true'}, async () => {
    const {config,configWarnings} = await import(`../src/config.js?mode-conflict=${Date.now()}`);
    const auth = authFromConfig(config);
    assert.equal(config.adminUsesBuiltInPasswordHash,true);
    assert.ok(await auth.authenticate('',INITIAL_PASSWORD));
    assert.equal(await auth.authenticate('',legacyPassword),null);
    assert.ok(configWarnings().some(message=>message.includes('hash personalizado está inativo')));
  });
});
