ALTER TABLE "media_variants" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "media_variants" ADD COLUMN "started_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "media_variants_pending_idx" ON "media_variants" USING btree ("created_at") WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX "media_variants_started_idx" ON "media_variants" USING btree ("organization_id","started_at");--> statement-breakpoint
ALTER TABLE "media_variants" ADD CONSTRAINT "media_variants_attempts" CHECK ("media_variants"."attempts" >= 0);