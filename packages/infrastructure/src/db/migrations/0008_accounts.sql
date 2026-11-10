CREATE TABLE "account_connections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"external_user_id" text NOT NULL,
	"connected_by" uuid NOT NULL,
	"token_enc" text NOT NULL,
	"key_version" integer NOT NULL,
	"expires_at" timestamp with time zone,
	"status" text DEFAULT 'pending' NOT NULL,
	"last_refreshed_at" timestamp with time zone,
	"last_usage" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_connections_external_user" UNIQUE("organization_id","kind","external_user_id"),
	CONSTRAINT "account_connections_organization_id" UNIQUE("organization_id","id"),
	CONSTRAINT "account_connections_kind" CHECK (kind in ('meta_system_user', 'meta_business_login')),
	CONSTRAINT "account_connections_status" CHECK (status in ('pending', 'active', 'expired', 'revoked'))
);
--> statement-breakpoint
CREATE TABLE "connection_attempts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"state_hash" "bytea" NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "connection_attempts_state" UNIQUE("organization_id","state_hash"),
	CONSTRAINT "connection_attempts_kind" CHECK (kind in ('meta_system_user', 'meta_business_login'))
);
--> statement-breakpoint
CREATE TABLE "social_accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"external_id" text NOT NULL,
	"name" text NOT NULL,
	"username" text,
	"avatar_url" text,
	"page_id" text,
	"connection_id" uuid NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"health" text,
	"health_message" text,
	"last_synced_at" timestamp with time zone,
	"quota_used" integer,
	"quota_total" integer,
	"quota_checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "social_accounts_external" UNIQUE("organization_id","platform","external_id"),
	CONSTRAINT "social_accounts_organization_id" UNIQUE("organization_id","id"),
	CONSTRAINT "social_accounts_platform" CHECK (platform in ('instagram', 'facebook')),
	CONSTRAINT "social_accounts_health" CHECK (health is null or health in ('ok', 'warning', 'error')),
	CONSTRAINT "social_accounts_facebook_page" CHECK ("social_accounts"."platform" <> 'facebook' or "social_accounts"."page_id" = "social_accounts"."external_id"),
	CONSTRAINT "social_accounts_quota" CHECK (("social_accounts"."quota_used" is null or "social_accounts"."quota_used" >= 0) and ("social_accounts"."quota_total" is null or "social_accounts"."quota_total" >= 0))
);
--> statement-breakpoint
CREATE TABLE "workspace_accounts" (
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_accounts_workspace_id_account_id_pk" PRIMARY KEY("workspace_id","account_id")
);
--> statement-breakpoint
ALTER TABLE "account_connections" ADD CONSTRAINT "account_connections_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connection_attempts" ADD CONSTRAINT "connection_attempts_member_fk" FOREIGN KEY ("organization_id","user_id") REFERENCES "public"."organization_members"("organization_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_accounts" ADD CONSTRAINT "social_accounts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_accounts" ADD CONSTRAINT "social_accounts_connection_fk" FOREIGN KEY ("organization_id","connection_id") REFERENCES "public"."account_connections"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_accounts" ADD CONSTRAINT "workspace_accounts_workspace_fk" FOREIGN KEY ("organization_id","workspace_id") REFERENCES "public"."workspaces"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_accounts" ADD CONSTRAINT "workspace_accounts_account_fk" FOREIGN KEY ("organization_id","account_id") REFERENCES "public"."social_accounts"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "social_accounts_connection_idx" ON "social_accounts" USING btree ("organization_id","connection_id");--> statement-breakpoint
CREATE INDEX "workspace_accounts_account_idx" ON "workspace_accounts" USING btree ("organization_id","account_id");--> statement-breakpoint
-- Hand-written from here (drizzle-kit does not manage row level security).
-- Every row of an agency is visible and writable only inside that agency's transaction, or in
-- the explicit system scope (the daily planner of plan 03, Task 11). The runtime role gets its
-- rights from the default privileges of the schema (docker/postgres/roles.sql).
ALTER TABLE "account_connections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "account_connections" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "social_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "social_accounts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "workspace_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "workspace_accounts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "connection_attempts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "connection_attempts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['account_connections', 'social_accounts', 'workspace_accounts',
                           'connection_attempts'] LOOP
    EXECUTE format($p$
      CREATE POLICY org_isolation ON %I
        USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid
               OR current_setting('app.scope', true) = 'system')
        WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid
               OR current_setting('app.scope', true) = 'system')$p$, t);
  END LOOP;
END $$;
