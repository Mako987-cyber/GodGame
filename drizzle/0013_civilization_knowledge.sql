CREATE TABLE "civilization_knowledge" (
	"world_id" uuid NOT NULL,
	"observer_id" text NOT NULL,
	"target_id" text NOT NULL,
	"location" jsonb,
	"population" jsonb,
	"military" jsonb,
	"stability" jsonb,
	"technologies" jsonb,
	"intent" jsonb,
	"spy_attempts" integer DEFAULT 0 NOT NULL,
	"spies_caught" integer DEFAULT 0 NOT NULL,
	"updated_year" integer NOT NULL,
	CONSTRAINT "civilization_knowledge_world_id_observer_id_target_id_pk" PRIMARY KEY("world_id","observer_id","target_id")
);
--> statement-breakpoint
ALTER TABLE "civilization_knowledge" ADD CONSTRAINT "civilization_knowledge_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;