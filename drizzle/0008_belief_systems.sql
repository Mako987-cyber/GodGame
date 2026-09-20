CREATE TABLE "belief_systems" (
	"world_id" uuid NOT NULL,
	"id" text NOT NULL,
	"seq" integer NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"founded_by_tribe_id" text NOT NULL,
	"principles" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"authority" double precision NOT NULL,
	"tolerance" double precision NOT NULL,
	"missionary_pressure" double precision NOT NULL,
	"cohesion_effect" double precision NOT NULL,
	"legitimacy_effect" double precision NOT NULL,
	"conflict_risk" double precision NOT NULL,
	"created_at_tick" integer NOT NULL,
	"created_year" integer NOT NULL,
	"parent_belief_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"ended_year" integer,
	"cause_event_id" text,
	CONSTRAINT "belief_systems_world_id_id_pk" PRIMARY KEY("world_id","id")
);
--> statement-breakpoint
ALTER TABLE "tribes" ADD COLUMN "belief_system_id" text;--> statement-breakpoint
ALTER TABLE "tribes" ADD COLUMN "belief_adherence" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "belief_systems" ADD CONSTRAINT "belief_systems_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "beliefs_world_status_idx" ON "belief_systems" USING btree ("world_id","status");--> statement-breakpoint
CREATE INDEX "beliefs_world_founder_idx" ON "belief_systems" USING btree ("world_id","founded_by_tribe_id");