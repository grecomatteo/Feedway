ALTER TABLE "integrations" DROP CONSTRAINT "integrations_kind";--> statement-breakpoint
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_meta_agency_only" CHECK ("integrations"."kind" <> 'meta' or "integrations"."organization_id" is not null);--> statement-breakpoint
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_kind" CHECK (kind in ('smtp', 'meta'));