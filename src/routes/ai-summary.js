async function handleAiSummaryRoute(context) {
  const {
    req,
    res,
    segments,
    db,
    state,
    user,
    survey,
    requireSurveyAccess,
    consumeAiCredits,
    sendAiCreditLimitError,
    buildAiSummaryWithProvider,
    makeId,
    audit,
    saveDb,
    sendJson
  } = context;

  if (segments[1] !== 'ai-summary') return false;

  if (req.method === 'GET') {
    if (!requireSurveyAccess(res, db, user, survey, 'analyst')) return true;
    const job = db.aiJobs
      .filter((item) => item.surveyId === survey.id && item.jobType === 'survey_summary' && item.status === 'completed')
      .sort((a, b) => new Date(b.completedAt || b.createdAt || 0) - new Date(a.completedAt || a.createdAt || 0))[0] || null;
    sendJson(res, 200, { job, summary: job?.outputJson || null });
    return true;
  }

  if (req.method === 'POST') {
    if (!requireSurveyAccess(res, db, user, survey, 'analyst')) return true;
    const creditCheck = consumeAiCredits(db, survey.workspaceId, 1);
    if (!creditCheck.ok) {
      sendAiCreditLimitError(res, creditCheck);
      return true;
    }
    const responses = db.responses.filter((item) => item.surveyId === survey.id && item.status === 'completed');
    const workspace = db.workspaces.find((item) => item.id === survey.workspaceId);
    const output = await buildAiSummaryWithProvider(db, survey, responses, workspace);
    const job = {
      id: makeId('ai'),
      workspaceId: survey.workspaceId,
      surveyId: survey.id,
      responseId: null,
      jobType: 'survey_summary',
      status: 'completed',
      inputJson: { responseCount: responses.length },
      outputJson: output,
      tokensUsed: output.providerUsage?.totalTokens || Math.max(50, responses.length * 12),
      error: '',
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString()
    };
    db.aiJobs.push(job);
    db.auditLogs.push(audit(survey.workspaceId, user.id, 'ai.summary_generated', 'survey', survey.id, { jobId: job.id }));
    await saveDb(state);
    sendJson(res, 200, { job, summary: output });
    return true;
  }

  sendJson(res, 405, { error: { code: 'method_not_allowed', message: 'Use GET or POST for AI summaries.' } });
  return true;
}

module.exports = { handleAiSummaryRoute };
