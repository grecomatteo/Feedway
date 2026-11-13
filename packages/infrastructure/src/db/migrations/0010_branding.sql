CREATE TABLE "branding" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"logo_key" text,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "branding" ADD CONSTRAINT "branding_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Hand-written from here (drizzle-kit does not manage row level security).
-- An agency reads and writes only its own row, or the system scope; a person also reads the
-- logo of the agencies where they are an active member, for the switcher.
ALTER TABLE "branding" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "branding" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY org_isolation ON branding
  USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid
         OR current_setting('app.scope', true) = 'system')
  WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid
         OR current_setting('app.scope', true) = 'system');--> statement-breakpoint
CREATE POLICY branding_listed_for_member ON branding FOR SELECT
  USING (organization_id IN (SELECT organization_id FROM organization_members
                 WHERE user_id = nullif(current_setting('app.user_id', true), '')::uuid
                   AND status = 'active'));
