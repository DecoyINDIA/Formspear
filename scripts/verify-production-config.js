const { productionConfigurationIssues } = require('../src/production-config');

const issues = productionConfigurationIssues(process.env);
if (issues.length) {
  console.error('Production configuration check failed:');
  issues.forEach((issue) => console.error(`- ${issue}`));
  process.exitCode = 1;
} else {
  console.log('Production configuration check passed. Durable services and fail-closed provider settings are configured.');
}
