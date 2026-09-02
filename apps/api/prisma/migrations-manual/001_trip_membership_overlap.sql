-- Not yet wired into Prisma's migration history — there's no live database
-- to run `prisma migrate dev` against yet (see docs/ROADMAP.md, Phase 0).
--
-- Once DATABASE_URL points at a real Postgres instance:
--   1. npx prisma migrate dev --name init                    (generates the base tables from schema.prisma)
--   2. npx prisma migrate dev --name trip_membership_overlap --create-only
--   3. Replace the generated (empty) migration.sql with this file's contents
--   4. npx prisma migrate dev                                 (applies it)
--
-- What this does, and why (docs/BLUEPRINT.md §03 "the constraint worth
-- enforcing at the database, not the application"):
--
--   TripMembership doesn't carry its own date range — the trip does. To let
--   Postgres refuse overlapping *approved* memberships for the same user
--   without a join, we mirror the trip's [startDate, endDate) onto a
--   `period daterange` column on TripMembership (kept in sync by the
--   trigger below), then add a GIST exclusion constraint over it, scoped to
--   approved rows only via a partial predicate.

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Keep TripMembership.period in sync with its parent Trip's dates.
CREATE OR REPLACE FUNCTION sync_trip_membership_period()
RETURNS trigger AS $$
BEGIN
  SELECT daterange(t."startDate"::date, t."endDate"::date, '[]')
    INTO NEW.period
    FROM "Trip" t
    WHERE t.id = NEW."tripId";
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_trip_membership_period
  BEFORE INSERT OR UPDATE OF "tripId" ON "TripMembership"
  FOR EACH ROW
  EXECUTE FUNCTION sync_trip_membership_period();

-- If a trip's dates change after memberships exist, re-sync affected rows.
CREATE OR REPLACE FUNCTION sync_trip_membership_period_on_trip_change()
RETURNS trigger AS $$
BEGIN
  UPDATE "TripMembership"
     SET period = daterange(NEW."startDate"::date, NEW."endDate"::date, '[]')
   WHERE "tripId" = NEW.id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_trip_dates_change
  AFTER UPDATE OF "startDate", "endDate" ON "Trip"
  FOR EACH ROW
  EXECUTE FUNCTION sync_trip_membership_period_on_trip_change();

-- The constraint itself: no two APPROVED memberships for the same user may
-- have overlapping periods. Requested/rejected/left/removed rows are
-- untouched — a user can hold multiple pending requests that overlap;
-- the block only bites at approval time.
ALTER TABLE "TripMembership"
  ADD CONSTRAINT trip_membership_no_overlap
  EXCLUDE USING gist (
    "userId" WITH =,
    period WITH &&
  )
  WHERE (status = 'APPROVED');
