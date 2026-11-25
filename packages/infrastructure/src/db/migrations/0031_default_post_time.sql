ALTER TABLE "workspaces" ALTER COLUMN "default_post_time" SET DEFAULT '14:00';--> statement-breakpoint
-- every client without a usual time gets 14:00 too (Matteo, 25/11); RLS is forced, as in 0019
SELECT set_config('app.scope', 'system', true);--> statement-breakpoint
UPDATE "workspaces" SET "default_post_time" = '14:00', "updated_at" = now() WHERE "default_post_time" IS NULL;--> statement-breakpoint
SELECT set_config('app.scope', '', true);
