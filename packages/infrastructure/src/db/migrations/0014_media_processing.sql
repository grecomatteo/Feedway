ALTER TABLE "media" ADD COLUMN "failure" jsonb;--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "checks" jsonb;--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "processing_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "processing_started_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "media_processing_idx" ON "media" USING btree ("organization_id","created_at","id") WHERE "media"."status" = 'processing';--> statement-breakpoint
CREATE INDEX "media_processing_started_idx" ON "media" USING btree ("organization_id","processing_started_at");--> statement-breakpoint
-- the files the web failed before this migration: no type Feedway takes
UPDATE "media" SET "failure" = '{"code":"unsupported_type"}'::jsonb WHERE "status" = 'failed' AND "failure" IS NULL;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_failure" CHECK ("media"."status" <> 'failed' or "media"."failure" is not null);--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_processing_attempts" CHECK ("media"."processing_attempts" >= 0);