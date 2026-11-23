CREATE TABLE "notification_deliveries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid,
	"user_id" uuid NOT NULL,
	"notification_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"channel" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"claimed_until" timestamp with time zone,
	"error" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_deliveries_one_per_channel" UNIQUE("notification_id","channel"),
	CONSTRAINT "notification_deliveries_kind" CHECK (kind in ('post.target_confirmed', 'post.confirmed', 'post.target_failed', 'post.target_problem', 'post.paused', 'post.file_wont_publish', 'account.quota_low', 'account.token_invalid', 'account.unhealthy', 'meta.reminder', 'system.worker_down', 'system.worker_up', 'system.backup_failed')),
	CONSTRAINT "notification_deliveries_channel" CHECK (channel in ('panel', 'telegram', 'email')),
	CONSTRAINT "notification_deliveries_status" CHECK (status in ('pending', 'sending', 'sent', 'failed', 'skipped')),
	CONSTRAINT "notification_deliveries_attempts" CHECK ("notification_deliveries"."attempts" >= 0),
	CONSTRAINT "notification_deliveries_claim" CHECK ("notification_deliveries"."status" <> 'sending' or "notification_deliveries"."claimed_until" is not null)
);
--> statement-breakpoint
CREATE TABLE "notification_prefs" (
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"channels" text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_prefs_pk" PRIMARY KEY("user_id","kind"),
	CONSTRAINT "notification_prefs_kind" CHECK (kind in ('post.target_confirmed', 'post.confirmed', 'post.target_failed', 'post.target_problem', 'post.paused', 'post.file_wont_publish', 'account.quota_low', 'account.token_invalid', 'account.unhealthy', 'meta.reminder', 'system.worker_down', 'system.worker_up', 'system.backup_failed')),
	CONSTRAINT "notification_prefs_channels" CHECK (channels <@ array['panel', 'telegram', 'email']::text[])
);
--> statement-breakpoint
CREATE TABLE "notification_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"min_level" text DEFAULT 'info' NOT NULL,
	"quiet_start" text,
	"quiet_end" text,
	"digest_enabled" boolean DEFAULT true NOT NULL,
	"digest_time" text DEFAULT '08:00' NOT NULL,
	"digest_days" smallint[] DEFAULT '{1,2,3,4,5,6,7}' NOT NULL,
	"everything_everywhere" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_settings_min_level" CHECK (min_level in ('info', 'success', 'warning', 'error', 'critical', 'security')),
	CONSTRAINT "notification_settings_quiet" CHECK (("notification_settings"."quiet_start" is null) = ("notification_settings"."quiet_end" is null)
          and ("notification_settings"."quiet_start" is null or ("notification_settings"."quiet_start" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' and "notification_settings"."quiet_end" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'))),
	CONSTRAINT "notification_settings_digest_time" CHECK ("notification_settings"."digest_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
	CONSTRAINT "notification_settings_digest_days" CHECK ("notification_settings"."digest_days" <@ '{1,2,3,4,5,6,7}'::smallint[])
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid,
	"user_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"level" text NOT NULL,
	"workspace_id" uuid,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_user_event" UNIQUE("user_id","event_id"),
	CONSTRAINT "notifications_kind" CHECK (kind in ('post.target_confirmed', 'post.confirmed', 'post.target_failed', 'post.target_problem', 'post.paused', 'post.file_wont_publish', 'account.quota_low', 'account.token_invalid', 'account.unhealthy', 'meta.reminder', 'system.worker_down', 'system.worker_up', 'system.backup_failed')),
	CONSTRAINT "notifications_level" CHECK (level in ('info', 'success', 'warning', 'error', 'critical', 'security'))
);
--> statement-breakpoint
CREATE TABLE "system_heartbeats" (
	"process" text NOT NULL,
	"instance" text NOT NULL,
	"last_beat_at" timestamp with time zone NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "system_heartbeats_pk" PRIMARY KEY("process","instance")
);
--> statement-breakpoint
CREATE TABLE "telegram_links" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid,
	"user_id" uuid NOT NULL,
	"chat_id" bigint,
	"linked_at" timestamp with time zone,
	"link_code_hash" text,
	"link_code_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "telegram_links_bot_user" UNIQUE NULLS NOT DISTINCT("organization_id","user_id"),
	CONSTRAINT "telegram_links_code" CHECK (("telegram_links"."link_code_hash" is null) = ("telegram_links"."link_code_expires_at" is null)),
	CONSTRAINT "telegram_links_linked" CHECK (("telegram_links"."chat_id" is null) = ("telegram_links"."linked_at" is null))
);
--> statement-breakpoint
ALTER TABLE "integrations" DROP CONSTRAINT "integrations_kind";--> statement-breakpoint
ALTER TABLE "outbox_events" DROP CONSTRAINT "outbox_events_type";--> statement-breakpoint
ALTER TABLE "integrations" ADD COLUMN "state" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD COLUMN "dedupe_key" text;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_notification_id_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."notifications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_prefs" ADD CONSTRAINT "notification_prefs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_settings" ADD CONSTRAINT "notification_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_links" ADD CONSTRAINT "telegram_links_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_links" ADD CONSTRAINT "telegram_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notification_deliveries_group_idx" ON "notification_deliveries" USING btree ("user_id","organization_id","channel","kind","created_at") WHERE "notification_deliveries"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "notification_deliveries_due_idx" ON "notification_deliveries" USING btree ("next_attempt_at") WHERE "notification_deliveries"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "notification_deliveries_claimed_idx" ON "notification_deliveries" USING btree ("claimed_until") WHERE "notification_deliveries"."status" = 'sending';--> statement-breakpoint
CREATE INDEX "notification_deliveries_organization_idx" ON "notification_deliveries" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "notifications_user_unread_idx" ON "notifications" USING btree ("user_id","created_at") WHERE "notifications"."read_at" is null;--> statement-breakpoint
CREATE INDEX "notifications_organization_idx" ON "notifications" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "system_heartbeats_last_beat_idx" ON "system_heartbeats" USING btree ("last_beat_at");--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_links_code_idx" ON "telegram_links" USING btree ("link_code_hash") WHERE "telegram_links"."link_code_hash" is not null;--> statement-breakpoint
CREATE INDEX "telegram_links_user_idx" ON "telegram_links" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "telegram_links_organization_chat_idx" ON "telegram_links" USING btree ("organization_id","chat_id");--> statement-breakpoint
CREATE UNIQUE INDEX "outbox_events_dedupe_idx" ON "outbox_events" USING btree ("dedupe_key") WHERE "outbox_events"."dedupe_key" is not null;--> statement-breakpoint
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_heartbeat_platform_only" CHECK ("integrations"."kind" <> 'heartbeat' or "integrations"."organization_id" is null);--> statement-breakpoint
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_kind" CHECK (kind in ('smtp', 'meta', 'telegram', 'heartbeat'));--> statement-breakpoint
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_type" CHECK (type in ('post.target_confirmed', 'post.confirmed', 'post.target_failed', 'post.target_problem', 'post.paused', 'post.file_wont_publish', 'account.quota_low', 'account.token_invalid', 'account.unhealthy', 'meta.reminder', 'system.worker_down', 'system.worker_up', 'system.backup_failed'));--> statement-breakpoint
-- Hand-written from here (drizzle-kit does not manage row level security). Plan 08, «Isolamento».
-- notifications and their deliveries: an agency's rows in its scope (the dispatcher, the
-- delivery job), all in the system scope; an event of the platform (organization null) matches
-- no agency.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['notifications', 'notification_deliveries'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$
      CREATE POLICY org_isolation ON %I
        USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid
               OR current_setting('app.scope', true) = 'system')
        WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid
               OR current_setting('app.scope', true) = 'system')$p$, t);
    -- P6: the person's own scope (no agency set) reads their rows of the agencies where they
    -- are an active member, and of the platform; never inside an agency's scope, which would
    -- otherwise show the person's rows of another agency
    EXECUTE format($p$
      CREATE POLICY own_read ON %I FOR SELECT
        USING (nullif(current_setting('app.organization_id', true), '') IS NULL
               AND user_id = nullif(current_setting('app.user_id', true), '')::uuid
               AND (organization_id IS NULL
                    OR organization_id IN (SELECT organization_id FROM organization_members
                       WHERE user_id = nullif(current_setting('app.user_id', true), '')::uuid
                         AND status = 'active')))$p$, t);
  END LOOP;
