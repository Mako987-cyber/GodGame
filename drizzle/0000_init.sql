CREATE TABLE "civilizations" (
	"world_id" uuid NOT NULL,
	"id" text NOT NULL,
	"seq" integer NOT NULL,
	"name" text NOT NULL,
	"color" text NOT NULL,
	"founder_tribe_id" text NOT NULL,
	"capital_settlement_id" text,
	"founded_year" integer NOT NULL,
	"status" text NOT NULL,
	CONSTRAINT "civilizations_world_id_id_pk" PRIMARY KEY("world_id","id")
);
--> statement-breakpoint
CREATE TABLE "historical_events" (
	"world_id" uuid NOT NULL,
	"id" text NOT NULL,
	"seq" integer NOT NULL,
	"tick" integer NOT NULL,
	"year" integer NOT NULL,
	"type" text NOT NULL,
	"importance" integer NOT NULL,
	"actors" jsonb NOT NULL,
	"x" integer,
	"y" integer,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"metadata" jsonb NOT NULL,
	CONSTRAINT "historical_events_world_id_id_pk" PRIMARY KEY("world_id","id")
);
--> statement-breakpoint
CREATE TABLE "households" (
	"world_id" uuid NOT NULL,
	"id" text NOT NULL,
	"seq" integer NOT NULL,
	"tribe_id" text NOT NULL,
	"partner_a_id" text NOT NULL,
	"partner_b_id" text NOT NULL,
	"formed_year" integer NOT NULL,
	"dissolved_year" integer,
	CONSTRAINT "households_world_id_id_pk" PRIMARY KEY("world_id","id")
);
--> statement-breakpoint
CREATE TABLE "people" (
	"world_id" uuid NOT NULL,
	"id" text NOT NULL,
	"seq" integer NOT NULL,
	"name" text NOT NULL,
	"tribe_id" text NOT NULL,
	"settlement_id" text,
	"household_id" text,
	"mother_id" text,
	"father_id" text,
	"birth_year" integer NOT NULL,
	"age" integer NOT NULL,
	"sex" text NOT NULL,
	"health" double precision NOT NULL,
	"hunger" double precision NOT NULL,
	"energy" double precision NOT NULL,
	"x" integer NOT NULL,
	"y" integer NOT NULL,
	"role" text NOT NULL,
	"action" text NOT NULL,
	"skills" jsonb NOT NULL,
	"personality" jsonb NOT NULL,
	"alive" boolean NOT NULL,
	"death_year" integer,
	"death_cause" text,
	"knowledge" jsonb NOT NULL,
	"last_child_year" integer,
	"notable" boolean NOT NULL,
	CONSTRAINT "people_world_id_id_pk" PRIMARY KEY("world_id","id")
);
--> statement-breakpoint
CREATE TABLE "relationships" (
	"world_id" uuid NOT NULL,
	"id" text NOT NULL,
	"a_id" text NOT NULL,
	"b_id" text NOT NULL,
	"trust" double precision NOT NULL,
	"hostility" double precision NOT NULL,
	"trade_volume" double precision NOT NULL,
	"conflict_memory" double precision NOT NULL,
	"at_war" boolean NOT NULL,
	"war_start_year" integer,
	"allied" boolean NOT NULL,
	"distance" integer NOT NULL,
	"last_interaction_year" integer NOT NULL,
	"battles" integer NOT NULL,
	"truce_until_year" integer,
	CONSTRAINT "relationships_world_id_id_pk" PRIMARY KEY("world_id","id")
);
--> statement-breakpoint
CREATE TABLE "settlements" (
	"world_id" uuid NOT NULL,
	"id" text NOT NULL,
	"seq" integer NOT NULL,
	"name" text NOT NULL,
	"tribe_id" text NOT NULL,
	"civilization_id" text,
	"x" integer NOT NULL,
	"y" integer NOT NULL,
	"level" integer NOT NULL,
	"status" text NOT NULL,
	"founded_year" integer NOT NULL,
	"abandoned_year" integer,
	"food" double precision NOT NULL,
	"wood" double precision NOT NULL,
	"stone" double precision NOT NULL,
	"copper" double precision NOT NULL,
	"buildings" jsonb NOT NULL,
	"construction" jsonb,
	"defense" double precision NOT NULL,
	"territory_radius" integer NOT NULL,
	"famine_years" integer NOT NULL,
	"road_links" jsonb NOT NULL,
	"last_production" jsonb NOT NULL,
	"last_food_ratio" double precision NOT NULL,
	"population" integer NOT NULL,
	CONSTRAINT "settlements_world_id_id_pk" PRIMARY KEY("world_id","id")
);
--> statement-breakpoint
CREATE TABLE "simulation_locks" (
	"world_id" uuid PRIMARY KEY NOT NULL,
	"token" uuid NOT NULL,
	"locked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "simulation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"world_id" uuid NOT NULL,
	"from_tick" integer NOT NULL,
	"to_tick" integer NOT NULL,
	"requested_ticks" integer NOT NULL,
	"ticks_run" integer NOT NULL,
	"duration_ms" integer NOT NULL,
	"status" text NOT NULL,
	"events_count" integer NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "technologies" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"prerequisites" jsonb NOT NULL,
	"cost" integer NOT NULL,
	"min_population" integer NOT NULL,
	"requires_settlement" boolean NOT NULL,
	"resource_requirement" text NOT NULL,
	"geography_requirement" text,
	"effects" jsonb NOT NULL,
	"effect_summary" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tribes" (
	"world_id" uuid NOT NULL,
	"id" text NOT NULL,
	"seq" integer NOT NULL,
	"name" text NOT NULL,
	"color" text NOT NULL,
	"status" text NOT NULL,
	"x" integer NOT NULL,
	"y" integer NOT NULL,
	"food" double precision NOT NULL,
	"wood" double precision NOT NULL,
	"stone" double precision NOT NULL,
	"copper" double precision NOT NULL,
	"techs" jsonb NOT NULL,
	"tech_progress" jsonb NOT NULL,
	"years_at_location" integer NOT NULL,
	"scarcity_years" integer NOT NULL,
	"founded_year" integer NOT NULL,
	"extinct_year" integer,
	"civilization_id" text,
	"leader_id" text,
	"parent_tribe_id" text,
	"morale" double precision NOT NULL,
	"population_milestone" integer NOT NULL,
	"last_food_produced" double precision NOT NULL,
	"last_food_consumed" double precision NOT NULL,
	"last_food_ratio" double precision NOT NULL,
	CONSTRAINT "tribes_world_id_id_pk" PRIMARY KEY("world_id","id")
);
--> statement-breakpoint
CREATE TABLE "world_cells" (
	"world_id" uuid NOT NULL,
	"x" integer NOT NULL,
	"y" integer NOT NULL,
	"altitude" double precision NOT NULL,
	"moisture" double precision NOT NULL,
	"temperature" double precision NOT NULL,
	"biome" text NOT NULL,
	"fertility" double precision NOT NULL,
	"base_fertility" double precision NOT NULL,
	"water" double precision NOT NULL,
	"wood" double precision NOT NULL,
	"max_wood" double precision NOT NULL,
	"stone" double precision NOT NULL,
	"fauna" double precision NOT NULL,
	"max_fauna" double precision NOT NULL,
	"copper" double precision NOT NULL,
	"iron" double precision NOT NULL,
	"habitability" double precision NOT NULL,
	"river" boolean NOT NULL,
	"river_name" text,
	"coastal" boolean NOT NULL,
	"owner_tribe_id" text,
	"settlement_id" text,
	"road" boolean NOT NULL,
	"fields" integer NOT NULL,
	CONSTRAINT "world_cells_world_id_y_x_pk" PRIMARY KEY("world_id","y","x")
);
--> statement-breakpoint
CREATE TABLE "world_snapshots" (
	"world_id" uuid NOT NULL,
	"tick" integer NOT NULL,
	"year" integer NOT NULL,
	"state_version" integer NOT NULL,
	"state" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "world_snapshots_world_id_tick_pk" PRIMARY KEY("world_id","tick")
);
--> statement-breakpoint
CREATE TABLE "world_stats" (
	"world_id" uuid NOT NULL,
	"tick" integer NOT NULL,
	"year" integer NOT NULL,
	"population" integer NOT NULL,
	"tribes" integer NOT NULL,
	"settlements" integer NOT NULL,
	"civilizations" integer NOT NULL,
	"food_produced" double precision NOT NULL,
	"food_consumed" double precision NOT NULL,
	"food_stored" double precision NOT NULL,
	"technologies" integer NOT NULL,
	"wars" integer NOT NULL,
	"battles" integer NOT NULL,
	"births" integer NOT NULL,
	"deaths" integer NOT NULL,
	"starvation_deaths" integer NOT NULL,
	"conflict_deaths" integer NOT NULL,
	CONSTRAINT "world_stats_world_id_tick_pk" PRIMARY KEY("world_id","tick")
);
--> statement-breakpoint
CREATE TABLE "world_technologies" (
	"world_id" uuid NOT NULL,
	"tribe_id" text NOT NULL,
	"tech_id" text NOT NULL,
	"discovered_year" integer NOT NULL,
	"discovered_tick" integer NOT NULL,
	"method" text NOT NULL,
	CONSTRAINT "world_technologies_world_id_tribe_id_tech_id_pk" PRIMARY KEY("world_id","tribe_id","tech_id")
);
--> statement-breakpoint
CREATE TABLE "worlds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"seed" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"current_tick" integer DEFAULT 0 NOT NULL,
	"current_year" integer NOT NULL,
	"status" text DEFAULT 'paused' NOT NULL,
	"rng_state" jsonb NOT NULL,
	"settings" jsonb NOT NULL,
	"counters" jsonb NOT NULL,
	"climate" jsonb NOT NULL,
	"summary" jsonb NOT NULL,
	"owner_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "civilizations" ADD CONSTRAINT "civilizations_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "historical_events" ADD CONSTRAINT "historical_events_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "households" ADD CONSTRAINT "households_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationships" ADD CONSTRAINT "relationships_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "simulation_locks" ADD CONSTRAINT "simulation_locks_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "simulation_runs" ADD CONSTRAINT "simulation_runs_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tribes" ADD CONSTRAINT "tribes_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "world_cells" ADD CONSTRAINT "world_cells_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "world_snapshots" ADD CONSTRAINT "world_snapshots_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "world_stats" ADD CONSTRAINT "world_stats_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "world_technologies" ADD CONSTRAINT "world_technologies_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "world_technologies" ADD CONSTRAINT "world_technologies_tech_id_technologies_id_fk" FOREIGN KEY ("tech_id") REFERENCES "public"."technologies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "events_world_seq_idx" ON "historical_events" USING btree ("world_id","seq");--> statement-breakpoint
