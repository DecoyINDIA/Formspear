async function handleSurveyLifecycleRoute(context) {
  const {
    req, res, url, segments, db, state, user, readJson, requireWorkspace, surveyVisibleToUser,
    checkPlanLimit, findSurveyTemplate, createSurvey, cleanText, markTemplateUsed, createSurveyVersion,
    audit, saveDb, sendJson, requireSurveyAccess, surveyApprovalFingerprint, applySurveySlug,
    updateSurveyFromBody, markApprovalStaleIfChanged, createCustomTemplateFromSurvey,
    publishSurveyDraft, effectiveSurveyRole, requestSurveyApproval, surveyApprovalPayload,
    validateSurveyForPublish, reviewSurveyApproval, normalizeSurveyAccessMode, normalizeSurveyAccessRules
  } = context;

  if (segments.length === 0) {
    if (req.method === 'GET') {
      const workspaceId = url.searchParams.get('workspaceId');
      if (!requireWorkspace(res, db, user, workspaceId, 'viewer')) return { handled: true };
      const surveys = db.surveys
        .filter((survey) => survey.workspaceId === workspaceId && surveyVisibleToUser(db, user, survey, 'viewer'))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      sendJson(res, 200, { surveys });
      return { handled: true };
    }
    if (req.method === 'POST') {
      const body = await readJson(req);
      const workspaceId = body.workspaceId;
      if (!requireWorkspace(res, db, user, workspaceId, 'editor')) return { handled: true };
      const limitCheck = checkPlanLimit(db, workspaceId, 'surveys');
      if (!limitCheck.ok) {
        sendJson(res, 402, { error: { code: 'plan_limit', message: limitCheck.message } });
        return { handled: true };
      }
      const template = findSurveyTemplate(db, body.templateId, workspaceId);
      const survey = createSurvey({
        workspaceId,
        userId: user.id,
        title: cleanText(body.title || template?.schema.title || 'Untitled Survey', 160),
        description: cleanText(body.description || template?.schema.description || '', 500),
        type: cleanText(body.type || template?.type || 'feedback_form', 60),
        schema: template ? structuredClone(template.schema) : undefined
      });
      db.surveys.push(survey);
      markTemplateUsed(db, template);
      createSurveyVersion(db, survey, user.id);
      db.auditLogs.push(audit(workspaceId, user.id, 'survey.created', 'survey', survey.id, { title: survey.title }));
      await saveDb(state);
      sendJson(res, 201, { survey });
      return { handled: true };
    }
    sendJson(res, 405, { error: { code: 'method_not_allowed', message: 'Use GET or POST for surveys.' } });
    return { handled: true };
  }

  const survey = db.surveys.find((item) => item.id === segments[0]);
  if (!survey) {
    sendJson(res, 404, { error: { code: 'not_found', message: 'Survey not found.' } });
    return { handled: true };
  }
  if (!requireSurveyAccess(res, db, user, survey, 'viewer')) return { handled: true };

  if (segments.length === 1 && req.method === 'GET') {
    sendJson(res, 200, { survey });
    return { handled: true };
  }
  if (segments.length === 1 && req.method === 'PUT') {
    if (!requireSurveyAccess(res, db, user, survey, 'editor')) return { handled: true };
    const body = await readJson(req);
    const beforeApprovalFingerprint = surveyApprovalFingerprint(survey);
    if (body.slug !== undefined) {
      const slugResult = applySurveySlug(db, survey, body.slug);
      if (!slugResult.ok) {
        sendJson(res, 400, { error: { code: 'invalid_slug', message: slugResult.message } });
        return { handled: true };
      }
    }
    const beforePublishedVersion = survey.publishedVersionId;
    updateSurveyFromBody(db, survey, body);
    survey.updatedAt = new Date().toISOString();
    if (survey.status === 'published' && beforePublishedVersion) survey.hasUnpublishedChanges = true;
    markApprovalStaleIfChanged(survey, beforeApprovalFingerprint);
    db.auditLogs.push(audit(survey.workspaceId, user.id, 'survey.updated', 'survey', survey.id, { title: survey.title }));
    await saveDb(state);
    sendJson(res, 200, { survey });
    return { handled: true };
  }
  if (segments.length === 1 && req.method === 'DELETE') {
    if (!requireSurveyAccess(res, db, user, survey, 'admin')) return { handled: true };
    survey.status = 'archived';
    survey.updatedAt = new Date().toISOString();
    db.auditLogs.push(audit(survey.workspaceId, user.id, 'survey.archived', 'survey', survey.id, {}));
    await saveDb(state);
    sendJson(res, 200, { survey });
    return { handled: true };
  }
  if (segments.length === 1) {
    sendJson(res, 405, { error: { code: 'method_not_allowed', message: 'Use GET, PUT, or DELETE for a survey.' } });
    return { handled: true };
  }

  if (segments[1] === 'template' && segments.length === 2 && req.method === 'POST') {
    if (!requireSurveyAccess(res, db, user, survey, 'editor')) return { handled: true };
    const body = await readJson(req);
    const template = createCustomTemplateFromSurvey(db, survey, user.id, body);
    db.customTemplates.push(template);
    db.auditLogs.push(audit(survey.workspaceId, user.id, 'template.saved_from_survey', 'template', template.id, { surveyId: survey.id, status: template.status }));
    await saveDb(state);
    sendJson(res, 201, { template });
    return { handled: true };
  }
  if (segments[1] === 'publish' && req.method === 'POST') {
    if (!requireSurveyAccess(res, db, user, survey, 'editor')) return { handled: true };
    const publish = publishSurveyDraft(db, survey, user.id, { actorRole: effectiveSurveyRole(db, user, survey) });
    if (!publish.ok) {
      sendJson(res, publish.status, { error: publish.error });
      return { handled: true };
    }
    db.auditLogs.push(audit(survey.workspaceId, user.id, 'survey.published', 'survey', survey.id, { versionId: publish.version.id }));
    await saveDb(state);
    sendJson(res, 200, { survey, version: publish.version });
    return { handled: true };
  }
  if (segments[1] === 'approval' && segments[2] === 'request' && req.method === 'POST') {
    if (!requireSurveyAccess(res, db, user, survey, 'editor')) return { handled: true };
    const body = await readJson(req);
    requestSurveyApproval(survey, user.id, body.note);
    db.auditLogs.push(audit(survey.workspaceId, user.id, 'survey.approval_requested', 'survey', survey.id, { status: survey.approvalStatus }));
    await saveDb(state);
    sendJson(res, 200, { survey, approval: surveyApprovalPayload(db, survey) });
    return { handled: true };
  }
  if (segments[1] === 'approval' && ['approve', 'reject'].includes(segments[2]) && req.method === 'POST') {
    if (!requireWorkspace(res, db, user, survey.workspaceId, 'admin')) return { handled: true };
    if (segments[2] === 'approve') {
      const validation = validateSurveyForPublish(survey);
      if (!validation.ok) {
        sendJson(res, 400, { error: { code: 'publish_validation_failed', message: validation.message, details: validation.errors } });
        return { handled: true };
      }
    }
    const body = await readJson(req);
    const decision = segments[2] === 'approve' ? 'approved' : 'rejected';
    reviewSurveyApproval(survey, user.id, decision, body.note);
    db.auditLogs.push(audit(survey.workspaceId, user.id, `survey.approval_${decision}`, 'survey', survey.id, { requestedBy: survey.approvalRequestedBy }));
    await saveDb(state);
    sendJson(res, 200, { survey, approval: surveyApprovalPayload(db, survey) });
    return { handled: true };
  }
  if (segments[1] === 'pause' && req.method === 'POST') {
    if (!requireSurveyAccess(res, db, user, survey, 'editor')) return { handled: true };
    survey.status = 'paused';
    survey.updatedAt = new Date().toISOString();
    db.auditLogs.push(audit(survey.workspaceId, user.id, 'survey.paused', 'survey', survey.id, {}));
    await saveDb(state);
    sendJson(res, 200, { survey });
    return { handled: true };
  }
  if (segments[1] === 'access' && req.method === 'PUT') {
    if (!requireWorkspace(res, db, user, survey.workspaceId, 'admin')) return { handled: true };
    const body = await readJson(req);
    survey.accessMode = normalizeSurveyAccessMode(body.accessMode ?? survey.accessMode);
    survey.accessRules = normalizeSurveyAccessRules(db, survey, body.accessRules ?? []);
    survey.updatedAt = new Date().toISOString();
    db.auditLogs.push(audit(survey.workspaceId, user.id, 'survey.access_updated', 'survey', survey.id, { accessMode: survey.accessMode, grants: survey.accessRules.length }));
    await saveDb(state);
    sendJson(res, 200, { survey });
    return { handled: true };
  }
  return { handled: false, survey };
}

module.exports = { handleSurveyLifecycleRoute };
