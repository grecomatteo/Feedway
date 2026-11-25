CREATE TABLE "bulk_imports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"source" text NOT NULL,
	"rows" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "bulk_imports_source" CHECK (source in ('files', 'csv', 'duplicate')),
	CONSTRAINT "bulk_imports_status" CHECK (status in ('pending', 'running', 'done', 'undone')),
	CONSTRAINT "bulk_imports_rows" CHECK (jsonb_typeof("bulk_imports"."rows") = 'array'),
	CONSTRAINT "bulk_imports_finished" CHECK (("bulk_imports"."status" in ('done', 'undone')) = ("bulk_imports"."finished_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "outbox_events" DROP CONSTRAINT "outbox_events_type";--> statement-breakpoint
ALTER TABLE "notification_deliveries" DROP CONSTRAINT "notification_deliveries_kind";--> statement-breakpoint
ALTER TABLE "notification_prefs" DROP CONSTRAINT "notification_prefs_kind";--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_kind";--> statement-breakpoint
ALTER TABLE "bulk_imports" ADD CONSTRAINT "bulk_imports_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bulk_imports" ADD CONSTRAINT "bulk_imports_workspace_fk" FOREIGN KEY ("organization_id","workspace_id") REFERENCES "public"."workspaces"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bulk_imports_workspace_idx" ON "bulk_imports" USING btree ("organization_id","workspace_id","created_at");--> statement-breakpoint
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_type" CHECK (type in ('post.target_confirmed', 'post.confirmed', 'post.target_failed', 'post.target_problem', 'post.paused', 'post.file_wont_publish', 'account.quota_low', 'account.token_invalid', 'account.unhealthy', 'meta.reminder', 'system.worker_down', 'system.worker_up', 'system.backup_failed', 'plan.due_soon', 'bulk.completed'));--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_kind" CHECK (kind in ('post.target_confirmed', 'post.confirmed', 'post.target_failed', 'post.target_problem', 'post.paused', 'post.file_wont_publish', 'account.quota_low', 'account.token_invalid', 'account.unhealthy', 'meta.reminder', 'system.worker_down', 'system.worker_up', 'system.backup_failed', 'plan.due_soon', 'bulk.completed'));--> statement-breakpoint
ALTER TABLE "notification_prefs" ADD CONSTRAINT "notification_prefs_kind" CHECK (kind in ('post.target_confirmed', 'post.confirmed', 'post.target_failed', 'post.target_problem', 'post.paused', 'post.file_wont_publish', 'account.quota_low', 'account.token_invalid', 'account.unhealthy', 'meta.reminder', 'system.worker_down', 'system.worker_up', 'system.backup_failed', 'plan.due_soon', 'bulk.completed'));--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_kind" CHECK (kind in ('post.target_confirmed', 'post.confirmed', 'post.target_failed', 'post.target_problem', 'post.paused', 'post.file_wont_publish', 'account.quota_low', 'account.token_invalid', 'account.unhealthy', 'meta.reminder', 'system.worker_down', 'system.worker_up', 'system.backup_failed', 'plan.due_soon', 'bulk.completed'));--> statement-breakpoint
-- Hand-written from here (drizzle-kit does not manage row level security). Plan 09 Task 10.
ALTER TABLE "bulk_imports" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bulk_imports" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY org_isolation ON "bulk_imports"
  USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid
         OR current_setting('app.scope', true) = 'system')
  WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid
         OR current_setting('app.scope', true) = 'system');