CREATE INDEX "events_world_tick_idx" ON "historical_events" USING btree ("world_id","tick");--> statement-breakpoint
CREATE INDEX "events_world_year_idx" ON "historical_events" USING btree ("world_id","year");--> statement-breakpoint
CREATE INDEX "events_world_importance_idx" ON "historical_events" USING btree ("world_id","importance","seq");--> statement-breakpoint
CREATE INDEX "events_world_type_idx" ON "historical_events" USING btree ("world_id","type","seq");--> statement-breakpoint
CREATE INDEX "households_active_idx" ON "households" USING btree ("world_id","seq") WHERE "households"."dissolved_year" is null;--> statement-breakpoint
CREATE INDEX "people_alive_idx" ON "people" USING btree ("world_id","seq") WHERE "people"."alive";--> statement-breakpoint
CREATE INDEX "people_tribe_idx" ON "people" USING btree ("world_id","tribe_id");--> statement-breakpoint
CREATE INDEX "settlements_world_coords_idx" ON "settlements" USING btree ("world_id","x","y");--> statement-breakpoint
CREATE INDEX "simulation_runs_world_idx" ON "simulation_runs" USING btree ("world_id","created_at");--> statement-breakpoint
CREATE INDEX "tribes_world_seq_idx" ON "tribes" USING btree ("world_id","seq");--> statement-breakpoint
CREATE INDEX "world_stats_year_idx" ON "world_stats" USING btree ("world_id","year");--> statement-breakpoint
CREATE INDEX "worlds_updated_idx" ON "worlds" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "worlds_owner_idx" ON "worlds" USING btree ("owner_id");