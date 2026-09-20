-- Non-destructive: three new tables (world_id → worlds ON DELETE CASCADE, indexed by the primary
-- key) and one column with a default. Existing worlds simply have no vassal relationships,
-- occupations or composite identities, and fusion_years = 0 on every relationship.
CREATE TABLE "composite_identities" (
	"world_id" uuid NOT NULL,
	"id" text NOT NULL,
	"seq" integer NOT NULL,
	"source_identity_ids" jsonb NOT NULL,
	"source_civilization_ids" jsonb NOT NULL,
	"member_key" text NOT NULL,
	"display_name" text NOT NULL,
	"singular_noun" text NOT NULL,
	"adjective" text NOT NULL,
	"adjective_feminine" text NOT NULL,
	"collective_name" text NOT NULL,
	"naming_profile" jsonb NOT NULL,
	"visual_profile" jsonb NOT NULL,
	"cultural_profile" jsonb NOT NULL,
	"created_at_tick" integer NOT NULL,
	"created_year" integer NOT NULL,
	"origin" text NOT NULL,
	"status" text NOT NULL,
	"civilization_id" text NOT NULL,
	"cause_event_id" text,
	CONSTRAINT "composite_identities_world_id_id_pk" PRIMARY KEY("world_id","id")
);
--> statement-breakpoint
CREATE TABLE "occupations" (
	"world_id" uuid NOT NULL,
	"id" text NOT NULL,
	"seq" integer NOT NULL,
	"occupying_civilization_id" text NOT NULL,
	"occupied_civilization_id" text,
	"occupied_settlement_id" text,
	"occupied_territory" jsonb NOT NULL,
	"started_at_tick" integer NOT NULL,
	"started_year" integer NOT NULL,
	"ended_at_tick" integer,
	"ended_year" integer,
	"occupation_policy" text NOT NULL,
	"resistance" double precision NOT NULL,
	"control" double precision NOT NULL,
	"status" text NOT NULL,
	"upkeep_paid" double precision DEFAULT 0 NOT NULL,
	"extracted" double precision DEFAULT 0 NOT NULL,
	"cause_event_id" text,
	CONSTRAINT "occupations_world_id_id_pk" PRIMARY KEY("world_id","id")
);
--> statement-breakpoint
CREATE TABLE "vassal_relationships" (
	"world_id" uuid NOT NULL,
	"id" text NOT NULL,
	"seq" integer NOT NULL,
	"overlord_civilization_id" text NOT NULL,
	"vassal_civilization_id" text NOT NULL,
	"started_at_tick" integer NOT NULL,
	"started_year" integer NOT NULL,
	"ended_at_tick" integer,
	"ended_year" integer,
	"tribute_policy" text NOT NULL,
	"autonomy" double precision NOT NULL,
	"military_obligation" double precision NOT NULL,
	"diplomatic_status" text NOT NULL,
	"end_reason" text,
	"total_tribute" double precision DEFAULT 0 NOT NULL,
	"last_tribute" double precision DEFAULT 0 NOT NULL,
	"cause_event_id" text,
	CONSTRAINT "vassal_relationships_world_id_id_pk" PRIMARY KEY("world_id","id")
);
--> statement-breakpoint
ALTER TABLE "relationships" ADD COLUMN "fusion_years" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "composite_identities" ADD CONSTRAINT "composite_identities_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "occupations" ADD CONSTRAINT "occupations_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vassal_relationships" ADD CONSTRAINT "vassal_relationships_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "composite_world_members_idx" ON "composite_identities" USING btree ("world_id","member_key");--> statement-breakpoint
CREATE INDEX "occupations_world_settlement_idx" ON "occupations" USING btree ("world_id","occupied_settlement_id");--> statement-breakpoint
CREATE INDEX "occupations_world_occupier_idx" ON "occupations" USING btree ("world_id","occupying_civilization_id");--> statement-breakpoint
CREATE INDEX "vassal_world_vassal_idx" ON "vassal_relationships" USING btree ("world_id","vassal_civilization_id");--> statement-breakpoint
CREATE INDEX "vassal_world_overlord_idx" ON "vassal_relationships" USING btree ("world_id","overlord_civilization_id");