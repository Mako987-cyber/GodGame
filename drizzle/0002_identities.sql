ALTER TABLE "civilizations" ADD COLUMN "identity_id" text;--> statement-breakpoint
ALTER TABLE "civilizations" ADD COLUMN "identity_type" text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE "civilizations" ADD COLUMN "political_stem" text;--> statement-breakpoint
ALTER TABLE "civilizations" ADD COLUMN "former_names" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "tribes" ADD COLUMN "identity_id" text;--> statement-breakpoint
ALTER TABLE "tribes" ADD COLUMN "identity_type" text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE "tribes" ADD COLUMN "absorbed_identity_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "tribes" ADD COLUMN "absorbed_by_tribe_id" text;--> statement-breakpoint
ALTER TABLE "worlds" ADD COLUMN "roster" jsonb;--> statement-breakpoint
CREATE INDEX "civilizations_world_identity_idx" ON "civilizations" USING btree ("world_id","identity_id");--> statement-breakpoint
CREATE INDEX "civilizations_world_status_idx" ON "civilizations" USING btree ("world_id","status");--> statement-breakpoint
CREATE INDEX "tribes_world_identity_idx" ON "tribes" USING btree ("world_id","identity_id");--> statement-breakpoint
CREATE INDEX "tribes_world_status_idx" ON "tribes" USING btree ("world_id","status");