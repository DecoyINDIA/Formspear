const crypto = require('node:crypto');
const util = require('node:util');

const scryptAsync = util.promisify(crypto.scrypt);

const SECURITY_HEADERS = Object.freeze({
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'SAMEORIGIN',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'"
});

function withSecurityHeaders(headers = {}) {
  return { ...SECURITY_HEADERS, ...headers };
}

function embeddableSecurityHeaders(headers = {}) {
  const base = { ...SECURITY_HEADERS };
  delete base['x-frame-options'];
  base['content-security-policy'] = base['content-security-policy'].replace("frame-ancestors 'self'", 'frame-ancestors *');
  return { ...base, ...headers };
}

function encryptionKey(env = process.env) {
  const raw = env.ENCRYPTION_KEY;
  if ((!raw || raw === 'replace-with-32-byte-secret') && env.NODE_ENV === 'production') {
    throw new Error('ENCRYPTION_KEY must be set to a strong secret in production.');
  }
  return crypto.createHash('sha256').update(raw || 'formspear-local-dev-key').digest();
}

function encryptConfig(config, env = process.env) {
  const key = encryptionKey(env);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(config), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

function decryptConfig(encrypted, env = process.env) {
  if (!encrypted) return {};
  try {
    const [ivHex, tagHex, encryptedHex] = String(encrypted).split(':');
    if (!ivHex || !tagHex || !encryptedHex) return {};
    const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(env), Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(encryptedHex, 'hex')), decipher.final()]).toString('utf8'));
  } catch {
    return {};
  }
}

function publicWebhook(webhook) {
  if (!webhook) return webhook;
  const copy = { ...webhook };
  delete copy.secret;
  delete copy.secretEncrypted;
  copy.secret = '[hidden]';
  return copy;
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function signPayload(body, secret, env = process.env) {
  const signingSecret = secret || env.WEBHOOK_SIGNING_SECRET || 'feedbackos-local-webhook-secret';
  return `sha256=${crypto.createHmac('sha256', signingSecret).update(body).digest('hex')}`;
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = await scryptAsync(password, salt, 64);
  return { salt, hash: derivedKey.toString('hex') };
}

async function verifyPassword(password, stored) {
  if (!stored?.salt || !stored?.hash) return false;
  try {
    const actual = await scryptAsync(password, stored.salt, 64);
    const expected = Buffer.from(stored.hash, 'hex');
    return expected.length === actual.length && crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function hashIp(ip, env = process.env) {
  return crypto.createHash('sha256').update(`${ip}:${env.IP_HASH_SALT || 'formspear-local-salt'}`).digest('hex').slice(0, 32);
}

module.exports = {
  SECURITY_HEADERS,
  withSecurityHeaders,
  embeddableSecurityHeaders,
  encryptConfig,
  decryptConfig,
  publicWebhook,
  hashToken,
  signPayload,
  hashPassword,
  verifyPassword,
  hashIp
};
