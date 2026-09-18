CREATE TABLE "civilization_stats" (
	"world_id" uuid NOT NULL,
	"civilization_id" text NOT NULL,
	"tick" integer NOT NULL,
	"year" integer NOT NULL,
	"population" integer NOT NULL,
	"settlements" integer NOT NULL,
	"technologies" integer NOT NULL,
	"food_stored" double precision NOT NULL,
	"wealth" double precision NOT NULL,
	"territory" integer NOT NULL,
	"stability" double precision NOT NULL,
	"at_war" boolean NOT NULL,
	CONSTRAINT "civilization_stats_world_id_civilization_id_tick_pk" PRIMARY KEY("world_id","civilization_id","tick")
);
--> statement-breakpoint
CREATE TABLE "dynasties" (
	"world_id" uuid NOT NULL,
	"id" text NOT NULL,
	"seq" integer NOT NULL,
	"name" text NOT NULL,
	"tribe_id" text NOT NULL,
	"founder_id" text NOT NULL,
	"founded_year" integer NOT NULL,
	"ended_year" integer,
	"prestige" double precision NOT NULL,
	"rulers" integer NOT NULL,
	CONSTRAINT "dynasties_world_id_id_pk" PRIMARY KEY("world_id","id")
);
--> statement-breakpoint
ALTER TABLE "historical_events" ADD COLUMN "subtype" text;--> statement-breakpoint
ALTER TABLE "historical_events" ADD COLUMN "cause_event_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "prestige" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "education" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "wealth" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "birth_settlement_id" text;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "dynasty_id" text;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "title" text;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "title_since_year" integer;--> statement-breakpoint
ALTER TABLE "relationships" ADD COLUMN "respect" double precision DEFAULT 0.1 NOT NULL;--> statement-breakpoint
ALTER TABLE "relationships" ADD COLUMN "trade_dependency" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "relationships" ADD COLUMN "cultural_distance" double precision DEFAULT 0.3 NOT NULL;--> statement-breakpoint
ALTER TABLE "relationships" ADD COLUMN "status" text DEFAULT 'contact' NOT NULL;--> statement-breakpoint
ALTER TABLE "relationships" ADD COLUMN "phase" text DEFAULT 'peace' NOT NULL;--> statement-breakpoint
ALTER TABLE "relationships" ADD COLUMN "last_conflict_year" integer;--> statement-breakpoint
ALTER TABLE "relationships" ADD COLUMN "phase_years" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "settlements" ADD COLUMN "goods" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "settlements" ADD COLUMN "tier" text;--> statement-breakpoint
ALTER TABLE "settlements" ADD COLUMN "hygiene" double precision DEFAULT 0.8 NOT NULL;--> statement-breakpoint
ALTER TABLE "settlements" ADD COLUMN "unrest" double precision DEFAULT 0.05 NOT NULL;--> statement-breakpoint
ALTER TABLE "settlements" ADD COLUMN "influence" double precision DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "settlements" ADD COLUMN "founder_id" text;--> statement-breakpoint
ALTER TABLE "settlements" ADD COLUMN "last_epidemic_year" integer;--> statement-breakpoint
ALTER TABLE "tribes" ADD COLUMN "goods" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "tribes" ADD COLUMN "tech_adoption" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "tribes" ADD COLUMN "culture" jsonb;--> statement-breakpoint
ALTER TABLE "tribes" ADD COLUMN "government" text;--> statement-breakpoint
ALTER TABLE "tribes" ADD COLUMN "stability" jsonb;--> statement-breakpoint
ALTER TABLE "tribes" ADD COLUMN "distribution" text;--> statement-breakpoint
ALTER TABLE "tribes" ADD COLUMN "dynasty_id" text;--> statement-breakpoint
ALTER TABLE "tribes" ADD COLUMN "last_leader_change_year" integer;--> statement-breakpoint
ALTER TABLE "world_cells" ADD COLUMN "clay" double precision;--> statement-breakpoint
ALTER TABLE "world_cells" ADD COLUMN "tin" double precision;--> statement-breakpoint
ALTER TABLE "world_cells" ADD COLUMN "coal" double precision;--> statement-breakpoint
ALTER TABLE "world_cells" ADD COLUMN "pastures" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "world_stats" ADD COLUMN "epidemic_deaths" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "world_stats" ADD COLUMN "food_surplus" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "world_stats" ADD COLUMN "storage_capacity" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "world_stats" ADD COLUMN "goods_produced" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "world_stats" ADD COLUMN "trade_volume" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "world_stats" ADD COLUMN "wealth" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "world_stats" ADD COLUMN "buildings" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "world_stats" ADD COLUMN "territory" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "world_stats" ADD COLUMN "average_temperature" double precision DEFAULT 0.5 NOT NULL;--> statement-breakpoint
ALTER TABLE "world_stats" ADD COLUMN "climate_stress" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "world_stats" ADD COLUMN "average_stability" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "world_stats" ADD COLUMN "migrations" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "world_stats" ADD COLUMN "season" text DEFAULT 'winter' NOT NULL;--> statement-breakpoint
ALTER TABLE "worlds" ADD COLUMN "simulation_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "worlds" ADD COLUMN "config" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "worlds" ADD COLUMN "crises" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "civilization_stats" ADD CONSTRAINT "civilization_stats_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dynasties" ADD CONSTRAINT "dynasties_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "civ_stats_world_tick_idx" ON "civilization_stats" USING btree ("world_id","tick");--> statement-breakpoint
CREATE INDEX "dynasties_tribe_idx" ON "dynasties" USING btree ("world_id","tribe_id");--> statement-breakpoint
CREATE INDEX "people_notable_idx" ON "people" USING btree ("world_id","prestige") WHERE "people"."notable";