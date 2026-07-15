const crypto = require('node:crypto');

async function handleAuthCredentialRoute(context) {
  const {
    req, res, segments, db, state, readJson, cleanEmail, authRateAllowed, sendJson,
    makeId, hashToken, queueEmailJob, audit, saveDb, hashPassword,
    createEmailVerificationToken, publicUser
  } = context;
  if (segments[0] !== 'auth' || !['password-reset', 'email-verification'].includes(segments[1])) return false;
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: { code: 'method_not_allowed', message: 'Authentication credential routes require POST.' } });
    return true;
  }

  if (segments[1] === 'password-reset' && segments[2] === 'request') {
    const body = await readJson(req);
    const email = cleanEmail(body.email);
    const rateKey = `${req.socket.remoteAddress || 'unknown'}:${email}`;
    if (!authRateAllowed(rateKey)) {
      sendJson(res, 429, { error: { code: 'rate_limited', message: 'Too many attempts. Try again later.' } });
      return true;
    }
    const user = db.users.find((item) => item.email === email);
    if (user) {
      const token = `fo_reset_${crypto.randomBytes(24).toString('hex')}`;
      db.passwordResetTokens = db.passwordResetTokens.filter((item) => item.userId !== user.id || item.usedAt);
      const reset = {
        id: makeId('rst'), userId: user.id, tokenHash: hashToken(token), tokenPreview: `${token.slice(0, 12)}...`,
        expiresAt: new Date(Date.now() + 1000 * 60 * 30).toISOString(), usedAt: null, createdAt: new Date().toISOString()
      };
      db.passwordResetTokens.push(reset);
      queueEmailJob(db, null, {
        to: user.email, subject: 'Reset your FeedbackOS password', body: `Use reset token ${token}. It expires in 30 minutes.`
      }, { resetId: reset.id });
      db.auditLogs.push(audit(null, user.id, 'auth.password_reset_requested', 'user', user.id, {}));
    }
    await saveDb(state);
    sendJson(res, 200, { ok: true });
    return true;
  }

  if (segments[1] === 'password-reset' && segments[2] === 'confirm') {
    const body = await readJson(req);
    const reset = db.passwordResetTokens.find((item) => !item.usedAt && item.tokenHash === hashToken(body.token || ''));
    const password = String(body.password || '');
    if (!reset || new Date(reset.expiresAt).getTime() < Date.now()) {
      sendJson(res, 400, { error: { code: 'invalid_reset_token', message: 'Reset token is invalid or expired.' } });
      return true;
    }
    if (password.length < 8) {
      sendJson(res, 400, { error: { code: 'weak_password', message: 'Password must be at least 8 characters.' } });
      return true;
    }
    const user = db.users.find((item) => item.id === reset.userId);
    if (!user) {
      sendJson(res, 404, { error: { code: 'user_not_found', message: 'User not found.' } });
      return true;
    }
    user.password = hashPassword(password);
    user.updatedAt = new Date().toISOString();
    reset.usedAt = user.updatedAt;
    db.sessions = db.sessions.filter((session) => session.userId !== user.id);
    db.auditLogs.push(audit(null, user.id, 'auth.password_reset_completed', 'user', user.id, {}));
    await saveDb(state);
    sendJson(res, 200, { ok: true });
    return true;
  }

  if (segments[1] === 'email-verification' && segments[2] === 'request') {
    const body = await readJson(req);
    const user = db.users.find((item) => item.email === cleanEmail(body.email));
    if (user && !user.emailVerifiedAt) {
      createEmailVerificationToken(db, user);
      db.auditLogs.push(audit(null, user.id, 'auth.email_verification_requested', 'user', user.id, {}));
    }
    await saveDb(state);
    sendJson(res, 200, { ok: true });
    return true;
  }

  if (segments[1] === 'email-verification' && segments[2] === 'confirm') {
    const body = await readJson(req);
    const verification = db.emailVerificationTokens.find((item) => !item.usedAt && item.tokenHash === hashToken(body.token || ''));
    if (!verification || new Date(verification.expiresAt).getTime() < Date.now()) {
      sendJson(res, 400, { error: { code: 'invalid_email_verification_token', message: 'Email verification token is invalid or expired.' } });
      return true;
    }
    const user = db.users.find((item) => item.id === verification.userId);
    if (!user) {
      sendJson(res, 404, { error: { code: 'user_not_found', message: 'User not found.' } });
      return true;
    }
    user.emailVerifiedAt = new Date().toISOString();
    user.updatedAt = user.emailVerifiedAt;
    verification.usedAt = user.emailVerifiedAt;
    db.auditLogs.push(audit(null, user.id, 'auth.email_verified', 'user', user.id, {}));
    await saveDb(state);
    sendJson(res, 200, { ok: true, user: publicUser(user) });
    return true;
  }

  sendJson(res, 404, { error: { code: 'not_found', message: 'Credential route not found.' } });
  return true;
}

module.exports = { handleAuthCredentialRoute };
