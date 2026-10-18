CREATE TABLE "invites" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid,
	"purpose" text NOT NULL,
	"email" "citext" NOT NULL,
	"existing_user_id" uuid,
	"reserved_user_id" uuid,
	"token_hash" "bytea" NOT NULL,
	"invited_by" uuid,
	"org_role" text,
	"memberships" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invites_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "invites_purpose" CHECK (purpose in ('bootstrap', 'invite', 'organization_owner')),
	CONSTRAINT "invites_org_role" CHECK ("invites"."org_role" is null or org_role in ('owner', 'admin', 'member')),
	CONSTRAINT "invites_organization_only_bootstrap_without" CHECK ("invites"."organization_id" is not null or "invites"."purpose" = 'bootstrap'),
	CONSTRAINT "invites_existing_or_reserved_user" CHECK ("invites"."existing_user_id" is null or "invites"."reserved_user_id" is null)
);
--> statement-breakpoint
CREATE TABLE "organization_keys" (
	"organization_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"key_enc" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retired_at" timestamp with time zone,
	CONSTRAINT "organization_keys_organization_id_version_pk" PRIMARY KEY("organization_id","version")
);
--> statement-breakpoint
CREATE TABLE "organization_members" (
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_members_organization_id_user_id_pk" PRIMARY KEY("organization_id","user_id"),
	CONSTRAINT "organization_members_role" CHECK (role in ('owner', 'admin', 'member')),
	CONSTRAINT "organization_members_status" CHECK (status in ('active', 'disabled'))
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"limits" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"suspended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug"),
	CONSTRAINT "organizations_status" CHECK (status in ('active', 'suspended'))
);
--> statement-breakpoint
CREATE TABLE "workspace_members" (
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_members_workspace_id_user_id_pk" PRIMARY KEY("workspace_id","user_id"),
	CONSTRAINT "workspace_members_role" CHECK (role in ('manager', 'publisher', 'editor', 'viewer'))
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo_key" text,
	"default_post_time" time,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspaces_organization_slug" UNIQUE("organization_id","slug"),
	CONSTRAINT "workspaces_organization_id" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid,
	"actor_id" uuid,
	"source" text NOT NULL,
	"action" text NOT NULL,
	"entity" text,
	"entity_id" uuid,
	"workspace_id" uuid,
	"ip" "inet",
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_log_source" CHECK (source in ('panel', 'api', 'mcp', 'system'))
);
--> statement-breakpoint
CREATE TABLE "api_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"scopes" text[] DEFAULT '{}' NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_keys" ADD CONSTRAINT "organization_keys_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspace_fk" FOREIGN KEY ("organization_id","workspace_id") REFERENCES "public"."workspaces"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_member_fk" FOREIGN KEY ("organization_id","user_id") REFERENCES "public"."organization_members"("organization_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_member_fk" FOREIGN KEY ("organization_id","user_id") REFERENCES "public"."organization_members"("organization_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invites_organization_id_idx" ON "invites" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "organization_members_user_id_idx" ON "organization_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_members_one_owner" ON "organization_members" USING btree ("organization_id") WHERE role = 'owner';--> statement-breakpoint
CREATE INDEX "audit_log_organization_created_idx" ON "audit_log" USING btree ("organization_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_log_organization_workspace_created_idx" ON "audit_log" USING btree ("organization_id","workspace_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_log_actor_created_idx" ON "audit_log" USING btree ("actor_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "api_tokens_organization_id_idx" ON "api_tokens" USING btree ("organization_id");--> statement-breakpoint
-- Hand-written from here (drizzle-kit does not manage row level security or functions).
-- Grants that name the runtime role are applied by runMigrations(), which knows its name.
-- Isolation between agencies: every row of an agency is visible only inside that agency's
-- transaction (app.organization_id) or in the explicit system scope.
ALTER TABLE "organization_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "organization_members" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "organization_keys" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "organization_keys" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "invites" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "invites" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "workspaces" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "workspaces" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "workspace_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "workspace_members" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "audit_log" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "api_tokens" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "api_tokens" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['organization_members', 'organization_keys', 'invites', 'workspaces',
                           'workspace_members', 'audit_log', 'api_tokens'] LOOP
    EXECUTE format($p$
      CREATE POLICY org_isolation ON %I
        USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid
               OR current_setting('app.scope', true) = 'system')
        WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid
               OR current_setting('app.scope', true) = 'system')$p$, t);
  END LOOP;
END $$;--> statement-breakpoint
ALTER TABLE "organizations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "organizations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- An agency reads and updates its own row; creating, deleting, suspending and changing limits
-- belong to the platform (system scope). Stricter than the plan's FOR ALL (review of Task 5).
CREATE POLICY org_self_read ON organizations FOR SELECT
  USING (id = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY org_self_update ON organizations FOR UPDATE
  USING (id = nullif(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK (id = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
CREATE FUNCTION organizations_platform_columns_guard() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF current_setting('app.scope', true) IS DISTINCT FROM 'system'
     AND (NEW.status IS DISTINCT FROM OLD.status
          OR NEW.suspended_at IS DISTINCT FROM OLD.suspended_at
          OR NEW.limits IS DISTINCT FROM OLD.limits
          OR NEW.slug IS DISTINCT FROM OLD.slug) THEN
    RAISE EXCEPTION 'status, suspension, limits and slug change only in the system scope'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER organizations_platform_columns_guard BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION organizations_platform_columns_guard();--> statement-breakpoint
-- Read-only, for the agency switcher and slug resolution
CREATE POLICY org_listed_for_member ON organizations FOR SELECT
  USING (id IN (SELECT organization_id FROM organization_members
                 WHERE user_id = nullif(current_setting('app.user_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY org_system ON organizations FOR ALL
  USING (current_setting('app.scope', true) = 'system')
  WITH CHECK (current_setting('app.scope', true) = 'system');--> statement-breakpoint
-- A user also sees all of their own memberships (agency switcher)
CREATE POLICY own_memberships ON organization_members FOR SELECT
  USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
-- Personal entries (no agency) are readable and writable by their author
CREATE POLICY own_personal_entries_read ON audit_log FOR SELECT
  USING (organization_id IS NULL
         AND actor_id = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY own_personal_entries_write ON audit_log FOR INSERT
  WITH CHECK (organization_id IS NULL
              AND actor_id = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
-- The only change allowed on the audit log: shortening old IPs (§15.7). It runs as the table
-- owner but stays under FORCE ROW LEVEL SECURITY: an agency reaches only its own entries.
CREATE FUNCTION audit_shorten_ips(before timestamptz) RETURNS integer
  LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  WITH s AS (
    UPDATE audit_log SET ip = network(set_masklen(ip, CASE WHEN family(ip) = 4 THEN 24 ELSE 48 END))
     WHERE created_at < before AND ip IS NOT NULL AND masklen(ip) IN (32, 128)
     RETURNING 1)
  SELECT count(*)::int FROM s $$;--> statement-breakpoint
-- Questions across users that RLS would not let a user or an agency ask: only a yes/no or a
-- number. plpgsql rather than `SET app.scope` in the definition, which app_migrator cannot
-- create (R1); the previous scope is restored on every exit.
CREATE FUNCTION shares_active_organization(a uuid, b uuid) RETURNS boolean
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE prev text := current_setting('app.scope', true); r boolean;
BEGIN
  PERFORM set_config('app.scope', 'system', true);
  BEGIN
    SELECT EXISTS (
      SELECT 1 FROM organization_members ma
        JOIN organization_members mb ON mb.organization_id = ma.organization_id
        JOIN organizations o ON o.id = ma.organization_id
       WHERE ma.user_id = a AND mb.user_id = b
         AND ma.status = 'active' AND mb.status = 'active' AND o.status = 'active') INTO r;
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('app.scope', coalesce(prev, ''), true); RAISE;
  END;
  PERFORM set_config('app.scope', coalesce(prev, ''), true);
  RETURN r;
END $$;--> statement-breakpoint
CREATE FUNCTION organization_count(u uuid) RETURNS integer
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE prev text := current_setting('app.scope', true); n integer;
BEGIN
  PERFORM set_config('app.scope', 'system', true);
  BEGIN
    -- every membership, disabled or suspended included: a reset must never touch an identity used elsewhere
    SELECT count(*)::int FROM organization_members m JOIN organizations o ON o.id = m.organization_id
     WHERE m.user_id = u INTO n;
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('app.scope', coalesce(prev, ''), true); RAISE;
  END;
  PERFORM set_config('app.scope', coalesce(prev, ''), true);
  RETURN n;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION audit_shorten_ips(timestamptz), shares_active_organization(uuid, uuid),
  organization_count(uuid) FROM PUBLIC;
