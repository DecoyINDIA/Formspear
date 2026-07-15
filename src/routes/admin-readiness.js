function handleAdminReadinessRoute(context) {
  const { req, res, segments, db, state, buildReadinessReport, sendJson } = context;
  if (segments[0] !== 'readiness') return false;
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: { code: 'method_not_allowed', message: 'Use GET for production readiness.' } });
    return true;
  }
  sendJson(res, 200, buildReadinessReport(db, state));
  return true;
}

module.exports = { handleAdminReadinessRoute };
