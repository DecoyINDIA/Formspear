function handleAnalyticsRoute(context) {
  const { req, res, url, segments, db, survey, filterResponses, buildAnalytics, buildAnalyticsComparison, sendJson } = context;
  if (segments[1] !== 'analytics') return false;
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: { code: 'method_not_allowed', message: 'Use GET for survey analytics.' } });
    return true;
  }
  const allResponses = db.responses.filter((item) => item.surveyId === survey.id && item.status !== 'deleted');
  const responses = filterResponses(allResponses, url, survey, { noPagination: true }).responses;
  const analytics = buildAnalytics(survey, responses);
  const compareFrom = url.searchParams.get('compareFrom');
  const compareTo = url.searchParams.get('compareTo');
  if (compareFrom || compareTo) {
    const compareUrl = new URL(url.toString());
    compareUrl.searchParams.delete('from');
    compareUrl.searchParams.delete('to');
    if (compareFrom) compareUrl.searchParams.set('from', compareFrom);
    if (compareTo) compareUrl.searchParams.set('to', compareTo);
    const comparisonResponses = filterResponses(allResponses, compareUrl, survey, { noPagination: true }).responses;
    analytics.comparison = buildAnalyticsComparison(analytics, buildAnalytics(survey, comparisonResponses));
  }
  sendJson(res, 200, { analytics });
  return true;
}

module.exports = { handleAnalyticsRoute };
