-- Existing runtime groups keep their existing account and role boundaries.
-- Matching needs progress-row writes and only the rider's offer timestamp.
DO $$ DECLARE target_role text; BEGIN
  FOREACH target_role IN ARRAY ARRAY['fetch_customer_runtime','fetch_rider_runtime','fetch_staff_runtime','fetch_owner_runtime'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=target_role) THEN
      EXECUTE format('GRANT SELECT,INSERT,UPDATE ON TABLE %I.%I TO %I',current_schema(),'AutoDispatch',target_role);
      EXECUTE format('GRANT UPDATE (%I,%I) ON TABLE %I.%I TO %I','lastOfferAt','updatedAt',current_schema(),'RiderPresence',target_role);
    END IF;
  END LOOP;
END $$;
