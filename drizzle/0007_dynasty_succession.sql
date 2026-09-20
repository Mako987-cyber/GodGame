ALTER TABLE "dynasties" ADD COLUMN "current_leader_id" text;--> statement-breakpoint
ALTER TABLE "dynasties" ADD COLUMN "legitimacy" double precision DEFAULT 0.6 NOT NULL;--> statement-breakpoint
ALTER TABLE "dynasties" ADD COLUMN "succession_law" text DEFAULT 'hereditary' NOT NULL;--> statement-breakpoint
ALTER TABLE "dynasties" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "dynasties" ADD COLUMN "end_reason" text;--> statement-breakpoint
ALTER TABLE "dynasties" ADD COLUMN "crises" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "dynasties_status_idx" ON "dynasties" USING btree ("world_id","status");--> statement-breakpoint
-- Backfill (idempotent): houses that had already ended are not "active", and the year they
-- stopped ruling is the only thing the old rows recorded about their end.
UPDATE "dynasties" SET "status" = 'extinct' WHERE "ended_year" IS NOT NULL AND "status" = 'active';
