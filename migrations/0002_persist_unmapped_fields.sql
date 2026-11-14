BEGIN;

ALTER TABLE surveys ADD COLUMN IF NOT EXISTS published_version_id text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_secret_encrypted text NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS extra_json jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS extra_json jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE surveys ADD COLUMN IF NOT EXISTS extra_json jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE responses ADD COLUMN IF NOT EXISTS extra_json jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS extra_json jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE webhooks ADD COLUMN IF NOT EXISTS extra_json jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE workspace_invites ADD COLUMN IF NOT EXISTS extra_json jsonb NOT NULL DEFAULT '{}'::jsonb;

INSERT INTO schema_migrations (version, name)
VALUES ('0002', 'persist_unmapped_fields')
ON CONFLICT (version) DO NOTHING;

COMMIT;
