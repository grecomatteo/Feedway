CREATE TABLE "time_slots" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"weekday" smallint NOT NULL,
	"local_time" time NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "time_slots_weekday" CHECK ("time_slots"."weekday" between 1 and 7),
	CONSTRAINT "time_slots_local_time" CHECK ("time_slots"."local_time" < '24:00' and date_trunc('minute', "time_slots"."local_time") = "time_slots"."local_time")
);
--> statement-breakpoint
ALTER TABLE "time_slots" ADD CONSTRAINT "time_slots_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_slots" ADD CONSTRAINT "time_slots_workspace_fk" FOREIGN KEY ("organization_id","workspace_id") REFERENCES "public"."workspaces"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "time_slots_workspace_slot_idx" ON "time_slots" USING btree ("organization_id","workspace_id","weekday","local_time");--> statement-breakpoint
-- Hand-written from here (drizzle-kit does not manage row level security). Plan 09 Task 9.
ALTER TABLE "time_slots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "time_slots" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY org_isolation ON "time_slots"
  USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid
         OR current_setting('app.scope', true) = 'system')
  WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid
         OR current_setting('app.scope', true) = 'system');
