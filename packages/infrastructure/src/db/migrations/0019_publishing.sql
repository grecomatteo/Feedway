CREATE TABLE "target_attempts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"target_id" uuid NOT NULL,
	"step" text NOT NULL,
	"outcome" text NOT NULL,
	"error_code" text,
	"meta_error_code" text,
	"duration_ms" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "target_attempts_step" CHECK (step in ('prepare', 'publish', 'verify', 'recheck')),
	CONSTRAINT "target_attempts_outcome" CHECK (outcome in ('done', 'wait', 'transient', 'permanent', 'uncertain')),
	CONSTRAINT "target_attempts_duration" CHECK ("target_attempts"."duration_ms" >= 0),
	CONSTRAINT "target_attempts_error_code" CHECK ("target_attempts"."error_code" is null or "target_attempts"."error_code" ~ '^[a-z_]{1,40}$'),
	CONSTRAINT "target_attempts_meta_error_code" CHECK ("target_attempts"."meta_error_code" is null or "target_attempts"."meta_error_code" ~ '^[0-9]{1,10}(/[0-9]{1,10})?$')
);
--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid,
	"type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dispatched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outbox_events_type" CHECK (type in ('post.target_confirmed', 'post.confirmed', 'post.target_failed', 'post.target_problem', 'post.paused', 'post.file_wont_publish', 'account.quota_low'))
);
--> statement-breakpoint
ALTER TABLE "media_variants" DROP CONSTRAINT "media_variants_one_per_purpose";--> statement-breakpoint
ALTER TABLE "post_targets" DROP CONSTRAINT "post_targets_status";--> statement-breakpoint
ALTER TABLE "posts" DROP CONSTRAINT "posts_status";--> statement-breakpoint
ALTER TABLE "account_connections" ADD COLUMN "last_usage_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "media_variants" ADD COLUMN "recipe" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "media_variants" ADD COLUMN "status" text DEFAULT 'ready' NOT NULL;--> statement-breakpoint
ALTER TABLE "media_variants" ADD COLUMN "failure" text;--> statement-breakpoint
ALTER TABLE "post_targets" ADD COLUMN "generation" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "post_targets" ADD CONSTRAINT "post_targets_workspace_id" UNIQUE("organization_id","workspace_id","id");--> statement-breakpoint
ALTER TABLE "target_attempts" ADD CONSTRAINT "target_attempts_target_fk" FOREIGN KEY ("organization_id","workspace_id","target_id") REFERENCES "public"."post_targets"("organization_id","workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "target_attempts_target_idx" ON "target_attempts" USING btree ("organization_id","target_id","created_at");--> statement-breakpoint
CREATE INDEX "outbox_events_pending_idx" ON "outbox_events" USING btree ("created_at") WHERE "outbox_events"."dispatched_at" is null;--> statement-breakpoint
CREATE INDEX "outbox_events_organization_idx" ON "outbox_events" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "post_targets_due_idx" ON "post_targets" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "post_targets_account_published_idx" ON "post_targets" USING btree ("organization_id","account_id","published_at");--> statement-breakpoint
ALTER TABLE "media_variants" ADD CONSTRAINT "media_variants_one_per_recipe" UNIQUE("organization_id","media_id","purpose","recipe");--> statement-breakpoint
ALTER TABLE "media_variants" ADD CONSTRAINT "media_variants_recipe" CHECK (recipe ~ '^[a-z0-9-]{0,64}$');--> statement-breakpoint
ALTER TABLE "media_variants" ADD CONSTRAINT "media_variants_status" CHECK (status in ('pending', 'ready', 'failed'));--> statement-breakpoint
ALTER TABLE "media_variants" ADD CONSTRAINT "media_variants_failure" CHECK ("media_variants"."status" <> 'failed' or "media_variants"."failure" is not null);--> statement-breakpoint
ALTER TABLE "post_targets" ADD CONSTRAINT "post_targets_step" CHECK ("post_targets"."step" is null or step in ('prepare', 'publish', 'verify', 'recheck'));--> statement-breakpoint
ALTER TABLE "post_targets" ADD CONSTRAINT "post_targets_generation" CHECK ("post_targets"."generation" >= 0);--> statement-breakpoint
ALTER TABLE "post_targets" ADD CONSTRAINT "post_targets_status" CHECK (status in ('draft', 'scheduled', 'preparing', 'ready', 'publishing', 'retrying', 'unknown', 'published', 'verifying', 'confirmed', 'problem', 'failed', 'paused', 'cancelled'));--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_status" CHECK (status in ('draft', 'scheduled', 'publishing', 'partial', 'failed', 'problem', 'published', 'paused', 'cancelled'));--> statement-breakpoint
-- Hand-written from here (drizzle-kit does not manage row level security). As 0018: an agency's
-- rows only inside its transaction or in the system scope; an outbox event of the platform
-- (`organization_id` null) matches no agency, so only the system scope reads it.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['target_attempts', 'outbox_events'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$
      CREATE POLICY org_isolation ON %I
        USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid
               OR current_setting('app.scope', true) = 'system')
        WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid
               OR current_setting('app.scope', true) = 'system')$p$, t);
  END LOOP;
END $$;--> statement-breakpoint
-- D-77 (a), Matteo 20/11: the posts of 0.12 scheduled for a time already past go back to draft,
-- as «Riporta in bozza» does (no fingerprint, version + 1), each with a `post.unscheduled` entry
-- of the system. 0.12 never published: without this, the worker of 0.13 would start them late.
-- The tables force row level security on their owner too: the system scope, for this
-- transaction's statements only, and cleared at the end.
SELECT set_config('app.scope', 'system', true);--> statement-breakpoint
WITH overdue AS (
  UPDATE posts SET status = 'draft', version = version + 1, updated_at = now()
  WHERE status = 'scheduled' AND scheduled_at < now()
  RETURNING id, organization_id, workspace_id
), targets AS (
  UPDATE post_targets t SET status = 'draft', fingerprint = NULL, updated_at = now()
  FROM overdue o
  WHERE t.organization_id = o.organization_id AND t.post_id = o.id AND t.status = 'scheduled'
  RETURNING t.id
)
INSERT INTO audit_log (id, organization_id, actor_id, source, action, entity, entity_id,
                       workspace_id, data)
-- a UUID v7 from the clock and gen_random_uuid() (PostgreSQL 16 has no uuidv7())
SELECT encode(set_bit(set_bit(overlay(uuid_send(gen_random_uuid())
         placing substring(int8send((extract(epoch from clock_timestamp()) * 1000)::bigint) from 3)
         from 1 for 6), 52, 1), 53, 1), 'hex')::uuid,
       o.organization_id, NULL, 'system', 'post.unscheduled', 'post', o.id, o.workspace_id,
       '{"reason":"overdue"}'::jsonb
FROM overdue o;--> statement-breakpoint
SELECT set_config('app.scope', '', true);
