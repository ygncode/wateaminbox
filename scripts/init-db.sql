-- Initialize the database with required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Create a function to create tenant schemas
CREATE OR REPLACE FUNCTION create_tenant_schema(tenant_id UUID)
RETURNS void AS $$
DECLARE
    schema_name TEXT;
BEGIN
    schema_name := 'tenant_' || REPLACE(tenant_id::TEXT, '-', '_');
    EXECUTE format('CREATE SCHEMA IF NOT EXISTS %I', schema_name);
END;
$$ LANGUAGE plpgsql;

-- Create a function to drop tenant schemas
CREATE OR REPLACE FUNCTION drop_tenant_schema(tenant_id UUID)
RETURNS void AS $$
DECLARE
    schema_name TEXT;
BEGIN
    schema_name := 'tenant_' || REPLACE(tenant_id::TEXT, '-', '_');
    EXECUTE format('DROP SCHEMA IF EXISTS %I CASCADE', schema_name);
END;
$$ LANGUAGE plpgsql;
