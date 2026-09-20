-- Non-destructive: adds the world_deletion_jobs table and its indexes; no existing table,
-- column or row is modified. `worlds.status` is plain text, so the new "deleting" value needs
-- no DDL. Rollback (manual, only if needed): DROP TABLE "world_deletion_jobs".
CREATE TABLE "world_deletion_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"world_id" uuid NOT NULL,
	"world_name" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"current_phase" text,
	"deleted_rows" integer DEFAULT 0 NOT NULL,
	"deleted_by_table" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"completed_tables" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"progress" double precision DEFAULT 0 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error_code" text,
	"error_message" text,
	"lease_token" uuid,
	"lease_until" timestamp with time zone,
	"requested_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "world_deletion_jobs_open_idx" ON "world_deletion_jobs" USING btree ("world_id") WHERE "world_deletion_jobs"."status" in ('queued', 'running', 'failed');--> statement-breakpoint
CREATE INDEX "world_deletion_jobs_world_idx" ON "world_deletion_jobs" USING btree ("world_id","created_at");--> statement-breakpoint
CREATE INDEX "world_deletion_jobs_status_idx" ON "world_deletion_jobs" USING btree ("status","updated_at");