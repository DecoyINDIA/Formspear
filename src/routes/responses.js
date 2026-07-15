async function handleResponsesRoute(context) {
  const {
    req, res, url, segments, db, state, user, survey,
    filterResponses, requireWorkspacePermission, requireSurveyAccess, buildResponsePdf,
    audit, saveDb, withSecurityHeaders, slugify, sendJson, buildResponseDetail, readJson, updateResponseRecord
  } = context;
  if (segments[1] !== 'responses') return false;

  if (segments.length === 2 && req.method === 'GET') {
    const result = filterResponses(db.responses.filter((item) => item.surveyId === survey.id && item.status !== 'deleted'), url, survey);
    sendJson(res, 200, result);
    return true;
  }

  const responseId = segments[2];
  if (!responseId) {
    sendJson(res, 405, { error: { code: 'method_not_allowed', message: 'Use GET to list survey responses.' } });
    return true;
  }

  if (segments[3] === 'export.pdf' && req.method === 'GET') {
    if (!requireWorkspacePermission(res, db, user, survey.workspaceId, 'responseExport')) return true;
    const response = db.responses.find((item) => item.id === responseId && item.surveyId === survey.id);
    if (!response || response.status === 'deleted') {
      sendJson(res, 404, { error: { code: 'response_not_found', message: 'Response not found.' } });
      return true;
    }
    const pdf = buildResponsePdf(db, survey, response);
    db.auditLogs.push(audit(survey.workspaceId, user.id, 'response.exported_pdf', 'response', response.id, {}));
    await saveDb(state);
    res.writeHead(200, withSecurityHeaders({
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="${slugify(survey.title)}-${response.id}.pdf"`
    }));
    res.end(pdf);
    return true;
  }

  const response = db.responses.find((item) => item.id === responseId && item.surveyId === survey.id);
  if (!response || response.status === 'deleted') {
    sendJson(res, 404, { error: { code: 'response_not_found', message: 'Response not found.' } });
    return true;
  }

  if (req.method === 'GET') {
    sendJson(res, 200, { response: buildResponseDetail(db, survey, response) });
    return true;
  }

  if (req.method === 'PATCH') {
    if (!requireSurveyAccess(res, db, user, survey, 'analyst')) return true;
    const body = await readJson(req);
    updateResponseRecord(response, body, user.id);
    db.auditLogs.push(audit(survey.workspaceId, user.id, 'response.updated', 'response', response.id, { fields: Object.keys(body) }));
    await saveDb(state);
    sendJson(res, 200, { response: buildResponseDetail(db, survey, response) });
    return true;
  }

  if (req.method === 'DELETE') {
    if (!requireSurveyAccess(res, db, user, survey, 'analyst')) return true;
    response.status = 'deleted';
    response.deletedAt = new Date().toISOString();
    db.auditLogs.push(audit(survey.workspaceId, user.id, 'response.deleted', 'response', response.id, {}));
    await saveDb(state);
    sendJson(res, 200, { ok: true });
    return true;
  }

  sendJson(res, 405, { error: { code: 'method_not_allowed', message: 'Use GET, PATCH, or DELETE for a response.' } });
  return true;
}

module.exports = { handleResponsesRoute };
