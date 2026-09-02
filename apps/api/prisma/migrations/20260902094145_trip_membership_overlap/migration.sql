-- No two APPROVED memberships for the same user may have overlapping trip
-- dates (docs/BLUEPRINT.md §03). TripMembership doesn't carry its own date
-- range — the trip does — so we mirror the trip's [startDate, endDate) onto
-- a `period daterange` column (kept in sync by the triggers below), then
-- add a GIST exclusion constraint over it, scoped to approved rows only.

CREATE EXTENSION IF NOT EXISTS btree_gist;

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

-- Requested/rejected/left/removed rows are untouched — a user can hold
-- multiple pending requests that overlap; the block only bites at
-- approval time.
ALTER TABLE "TripMembership"
  ADD CONSTRAINT trip_membership_no_overlap
  EXCLUDE USING gist (
    "userId" WITH =,
    period WITH &&
  )
  WHERE (status = 'APPROVED');
