ALTER TABLE "workspaces" ADD COLUMN "draft_retention_days" smallint DEFAULT 30;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "trashed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "trashed_by" uuid;--> statement-breakpoint
CREATE INDEX "posts_trashed_idx" ON "posts" USING btree ("organization_id","trashed_at") WHERE "posts"."trashed_at" is not null;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_draft_retention_days" CHECK ("workspaces"."draft_retention_days" is null or "workspaces"."draft_retention_days" in (30, 60, 90));--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_trashed_status" CHECK ("posts"."trashed_at" is null or "posts"."status" in ('draft', 'cancelled'));