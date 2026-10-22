-- Immutable setup intent makes a lost response safe to retry without another collection.
ALTER TABLE collections ADD COLUMN setup_request jsonb;
ALTER TABLE collections ADD COLUMN setup_status text NOT NULL DEFAULT 'ready'
  CHECK(setup_status IN ('preparing','ready','failed'));
ALTER TABLE collections ADD COLUMN setup_error text;

CREATE FUNCTION preserve_collection_profile() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.embedding_config IS DISTINCT FROM OLD.embedding_config
     OR NEW.setup_request IS DISTINCT FROM OLD.setup_request THEN
    RAISE EXCEPTION 'Create a new collection to change its embedding profile or setup intent'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER immutable_collection_profile BEFORE UPDATE OF embedding_config,setup_request
  ON collections FOR EACH ROW EXECUTE FUNCTION preserve_collection_profile();
