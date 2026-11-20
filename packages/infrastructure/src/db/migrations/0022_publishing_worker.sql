ALTER TABLE "post_targets" ADD COLUMN "claimed_until" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "post_targets_claimed_idx" ON "post_targets" USING btree ("organization_id","account_id") WHERE "post_targets"."claimed_until" is not null;--> statement-breakpoint
-- plan 07 Task 7: the scheduled destinations already in the database get the time of their
-- preparation (`prepareAt`: 15 minutes before the post, or now), so the reconciler finds them
UPDATE "post_targets" AS t
   SET "next_attempt_at" = greatest(p."scheduled_at" - interval '15 minutes', now())
  FROM "posts" AS p
 WHERE p."organization_id" = t."organization_id"
   AND p."id" = t."post_id"
   AND t."status" = 'scheduled'
   AND t."next_attempt_at" IS NULL
   AND p."scheduled_at" IS NOT NULL;
