BEGIN;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  name text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS platform_settings (
  key text PRIMARY KEY,
  value_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  avatar_url text NOT NULL DEFAULT '',
  email_verified_at timestamptz,
  platform_role text NOT NULL DEFAULT 'user',
  timezone text NOT NULL DEFAULT 'Asia/Kolkata',
  notification_preferences jsonb NOT NULL DEFAULT '{}'::jsonb,
  disabled boolean NOT NULL DEFAULT false,
  two_factor_secret_hash text,
  two_factor_enabled boolean NOT NULL DEFAULT false,
  two_factor_recovery_codes jsonb NOT NULL DEFAULT '[]'::jsonb,
  auth_provider text NOT NULL DEFAULT 'password',
  terms_accepted_at timestamptz,
  privacy_accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  remembered boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS two_factor_challenges (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  remember_me boolean NOT NULL DEFAULT false,
  attempts integer NOT NULL DEFAULT 0,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS email_verification_tokens (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  token_preview text NOT NULL DEFAULT '',
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  token_preview text NOT NULL DEFAULT '',
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workspaces (
  id text PRIMARY KEY,
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  logo_url text NOT NULL DEFAULT '',
  brand_color text NOT NULL DEFAULT '#176B5B',
  button_color text NOT NULL DEFAULT '#B75D2A',
  timezone text NOT NULL DEFAULT 'Asia/Kolkata',
  default_language text NOT NULL DEFAULT 'en',
  owner_id text NOT NULL REFERENCES users(id),
  plan_id text NOT NULL DEFAULT 'starter',
  ai_credit_limit_override integer,
  allow_external_ai boolean NOT NULL DEFAULT true,
  industry text NOT NULL DEFAULT 'General services',
  company_size text NOT NULL DEFAULT '1-10',
  custom_domain text NOT NULL DEFAULT '',
  custom_domain_status text NOT NULL DEFAULT 'not_configured',
  custom_domain_verification_token text NOT NULL DEFAULT '',
  custom_domain_verified_at timestamptz,
  custom_domain_ssl_status text NOT NULL DEFAULT 'not_configured',
  default_sender_email text NOT NULL DEFAULT '',
  custom_css text NOT NULL DEFAULT '',
  custom_footer_text text NOT NULL DEFAULT '',
  sso_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  data_retention_settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  privacy_policy_url text NOT NULL DEFAULT '',
  terms_url text NOT NULL DEFAULT '',
  retention_days integer NOT NULL DEFAULT 365,
  retention_schedule_enabled boolean NOT NULL DEFAULT true,
  retention_last_run_at timestamptz,
  retention_next_run_at timestamptz,
  suspended boolean NOT NULL DEFAULT false,
  billing_warning text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workspace_members (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL,
  invited_by text REFERENCES users(id),
  joined_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, user_id)
);

CREATE TABLE IF NOT EXISTS workspace_invites (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email text NOT NULL,
  role text NOT NULL,
  token_hash text NOT NULL,
  token_preview text NOT NULL DEFAULT '',
  invited_by text REFERENCES users(id),
  accepted_at timestamptz,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS surveys (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  internal_name text NOT NULL DEFAULT '',
  type text NOT NULL DEFAULT 'feedback',
  status text NOT NULL DEFAULT 'draft',
  slug text NOT NULL UNIQUE,
  language text NOT NULL DEFAULT 'en',
  settings_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  branding_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  schema_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  access_mode text NOT NULL DEFAULT 'workspace',
  access_rules_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  metrics_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by text REFERENCES users(id),
  published_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS survey_versions (
  id text PRIMARY KEY,
  survey_id text NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
  version_number integer NOT NULL,
  schema_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  logic_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by text REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (survey_id, version_number)
);

CREATE TABLE IF NOT EXISTS questions (
  id text PRIMARY KEY,
  survey_id text NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
  version_id text REFERENCES survey_versions(id) ON DELETE SET NULL,
  type text NOT NULL,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  required boolean NOT NULL DEFAULT false,
  order_index integer NOT NULL DEFAULT 0,
  settings_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  validation_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS respondents (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  external_id text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  name text NOT NULL DEFAULT '',
  attributes_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS responses (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  survey_id text NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
  survey_version_id text REFERENCES survey_versions(id) ON DELETE SET NULL,
  respondent_id text REFERENCES respondents(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'completed',
  answers_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  tags_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  sentiment text NOT NULL DEFAULT 'neutral',
  lead_score integer NOT NULL DEFAULT 0,
  important boolean NOT NULL DEFAULT false,
  internal_notes_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  resume_token_hash text NOT NULL DEFAULT '',
  resume_expires_at timestamptz,
  started_at timestamptz,
  submitted_at timestamptz,
  archived_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS contacts (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  company text NOT NULL DEFAULT '',
  source text NOT NULL DEFAULT '',
  tags_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  lead_score integer NOT NULL DEFAULT 0,
  stage text NOT NULL DEFAULT 'new',
  owner_id text REFERENCES users(id) ON DELETE SET NULL,
  next_follow_up_at timestamptz,
  pipeline_updated_at timestamptz,
  last_response_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS integrations (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  type text NOT NULL,
  name text NOT NULL,
  config_encrypted text NOT NULL DEFAULT '',
  config_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'active',
  created_by text REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS integration_logs (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  integration_id text REFERENCES integrations(id) ON DELETE SET NULL,
  type text NOT NULL,
  event text NOT NULL,
  payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  provider text NOT NULL DEFAULT '',
  status text NOT NULL,
  response_status text NOT NULL DEFAULT '',
  error text NOT NULL DEFAULT '',
  job_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS webhooks (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  url text NOT NULL,
  events_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  secret text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS webhook_logs (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  webhook_id text REFERENCES webhooks(id) ON DELETE SET NULL,
  event text NOT NULL,
  payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  response_status text NOT NULL DEFAULT '',
  error text NOT NULL DEFAULT '',
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS alerts (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  survey_id text REFERENCES surveys(id) ON DELETE CASCADE,
  name text NOT NULL,
  conditions_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  channels_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_jobs (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  survey_id text REFERENCES surveys(id) ON DELETE SET NULL,
  response_id text REFERENCES responses(id) ON DELETE SET NULL,
  job_type text NOT NULL,
  status text NOT NULL,
  input_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  output_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  tokens_used integer NOT NULL DEFAULT 0,
  error text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE IF NOT EXISTS jobs (
  id text PRIMARY KEY,
  workspace_id text REFERENCES workspaces(id) ON DELETE CASCADE,
  type text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  next_run_at timestamptz,
  payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_error text NOT NULL DEFAULT '',
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS email_logs (
  id text PRIMARY KEY,
  workspace_id text REFERENCES workspaces(id) ON DELETE SET NULL,
  recipient text NOT NULL DEFAULT '',
  subject text NOT NULL DEFAULT '',
  body_preview text NOT NULL DEFAULT '',
  provider text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT '',
  job_id text REFERENCES jobs(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS email_campaigns (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  survey_id text REFERENCES surveys(id) ON DELETE SET NULL,
  name text NOT NULL,
  subject text NOT NULL,
  message text NOT NULL DEFAULT '',
  contacts_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'draft',
  sent_count integer NOT NULL DEFAULT 0,
  opened_count integer NOT NULL DEFAULT 0,
  clicked_count integer NOT NULL DEFAULT 0,
  scheduled_at timestamptz,
  created_by text REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS campaign_events (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  campaign_id text NOT NULL REFERENCES email_campaigns(id) ON DELETE CASCADE,
  event text NOT NULL,
  recipient_hash text NOT NULL DEFAULT '',
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS file_uploads (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  survey_id text REFERENCES surveys(id) ON DELETE SET NULL,
  response_id text REFERENCES responses(id) ON DELETE SET NULL,
  question_id text NOT NULL DEFAULT '',
  name text NOT NULL,
  mime_type text NOT NULL DEFAULT '',
  extension text NOT NULL DEFAULT '',
  size_bytes bigint NOT NULL DEFAULT 0,
  sha256 text NOT NULL DEFAULT '',
  storage_provider text NOT NULL DEFAULT 'local_json',
  storage_bucket text NOT NULL DEFAULT '',
  storage_key text NOT NULL DEFAULT '',
  storage_url text NOT NULL DEFAULT '',
  scan_status text NOT NULL DEFAULT 'pending',
  scan_provider text NOT NULL DEFAULT '',
  scan_signature text NOT NULL DEFAULT '',
  scan_message text NOT NULL DEFAULT '',
  scan_checked_at timestamptz,
  quarantined boolean NOT NULL DEFAULT false,
  lifecycle_status text NOT NULL DEFAULT 'active',
  retention_expires_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS monthly_reports (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  month text NOT NULL,
  title text NOT NULL,
  report_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  ai_generated boolean NOT NULL DEFAULT true,
  scheduled boolean NOT NULL DEFAULT false,
  job_id text REFERENCES jobs(id) ON DELETE SET NULL,
  pdf_url text NOT NULL DEFAULT '',
  generated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  plan_id text NOT NULL,
  provider text NOT NULL DEFAULT 'manual',
  provider_subscription_id text NOT NULL DEFAULT '',
  provider_customer_id text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'active',
  current_period_start timestamptz,
  current_period_end timestamptz,
  billing_policy_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS usage_meters (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  period text NOT NULL,
  responses_count integer NOT NULL DEFAULT 0,
  ai_credits_used integer NOT NULL DEFAULT 0,
  storage_used bigint NOT NULL DEFAULT 0,
  team_members_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, period)
);

CREATE TABLE IF NOT EXISTS invoices (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  subscription_id text REFERENCES subscriptions(id) ON DELETE SET NULL,
  provider text NOT NULL DEFAULT 'manual',
  provider_invoice_id text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'open',
  subtotal_inr integer NOT NULL DEFAULT 0,
  tax_inr integer NOT NULL DEFAULT 0,
  tax_mode text NOT NULL DEFAULT 'none',
  tax_percent numeric(6, 3) NOT NULL DEFAULT 0,
  proration_credit_inr integer NOT NULL DEFAULT 0,
  amount_due_inr integer NOT NULL DEFAULT 0,
  amount_paid_inr integer NOT NULL DEFAULT 0,
  line_items_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  billing_policy_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  due_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS custom_templates (
  id text PRIMARY KEY,
  workspace_id text REFERENCES workspaces(id) ON DELETE CASCADE,
  scope text NOT NULL DEFAULT 'workspace',
  status text NOT NULL DEFAULT 'draft',
  name text NOT NULL,
  category text NOT NULL DEFAULT '',
  industry text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  tags_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  schema_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by text REFERENCES users(id),
  usage_count integer NOT NULL DEFAULT 0,
  published_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id text PRIMARY KEY,
  workspace_id text REFERENCES workspaces(id) ON DELETE SET NULL,
  user_id text REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notifications (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id text REFERENCES users(id) ON DELETE SET NULL,
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  read_at timestamptz,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS error_logs (
  id text PRIMARY KEY,
  method text NOT NULL DEFAULT '',
  path text NOT NULL DEFAULT '',
  query text NOT NULL DEFAULT '',
  name text NOT NULL DEFAULT '',
  message text NOT NULL DEFAULT '',
  stack text NOT NULL DEFAULT '',
  user_agent text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_workspace_members_user_id ON workspace_members(user_id);
CREATE INDEX IF NOT EXISTS idx_workspace_invites_workspace_email ON workspace_invites(workspace_id, email);
CREATE INDEX IF NOT EXISTS idx_surveys_workspace_id ON surveys(workspace_id);
CREATE INDEX IF NOT EXISTS idx_surveys_workspace_status ON surveys(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_surveys_slug ON surveys(slug);
CREATE INDEX IF NOT EXISTS idx_survey_versions_survey_id ON survey_versions(survey_id);
CREATE INDEX IF NOT EXISTS idx_questions_survey_order ON questions(survey_id, order_index);
CREATE INDEX IF NOT EXISTS idx_respondents_workspace_email ON respondents(workspace_id, email);
CREATE INDEX IF NOT EXISTS idx_responses_workspace_id ON responses(workspace_id);
CREATE INDEX IF NOT EXISTS idx_responses_survey_id ON responses(survey_id);
CREATE INDEX IF NOT EXISTS idx_responses_status ON responses(status);
CREATE INDEX IF NOT EXISTS idx_responses_submitted_at ON responses(submitted_at);
CREATE INDEX IF NOT EXISTS idx_responses_workspace_submitted_at ON responses(workspace_id, submitted_at);
CREATE INDEX IF NOT EXISTS idx_responses_survey_submitted_at ON responses(survey_id, submitted_at);
CREATE INDEX IF NOT EXISTS idx_responses_sentiment ON responses(sentiment);
CREATE INDEX IF NOT EXISTS idx_contacts_workspace_email ON contacts(workspace_id, email);
CREATE INDEX IF NOT EXISTS idx_contacts_workspace_stage ON contacts(workspace_id, stage);
CREATE INDEX IF NOT EXISTS idx_integrations_workspace_id ON integrations(workspace_id);
CREATE INDEX IF NOT EXISTS idx_integration_logs_workspace_created_at ON integration_logs(workspace_id, created_at);
CREATE INDEX IF NOT EXISTS idx_webhooks_workspace_id ON webhooks(workspace_id);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_webhook_created_at ON webhook_logs(webhook_id, created_at);
CREATE INDEX IF NOT EXISTS idx_alerts_workspace_survey ON alerts(workspace_id, survey_id);
CREATE INDEX IF NOT EXISTS idx_ai_jobs_workspace_created_at ON ai_jobs(workspace_id, created_at);
CREATE INDEX IF NOT EXISTS idx_jobs_status_next_run_at ON jobs(status, next_run_at);
CREATE INDEX IF NOT EXISTS idx_jobs_workspace_type ON jobs(workspace_id, type);
CREATE INDEX IF NOT EXISTS idx_email_logs_workspace_created_at ON email_logs(workspace_id, created_at);
CREATE INDEX IF NOT EXISTS idx_email_campaigns_workspace_status ON email_campaigns(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_campaign_events_campaign_created_at ON campaign_events(campaign_id, created_at);
CREATE INDEX IF NOT EXISTS idx_file_uploads_workspace_created_at ON file_uploads(workspace_id, created_at);
CREATE INDEX IF NOT EXISTS idx_monthly_reports_workspace_month ON monthly_reports(workspace_id, month);
CREATE INDEX IF NOT EXISTS idx_subscriptions_workspace_id ON subscriptions(workspace_id);
CREATE INDEX IF NOT EXISTS idx_usage_meters_workspace_period ON usage_meters(workspace_id, period);
CREATE INDEX IF NOT EXISTS idx_invoices_workspace_status ON invoices(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_custom_templates_scope_status ON custom_templates(scope, status);
CREATE INDEX IF NOT EXISTS idx_audit_logs_workspace_created_at ON audit_logs(workspace_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_notifications_workspace_created_at ON notifications(workspace_id, created_at);
CREATE INDEX IF NOT EXISTS idx_error_logs_created_at ON error_logs(created_at);

INSERT INTO schema_migrations(version, name)
VALUES ('0001', 'initial_postgres')
ON CONFLICT (version) DO NOTHING;

COMMIT;