END $$;--> statement-breakpoint
-- «segna come letta» (Task 6): the same rows, in the person's scope
CREATE POLICY own_update ON notifications FOR UPDATE
  USING (nullif(current_setting('app.organization_id', true), '') IS NULL
         AND user_id = nullif(current_setting('app.user_id', true), '')::uuid
         AND (organization_id IS NULL
              OR organization_id IN (SELECT organization_id FROM organization_members
                 WHERE user_id = nullif(current_setting('app.user_id', true), '')::uuid
                   AND status = 'active')))
  WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
-- A person's preferences and settings: their own, in any scope of theirs, and the system's.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['notification_prefs', 'notification_settings'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$
      CREATE POLICY own_rows ON %I
        USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid
               OR current_setting('app.scope', true) = 'system')
        WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '')::uuid
               OR current_setting('app.scope', true) = 'system')$p$, t);
  END LOOP;
END $$;--> statement-breakpoint
-- A person's Telegram links: the platform bot's, the current agency's, or, in the person's own
-- scope, those of an agency where they are an active member. The bots of every agency are the
-- system's (`telegram.poll`).
ALTER TABLE "telegram_links" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "telegram_links" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY own_links ON telegram_links
  USING (current_setting('app.scope', true) = 'system'
         OR (user_id = nullif(current_setting('app.user_id', true), '')::uuid
             AND (organization_id IS NULL
                  OR organization_id = nullif(current_setting('app.organization_id', true), '')::uuid
                  OR (nullif(current_setting('app.organization_id', true), '') IS NULL
                      AND organization_id IN (SELECT organization_id FROM organization_members
                         WHERE user_id = nullif(current_setting('app.user_id', true), '')::uuid
                           AND status = 'active')))))
  WITH CHECK (current_setting('app.scope', true) = 'system'
         OR (user_id = nullif(current_setting('app.user_id', true), '')::uuid
             AND (organization_id IS NULL
                  OR organization_id = nullif(current_setting('app.organization_id', true), '')::uuid
                  OR (nullif(current_setting('app.organization_id', true), '') IS NULL
                      AND organization_id IN (SELECT organization_id FROM organization_members
                         WHERE user_id = nullif(current_setting('app.user_id', true), '')::uuid
                           AND status = 'active')))));--> statement-breakpoint
-- D-116, plan 08 Scelta 3: the events waiting since 0.13.0 that are older than 6 hours are
-- marked as sent without notifications, so an update does not bring a burst of old news; the
-- newer ones are sent. The outbox forces row level security: the system scope, for this
-- transaction only, cleared at the end.
SELECT set_config('app.scope', 'system', true);--> statement-breakpoint
UPDATE outbox_events SET dispatched_at = now(), updated_at = now()
 WHERE dispatched_at IS NULL AND created_at < now() - interval '6 hours';--> statement-breakpoint
SELECT set_config('app.scope', '', true);
