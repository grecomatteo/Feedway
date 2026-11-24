CREATE TABLE "plan_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"local_date" date NOT NULL,
	"local_time" time,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"post_id" uuid,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_items_type" CHECK (type in ('photo', 'carousel', 'reel', 'story')),
	CONSTRAINT "plan_items_title" CHECK (char_length(title) between 1 and 80),
	CONSTRAINT "plan_items_version" CHECK ("plan_items"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "plan_items" ADD CONSTRAINT "plan_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_items" ADD CONSTRAINT "plan_items_workspace_fk" FOREIGN KEY ("organization_id","workspace_id") REFERENCES "public"."workspaces"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "plan_items_workspace_day_idx" ON "plan_items" USING btree ("organization_id","workspace_id","local_date");--> statement-breakpoint
CREATE UNIQUE INDEX "plan_items_post_idx" ON "plan_items" USING btree ("organization_id","post_id") WHERE "plan_items"."post_id" is not null;--> statement-breakpoint
-- Hand-written from here (drizzle-kit has no column list for SET NULL and does not manage row
-- level security). Plan 09 Task 5.
-- The one reference between modules (§11.12): the post of the same client; a deleted post frees
-- the content (rule 5) and leaves `organization_id` and `workspace_id` as they are.
ALTER TABLE "plan_items" ADD CONSTRAINT "plan_items_post_fk"
  FOREIGN KEY ("organization_id", "workspace_id", "post_id")
  REFERENCES "public"."posts"("organization_id", "workspace_id", "id")
  ON DELETE SET NULL ("post_id");--> statement-breakpoint
ALTER TABLE "plan_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "plan_items" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY org_isolation ON "plan_items"
  USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid
         OR current_setting('app.scope', true) = 'system')
  WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid
         OR current_setting('app.scope', true) = 'system');
