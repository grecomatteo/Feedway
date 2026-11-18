CREATE TABLE "account_groups" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"account_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_groups_name" CHECK (char_length("account_groups"."name") between 1 and 80)
);
--> statement-breakpoint
CREATE TABLE "caption_templates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "caption_templates_kind" CHECK (kind in ('caption', 'signature', 'hashtags')),
	CONSTRAINT "caption_templates_name" CHECK (char_length("caption_templates"."name") between 1 and 80),
	CONSTRAINT "caption_templates_body" CHECK (char_length("caption_templates"."body") between 1 and 70000)
);
--> statement-breakpoint
CREATE TABLE "labels" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"color" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "labels_workspace_id" UNIQUE("organization_id","workspace_id","id"),
	CONSTRAINT "labels_name" CHECK (char_length("labels"."name") between 1 and 40),
	CONSTRAINT "labels_color" CHECK (color in ('feedway', 'blu', 'verde', 'viola', 'grafite'))
);
--> statement-breakpoint
CREATE TABLE "post_labels" (
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"post_id" uuid NOT NULL,
	"label_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "post_labels_organization_id_post_id_label_id_pk" PRIMARY KEY("organization_id","post_id","label_id")
);
--> statement-breakpoint
CREATE TABLE "post_media" (
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"post_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"media_id" uuid NOT NULL,
	"cover_media_id" uuid,
	"cover_offset_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "post_media_organization_id_post_id_position_pk" PRIMARY KEY("organization_id","post_id","position"),
	CONSTRAINT "post_media_position" CHECK ("post_media"."position" >= 0),
	CONSTRAINT "post_media_one_cover" CHECK ("post_media"."cover_media_id" is null or "post_media"."cover_offset_ms" is null),
	CONSTRAINT "post_media_cover_offset" CHECK ("post_media"."cover_offset_ms" is null or "post_media"."cover_offset_ms" >= 0)
);
--> statement-breakpoint
CREATE TABLE "post_notes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"post_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "post_notes_body" CHECK (char_length("post_notes"."body") between 1 and 2000)
);
--> statement-breakpoint
CREATE TABLE "post_targets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"post_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"fingerprint" text,
	"variant" text,
	"step" text,
	"meta_ids" jsonb,
	"external_post_id" text,
	"permalink" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"last_error_code" text,
	"last_error_message" text,
	"published_at" timestamp with time zone,
	"verified_at" timestamp with time zone,
	"verification" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "post_targets_post_account" UNIQUE("organization_id","post_id","account_id"),
	CONSTRAINT "post_targets_status" CHECK (status in ('draft', 'scheduled', 'cancelled')),
	CONSTRAINT "post_targets_fingerprint" CHECK ("post_targets"."fingerprint" is null or "post_targets"."fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "post_targets_attempts" CHECK ("post_targets"."attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "posts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"type" text NOT NULL,
	"caption" text DEFAULT '' NOT NULL,
	"caption_by_platform" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"scheduled_at" timestamp with time zone,
	"timezone" text DEFAULT 'Europe/Rome' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"options" jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"scheduled_by" uuid,
	"updated_by" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "posts_workspace_id" UNIQUE("organization_id","workspace_id","id"),
	CONSTRAINT "posts_type" CHECK (type in ('photo', 'carousel', 'reel', 'story')),
	CONSTRAINT "posts_status" CHECK (status in ('draft', 'scheduled', 'cancelled')),
	CONSTRAINT "posts_scheduled_has_date" CHECK ("posts"."status" <> 'scheduled' or "posts"."scheduled_at" is not null),
	CONSTRAINT "posts_version" CHECK ("posts"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "account_groups" ADD CONSTRAINT "account_groups_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_groups" ADD CONSTRAINT "account_groups_workspace_fk" FOREIGN KEY ("organization_id","workspace_id") REFERENCES "public"."workspaces"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "caption_templates" ADD CONSTRAINT "caption_templates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "caption_templates" ADD CONSTRAINT "caption_templates_workspace_fk" FOREIGN KEY ("organization_id","workspace_id") REFERENCES "public"."workspaces"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "labels" ADD CONSTRAINT "labels_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "labels" ADD CONSTRAINT "labels_workspace_fk" FOREIGN KEY ("organization_id","workspace_id") REFERENCES "public"."workspaces"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_labels" ADD CONSTRAINT "post_labels_post_fk" FOREIGN KEY ("organization_id","workspace_id","post_id") REFERENCES "public"."posts"("organization_id","workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_labels" ADD CONSTRAINT "post_labels_label_fk" FOREIGN KEY ("organization_id","workspace_id","label_id") REFERENCES "public"."labels"("organization_id","workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_media" ADD CONSTRAINT "post_media_post_fk" FOREIGN KEY ("organization_id","workspace_id","post_id") REFERENCES "public"."posts"("organization_id","workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_media" ADD CONSTRAINT "post_media_media_fk" FOREIGN KEY ("organization_id","workspace_id","media_id") REFERENCES "public"."media"("organization_id","workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_media" ADD CONSTRAINT "post_media_cover_fk" FOREIGN KEY ("organization_id","workspace_id","cover_media_id") REFERENCES "public"."media"("organization_id","workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_notes" ADD CONSTRAINT "post_notes_post_fk" FOREIGN KEY ("organization_id","workspace_id","post_id") REFERENCES "public"."posts"("organization_id","workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_targets" ADD CONSTRAINT "post_targets_post_fk" FOREIGN KEY ("organization_id","workspace_id","post_id") REFERENCES "public"."posts"("organization_id","workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_targets" ADD CONSTRAINT "post_targets_account_fk" FOREIGN KEY ("organization_id","account_id") REFERENCES "public"."social_accounts"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_workspace_fk" FOREIGN KEY ("organization_id","workspace_id") REFERENCES "public"."workspaces"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_groups_workspace_idx" ON "account_groups" USING btree ("organization_id","workspace_id");--> statement-breakpoint
CREATE INDEX "caption_templates_workspace_idx" ON "caption_templates" USING btree ("organization_id","workspace_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "labels_workspace_name" ON "labels" USING btree ("organization_id","workspace_id",lower("name"));--> statement-breakpoint
CREATE INDEX "post_labels_label_idx" ON "post_labels" USING btree ("organization_id","label_id");--> statement-breakpoint
CREATE INDEX "post_media_media_idx" ON "post_media" USING btree ("organization_id","media_id");--> statement-breakpoint
CREATE INDEX "post_notes_post_idx" ON "post_notes" USING btree ("organization_id","post_id","created_at");--> statement-breakpoint
CREATE INDEX "post_targets_account_status_idx" ON "post_targets" USING btree ("organization_id","account_id","status");--> statement-breakpoint
CREATE INDEX "post_targets_account_fingerprint_idx" ON "post_targets" USING btree ("organization_id","account_id","fingerprint");--> statement-breakpoint
CREATE INDEX "posts_workspace_status_idx" ON "posts" USING btree ("organization_id","workspace_id","status","scheduled_at");--> statement-breakpoint
-- Hand-written from here (drizzle-kit does not manage row level security).
-- Every row of an agency is visible and writable only inside that agency's transaction, or in
-- the explicit system scope (the worker of stage 7). The runtime role gets its rights from the
-- default privileges of the schema (docker/postgres/roles.sql).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['posts', 'post_media', 'post_targets', 'labels', 'post_labels',
                           'post_notes', 'caption_templates', 'account_groups'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$
      CREATE POLICY org_isolation ON %I
        USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid
               OR current_setting('app.scope', true) = 'system')
        WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid
               OR current_setting('app.scope', true) = 'system')$p$, t);
  END LOOP;
END $$;
