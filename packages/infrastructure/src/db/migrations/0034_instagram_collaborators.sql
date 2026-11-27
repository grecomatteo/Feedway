ALTER TABLE "post_targets" ADD COLUMN "collaborators" jsonb;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "instagram_collaborators" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_instagram_collaborators" CHECK (coalesce(array_length("posts"."instagram_collaborators", 1), 0) <= 10);