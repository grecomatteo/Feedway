CREATE TABLE "library_folders" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"parent_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "library_folders_workspace_id" UNIQUE("organization_id","workspace_id","id"),
	CONSTRAINT "library_folders_name" CHECK (char_length("library_folders"."name") between 1 and 80),
	CONSTRAINT "library_folders_not_own_parent" CHECK ("library_folders"."parent_id" is distinct from "library_folders"."id")
);
--> statement-breakpoint
CREATE TABLE "library_items" (
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"media_id" uuid NOT NULL,
	"folder_id" uuid,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "library_items_organization_id_media_id_pk" PRIMARY KEY("organization_id","media_id")
);
--> statement-breakpoint
CREATE TABLE "media" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'uploading' NOT NULL,
	"original_name" text NOT NULL,
	"mime" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"sha256" text,
	"width" integer,
	"height" integer,
	"duration_ms" integer,
	"fps" double precision,
	"video_codec" text,
	"audio_codec" text,
	"analysis" jsonb,
	"progress" jsonb,
	"storage_key" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_organization_id" UNIQUE("organization_id","id"),
	CONSTRAINT "media_workspace_id" UNIQUE("organization_id","workspace_id","id"),
	CONSTRAINT "media_kind" CHECK (kind in ('image', 'video')),
	CONSTRAINT "media_status" CHECK (status in ('uploading', 'processing', 'ready', 'failed', 'deleted')),
	CONSTRAINT "media_deleted" CHECK (("media"."status" = 'deleted') = ("media"."deleted_at" is not null)),
	CONSTRAINT "media_size" CHECK ("media"."size_bytes" >= 0),
	CONSTRAINT "media_sha256" CHECK ("media"."sha256" is null or "media"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "media_original_name" CHECK (char_length("media"."original_name") between 1 and 255)
);
--> statement-breakpoint
CREATE TABLE "media_variants" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"media_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"storage_key" text NOT NULL,
	"public_token" text,
	"mime" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"width" integer,
	"height" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_variants_one_per_purpose" UNIQUE("organization_id","media_id","purpose"),
	CONSTRAINT "media_variants_token_unique" UNIQUE("public_token"),
	CONSTRAINT "media_variants_purpose" CHECK (purpose in ('ig_feed', 'fb_photo', 'reel', 'story', 'thumbnail', 'share', 'preview', 'cover')),
	CONSTRAINT "media_variants_preview_private" CHECK ("media_variants"."purpose" <> 'preview' or "media_variants"."public_token" is null),
	CONSTRAINT "media_variants_public_token" CHECK (public_token is null or public_token ~ '^[A-Za-z0-9_-]{32}$'),
	CONSTRAINT "media_variants_size" CHECK ("media_variants"."size_bytes" >= 0)
);
--> statement-breakpoint
CREATE TABLE "upload_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"folder_id" uuid,
	"original_name" text NOT NULL,
	"mime" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"parts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"media_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "upload_sessions_size" CHECK ("upload_sessions"."size_bytes" > 0),
	CONSTRAINT "upload_sessions_original_name" CHECK (char_length("upload_sessions"."original_name") between 1 and 255),
	CONSTRAINT "upload_sessions_completed" CHECK (("upload_sessions"."completed_at" is null) = ("upload_sessions"."media_id" is null))
);
--> statement-breakpoint
ALTER TABLE "library_folders" ADD CONSTRAINT "library_folders_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_folders" ADD CONSTRAINT "library_folders_workspace_fk" FOREIGN KEY ("organization_id","workspace_id") REFERENCES "public"."workspaces"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_folders" ADD CONSTRAINT "library_folders_parent_fk" FOREIGN KEY ("organization_id","workspace_id","parent_id") REFERENCES "public"."library_folders"("organization_id","workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_items" ADD CONSTRAINT "library_items_media_fk" FOREIGN KEY ("organization_id","workspace_id","media_id") REFERENCES "public"."media"("organization_id","workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_items" ADD CONSTRAINT "library_items_folder_fk" FOREIGN KEY ("organization_id","workspace_id","folder_id") REFERENCES "public"."library_folders"("organization_id","workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_workspace_fk" FOREIGN KEY ("organization_id","workspace_id") REFERENCES "public"."workspaces"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_variants" ADD CONSTRAINT "media_variants_media_fk" FOREIGN KEY ("organization_id","media_id") REFERENCES "public"."media"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_sessions" ADD CONSTRAINT "upload_sessions_workspace_fk" FOREIGN KEY ("organization_id","workspace_id") REFERENCES "public"."workspaces"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_sessions" ADD CONSTRAINT "upload_sessions_member_fk" FOREIGN KEY ("organization_id","user_id") REFERENCES "public"."organization_members"("organization_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_sessions" ADD CONSTRAINT "upload_sessions_folder_fk" FOREIGN KEY ("organization_id","workspace_id","folder_id") REFERENCES "public"."library_folders"("organization_id","workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_sessions" ADD CONSTRAINT "upload_sessions_media_fk" FOREIGN KEY ("organization_id","workspace_id","media_id") REFERENCES "public"."media"("organization_id","workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "library_items_folder_idx" ON "library_items" USING btree ("organization_id","workspace_id","folder_id");--> statement-breakpoint
CREATE INDEX "media_workspace_created_idx" ON "media" USING btree ("organization_id","workspace_id","created_at","id");--> statement-breakpoint
CREATE INDEX "upload_sessions_user_idx" ON "upload_sessions" USING btree ("organization_id","workspace_id","user_id");--> statement-breakpoint
-- Hand-written from here (drizzle-kit does not manage row level security).
-- Every row of an agency is visible and writable only inside that agency's transaction, or in
-- the explicit system scope (the hourly clean-up of uploads, plan 04 Task 9). The runtime role
-- gets its rights from the default privileges of the schema (docker/postgres/roles.sql).
ALTER TABLE "media" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "media" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "media_variants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "media_variants" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "library_folders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "library_folders" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "library_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "library_items" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "upload_sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "upload_sessions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['media', 'media_variants', 'library_folders', 'library_items',
                           'upload_sessions'] LOOP
    EXECUTE format($p$
      CREATE POLICY org_isolation ON %I
        USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid
               OR current_setting('app.scope', true) = 'system')
        WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid
               OR current_setting('app.scope', true) = 'system')$p$, t);
  END LOOP;
END $$;
