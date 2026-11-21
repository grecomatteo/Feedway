ALTER TABLE "social_accounts" ADD COLUMN "quota_low_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "social_accounts" ADD COLUMN "usage_account_percent" integer;--> statement-breakpoint
ALTER TABLE "social_accounts" ADD COLUMN "usage_app_percent" integer;--> statement-breakpoint
ALTER TABLE "social_accounts" ADD COLUMN "usage_regain_minutes" integer;--> statement-breakpoint
ALTER TABLE "social_accounts" ADD COLUMN "usage_read_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "post_targets" ADD COLUMN "recheck_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "social_accounts_usage_idx" ON "social_accounts" USING btree ("organization_id","usage_read_at") WHERE "social_accounts"."usage_app_percent" is not null;--> statement-breakpoint
CREATE INDEX "post_targets_recheck_idx" ON "post_targets" USING btree ("recheck_at") WHERE "post_targets"."recheck_at" is not null;--> statement-breakpoint
-- plan 07 Task 7, Scelta 4: the destinations scheduled already are checked again 3 hours before
-- their post, or at once when fewer are left
-- row level security is forced on these tables, the owner too: only the system scope sees
-- every agency's rows (as in 0019), and it is cleared after the update (review of stage 7, R1)
SELECT set_config('app.scope', 'system', true);--> statement-breakpoint
UPDATE "post_targets" AS t
   SET "recheck_at" = greatest(p."scheduled_at" - interval '3 hours', now())
  FROM "posts" AS p
 WHERE p."organization_id" = t."organization_id"
   AND p."id" = t."post_id"
   AND t."status" = 'scheduled'
   AND p."scheduled_at" IS NOT NULL;--> statement-breakpoint
SELECT set_config('app.scope', '', true);
