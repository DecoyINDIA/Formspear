const ALL_FEATURES = ['sso', 'apiV1', 'campaigns', 'agency', 'inAppSdk'];

function enabledFeatures(env = process.env) {
  const raw = env.FORMSPEAR_FEATURES;
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return env.NODE_ENV === 'production' ? [] : [...ALL_FEATURES];
  }
  const trimmed = String(raw).trim();
  if (trimmed === 'all') return [...ALL_FEATURES];
  if (trimmed === 'none') return [];
  const parts = trimmed.split(',').map((p) => p.trim()).filter(Boolean);
  const matched = parts.filter((name) => ALL_FEATURES.includes(name));
  return [...new Set(matched)];
}

function featureEnabled(name, env = process.env) {
  return enabledFeatures(env).includes(name);
}

module.exports = { ALL_FEATURES, enabledFeatures, featureEnabled };
