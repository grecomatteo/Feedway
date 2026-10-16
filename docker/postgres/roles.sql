-- Run once by 01-roles.sh at first database initialisation, connected to the app database.
-- Variables: migrator_password, runtime_password, dbname.
CREATE ROLE app_migrator LOGIN PASSWORD :'migrator_password';
-- NOBYPASSRLS: stage 2 turns on Row Level Security for isolation between agencies.
CREATE ROLE app_runtime LOGIN NOINHERIT NOBYPASSRLS PASSWORD :'runtime_password';

ALTER DATABASE :"dbname" OWNER TO app_migrator;
ALTER SCHEMA public OWNER TO app_migrator;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO app_runtime;

ALTER DEFAULT PRIVILEGES FOR ROLE app_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE app_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_runtime;
