CREATE TABLE "integrations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid,
	"kind" text NOT NULL,
	"config" jsonb NOT NULL,
	"secret_enc" text NOT NULL,
	"key_version" integer NOT NULL,
	"secret_hint" text NOT NULL,
	"updated_by" uuid,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integrations_owner_kind" UNIQUE NULLS NOT DISTINCT("organization_id","kind"),
	CONSTRAINT "integrations_kind" CHECK (kind in ('smtp')),
	CONSTRAINT "integrations_secret_hint_length" CHECK (char_length("integrations"."secret_hint") <= 4)
);
--> statement-breakpoint
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Hand-written from here (drizzle-kit does not manage row level security).
-- An agency's row is visible and writable only inside that agency's transaction; the platform
-- default (organization_id null) never matches app.organization_id, so only the system scope
-- reaches it.
ALTER TABLE "integrations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "integrations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY org_isolation ON integrations
  USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid
         OR current_setting('app.scope', true) = 'system')
  WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid
         OR current_setting('app.scope', true) = 'system');
