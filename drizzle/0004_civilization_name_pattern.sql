-- Non-destructive: one nullable column. Existing states keep NULL, i.e. their legacy naming rule
-- ("{form} di {capital}"); only states founded from now on record the pattern they were named with.
ALTER TABLE "civilizations" ADD COLUMN "name_pattern" text;