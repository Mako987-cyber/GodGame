CREATE TABLE "diplomatic_agreements" (
	"world_id" uuid NOT NULL,
	"id" text NOT NULL,
	"seq" integer NOT NULL,
	"first_civilization_id" text NOT NULL,
	"second_civilization_id" text NOT NULL,
	"type" text NOT NULL,
	"started_at_tick" integer NOT NULL,
	"started_year" integer NOT NULL,
	"expires_at_year" integer,
	"ended_year" integer,
	"trust_at_start" double precision NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"violation_count" integer DEFAULT 0 NOT NULL,
	"last_violator_id" text,
	"cause_event_id" text,
	CONSTRAINT "diplomatic_agreements_world_id_id_pk" PRIMARY KEY("world_id","id")
);
--> statement-breakpoint
CREATE TABLE "diplomatic_reputations" (
	"world_id" uuid NOT NULL,
	"civilization_id" text NOT NULL,
	"reliability" double precision NOT NULL,
	"aggression" double precision NOT NULL,
	"trade_reliability" double precision NOT NULL,
	"treaty_respect" double precision NOT NULL,
	"threat_level" double precision NOT NULL,
	"agreements_signed" integer DEFAULT 0 NOT NULL,
	"agreements_broken" integer DEFAULT 0 NOT NULL,
	"updated_at_tick" integer NOT NULL,
	CONSTRAINT "diplomatic_reputations_world_id_civilization_id_pk" PRIMARY KEY("world_id","civilization_id")
);
--> statement-breakpoint
ALTER TABLE "diplomatic_agreements" ADD CONSTRAINT "diplomatic_agreements_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diplomatic_reputations" ADD CONSTRAINT "diplomatic_reputations_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agreements_world_status_idx" ON "diplomatic_agreements" USING btree ("world_id","status");--> statement-breakpoint
CREATE INDEX "agreements_world_first_idx" ON "diplomatic_agreements" USING btree ("world_id","first_civilization_id");--> statement-breakpoint
CREATE INDEX "agreements_world_second_idx" ON "diplomatic_agreements" USING btree ("world_id","second_civilization_id");