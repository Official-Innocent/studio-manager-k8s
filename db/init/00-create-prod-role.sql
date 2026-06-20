-- Compatibility shim for demo/dev environments
-- The schema dump (01-schema.sql) was exported from production and hardcodes
-- "ALTER ... OWNER TO biggshots_prod" statements. Rather than maintain a
-- patched copy of the schema, we create a role alias here so the dump runs
-- unmodified in any environment.
DO
$$
BEGIN
   IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'biggshots_prod') THEN
      CREATE ROLE biggshots_prod;
   END IF;
END
$$;
