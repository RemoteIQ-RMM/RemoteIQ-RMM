--
-- PostgreSQL database dump
--

\restrict 3ZT0j3en4OS9PgAkZxRZi7j20QAg6f5fxaED2TciIhKV485bPYJhUgZrep1tDwS

-- Dumped from database version 16.10 (Debian 16.10-1.pgdg13+1)
-- Dumped by pg_dump version 16.10 (Debian 16.10-1.pgdg13+1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

ALTER TABLE IF EXISTS ONLY public.trusted_devices DROP CONSTRAINT IF EXISTS trusted_devices_user_id_fkey;
ALTER TABLE IF EXISTS ONLY public.sessions DROP CONSTRAINT IF EXISTS sessions_user_id_fkey;
ALTER TABLE IF EXISTS ONLY public.role_permissions DROP CONSTRAINT IF EXISTS role_permissions_role_id_fkey;
ALTER TABLE IF EXISTS ONLY public.role_permissions DROP CONSTRAINT IF EXISTS role_permissions_permission_id_fkey;
ALTER TABLE IF EXISTS ONLY public.personal_tokens DROP CONSTRAINT IF EXISTS personal_tokens_user_id_fkey;
ALTER TABLE IF EXISTS ONLY public.login_challenges DROP CONSTRAINT IF EXISTS login_challenges_user_id_fkey;
ALTER TABLE IF EXISTS ONLY public.jobs DROP CONSTRAINT IF EXISTS jobs_agent_id_fkey;
ALTER TABLE IF EXISTS ONLY public.job_results DROP CONSTRAINT IF EXISTS job_results_job_id_fkey;
ALTER TABLE IF EXISTS ONLY public.tickets DROP CONSTRAINT IF EXISTS fk_tickets_assignee_user;
ALTER TABLE IF EXISTS ONLY public.role_meta DROP CONSTRAINT IF EXISTS fk_role_meta_role;
ALTER TABLE IF EXISTS ONLY public.backup_restores DROP CONSTRAINT IF EXISTS backup_restores_backup_id_fkey;
ALTER TABLE IF EXISTS ONLY public.backup_job_manifests DROP CONSTRAINT IF EXISTS backup_job_manifests_job_id_fkey;
ALTER TABLE IF EXISTS ONLY public.backup_job_logs DROP CONSTRAINT IF EXISTS backup_job_logs_job_id_fkey;
ALTER TABLE IF EXISTS ONLY public.agent_software DROP CONSTRAINT IF EXISTS agent_software_agent_id_fkey;
ALTER TABLE IF EXISTS ONLY public.agent_jobs DROP CONSTRAINT IF EXISTS agent_jobs_agent_id_fkey;
DROP TRIGGER IF EXISTS users_set_updated_at ON public.users;
DROP TRIGGER IF EXISTS trg_users_updated_at ON public.users;
DROP TRIGGER IF EXISTS trg_role_meta_touch_updated_at ON public.role_meta;
DROP TRIGGER IF EXISTS trg_branding_settings_updated_at ON public.branding_settings;
DROP TRIGGER IF EXISTS trg_agents_updated_at ON public.agents;
DROP TRIGGER IF EXISTS tickets_touch_updated_at ON public.tickets;
DROP TRIGGER IF EXISTS agent_jobs_set_updated_at ON public.agent_jobs;
DROP INDEX IF EXISTS public.ux_agents_device_id;
DROP INDEX IF EXISTS public.ux_agent_software_agent_name_ver;
DROP INDEX IF EXISTS public.sessions_jti_unique;
DROP INDEX IF EXISTS public.jobs_agent_uuid_idx;
DROP INDEX IF EXISTS public.idx_users_status;
DROP INDEX IF EXISTS public.idx_users_role;
DROP INDEX IF EXISTS public.idx_users_lower_name;
DROP INDEX IF EXISTS public.idx_users_lower_email;
DROP INDEX IF EXISTS public.idx_users_email;
DROP INDEX IF EXISTS public.idx_tickets_status;
DROP INDEX IF EXISTS public.idx_tickets_requester;
DROP INDEX IF EXISTS public.idx_tickets_priority;
DROP INDEX IF EXISTS public.idx_tickets_device_id;
DROP INDEX IF EXISTS public.idx_tickets_customer_id;
DROP INDEX IF EXISTS public.idx_tickets_created_at;
DROP INDEX IF EXISTS public.idx_tickets_assignee_user;
DROP INDEX IF EXISTS public.idx_tickets_assignee;
DROP INDEX IF EXISTS public.idx_sessions_user_revoked;
DROP INDEX IF EXISTS public.idx_sessions_user_lastseen;
DROP INDEX IF EXISTS public.idx_sessions_user_active;
DROP INDEX IF EXISTS public.idx_sessions_user;
DROP INDEX IF EXISTS public.idx_role_meta_lower_name;
DROP INDEX IF EXISTS public.idx_pat_user;
DROP INDEX IF EXISTS public.idx_checks_type_name;
DROP INDEX IF EXISTS public.idx_checks_type;
DROP INDEX IF EXISTS public.idx_checks_enabled;
DROP INDEX IF EXISTS public.idx_backup_jobs_status;
DROP INDEX IF EXISTS public.idx_backup_jobs_started_at;
DROP INDEX IF EXISTS public.idx_agents_site;
DROP INDEX IF EXISTS public.idx_agents_client;
DROP INDEX IF EXISTS public.idx_agent_software_agent;
DROP INDEX IF EXISTS public.idx_agent_jobs_agent_status;
DROP INDEX IF EXISTS public.devices_site_idx;
DROP INDEX IF EXISTS public.devices_client_idx;
DROP INDEX IF EXISTS public.checks_type_name_uk;
DROP INDEX IF EXISTS public.check_runs_device_id_idx;
DROP INDEX IF EXISTS public.check_runs_created_at_idx;
DROP INDEX IF EXISTS public.check_runs_assignment_id_idx;
DROP INDEX IF EXISTS public.check_assignments_uk;
DROP INDEX IF EXISTS public.check_assignments_device_id_idx;
DROP INDEX IF EXISTS public.backup_jobs_status_idx;
DROP INDEX IF EXISTS public.backup_jobs_started_at_desc;
DROP INDEX IF EXISTS public.agents_token_hash_idx;
DROP INDEX IF EXISTS public.agents_last_seen_idx;
DROP INDEX IF EXISTS public.agents_device_id_uk;
DROP INDEX IF EXISTS public.agents_device_id_key;
DROP INDEX IF EXISTS public.agents_agent_uuid_key;
DROP INDEX IF EXISTS public.agent_software_name_ci_idx;
DROP INDEX IF EXISTS public.agent_software_dedupe;
DROP INDEX IF EXISTS public.agent_software_agent_id_idx;
ALTER TABLE IF EXISTS ONLY public.users DROP CONSTRAINT IF EXISTS users_pkey;
ALTER TABLE IF EXISTS ONLY public.users DROP CONSTRAINT IF EXISTS users_email_key;
ALTER TABLE IF EXISTS ONLY public.trusted_devices DROP CONSTRAINT IF EXISTS trusted_devices_user_id_device_fingerprint_key;
ALTER TABLE IF EXISTS ONLY public.trusted_devices DROP CONSTRAINT IF EXISTS trusted_devices_pkey;
ALTER TABLE IF EXISTS ONLY public.tickets DROP CONSTRAINT IF EXISTS tickets_pkey;
ALTER TABLE IF EXISTS ONLY public.support_legal_settings DROP CONSTRAINT IF EXISTS support_legal_settings_pkey;
ALTER TABLE IF EXISTS ONLY public.support_legal DROP CONSTRAINT IF EXISTS support_legal_pkey;
ALTER TABLE IF EXISTS ONLY public.sessions DROP CONSTRAINT IF EXISTS sessions_pkey;
ALTER TABLE IF EXISTS ONLY public.roles DROP CONSTRAINT IF EXISTS roles_pkey;
ALTER TABLE IF EXISTS ONLY public.roles DROP CONSTRAINT IF EXISTS roles_name_key;
ALTER TABLE IF EXISTS ONLY public.role_permissions DROP CONSTRAINT IF EXISTS role_permissions_pkey;
ALTER TABLE IF EXISTS ONLY public.role_meta DROP CONSTRAINT IF EXISTS role_meta_pkey;
ALTER TABLE IF EXISTS ONLY public.personal_tokens DROP CONSTRAINT IF EXISTS personal_tokens_pkey;
ALTER TABLE IF EXISTS ONLY public.permissions DROP CONSTRAINT IF EXISTS permissions_pkey;
ALTER TABLE IF EXISTS ONLY public.permissions DROP CONSTRAINT IF EXISTS permissions_key_key;
ALTER TABLE IF EXISTS ONLY public.login_challenges DROP CONSTRAINT IF EXISTS login_challenges_pkey;
ALTER TABLE IF EXISTS ONLY public.localization_settings DROP CONSTRAINT IF EXISTS localization_settings_pkey;
ALTER TABLE IF EXISTS ONLY public.jobs DROP CONSTRAINT IF EXISTS jobs_pkey;
ALTER TABLE IF EXISTS ONLY public.job_results DROP CONSTRAINT IF EXISTS job_results_pkey;
ALTER TABLE IF EXISTS ONLY public.imap_state DROP CONSTRAINT IF EXISTS imap_state_pkey;
ALTER TABLE IF EXISTS ONLY public.imap_ingested DROP CONSTRAINT IF EXISTS imap_ingested_purpose_uid_key;
ALTER TABLE IF EXISTS ONLY public.imap_ingested DROP CONSTRAINT IF EXISTS imap_ingested_pkey;
ALTER TABLE IF EXISTS ONLY public.email_settings DROP CONSTRAINT IF EXISTS email_settings_pkey;
ALTER TABLE IF EXISTS ONLY public.email_inbound_events DROP CONSTRAINT IF EXISTS email_inbound_events_pkey;
ALTER TABLE IF EXISTS ONLY public.dkim_settings DROP CONSTRAINT IF EXISTS dkim_settings_pkey;
ALTER TABLE IF EXISTS ONLY public.dkim_keys DROP CONSTRAINT IF EXISTS dkim_keys_pkey;
ALTER TABLE IF EXISTS ONLY public.dkim_keys DROP CONSTRAINT IF EXISTS dkim_keys_domain_selector_key;
ALTER TABLE IF EXISTS ONLY public.devices DROP CONSTRAINT IF EXISTS devices_pkey;
ALTER TABLE IF EXISTS ONLY public.company_profile DROP CONSTRAINT IF EXISTS company_profile_pkey;
ALTER TABLE IF EXISTS ONLY public.checks DROP CONSTRAINT IF EXISTS checks_type_name_unique;
ALTER TABLE IF EXISTS ONLY public.checks DROP CONSTRAINT IF EXISTS checks_pkey;
ALTER TABLE IF EXISTS ONLY public.check_runs DROP CONSTRAINT IF EXISTS check_runs_pkey;
ALTER TABLE IF EXISTS ONLY public.check_assignments DROP CONSTRAINT IF EXISTS check_assignments_pkey;
ALTER TABLE IF EXISTS ONLY public.branding_settings DROP CONSTRAINT IF EXISTS branding_settings_pkey;
ALTER TABLE IF EXISTS ONLY public.backups_config DROP CONSTRAINT IF EXISTS backups_config_pkey;
ALTER TABLE IF EXISTS ONLY public.backup_restores DROP CONSTRAINT IF EXISTS backup_restores_pkey;
ALTER TABLE IF EXISTS ONLY public.backup_jobs DROP CONSTRAINT IF EXISTS backup_jobs_pkey;
ALTER TABLE IF EXISTS ONLY public.backup_job_manifests DROP CONSTRAINT IF EXISTS backup_job_manifests_pkey;
ALTER TABLE IF EXISTS ONLY public.backup_job_logs DROP CONSTRAINT IF EXISTS backup_job_logs_pkey;
ALTER TABLE IF EXISTS ONLY public.agents DROP CONSTRAINT IF EXISTS agents_pkey;
ALTER TABLE IF EXISTS ONLY public.agents DROP CONSTRAINT IF EXISTS agents_agent_uuid_uk;
ALTER TABLE IF EXISTS ONLY public.agent_software DROP CONSTRAINT IF EXISTS agent_software_pkey;
ALTER TABLE IF EXISTS ONLY public.agent_jobs DROP CONSTRAINT IF EXISTS agent_jobs_pkey;
ALTER TABLE IF EXISTS public.imap_ingested ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS public.email_inbound_events ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS public.dkim_keys ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS public.agents ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS public.agent_software ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS public.agent_jobs ALTER COLUMN id DROP DEFAULT;
DROP TABLE IF EXISTS public.trusted_devices;
DROP TABLE IF EXISTS public.tickets;
DROP TABLE IF EXISTS public.support_legal_settings;
DROP TABLE IF EXISTS public.support_legal;
DROP TABLE IF EXISTS public.sessions;
DROP VIEW IF EXISTS public.roles_with_meta;
DROP TABLE IF EXISTS public.users;
DROP TABLE IF EXISTS public.roles;
DROP TABLE IF EXISTS public.role_permissions;
DROP TABLE IF EXISTS public.role_meta;
DROP TABLE IF EXISTS public.personal_tokens;
DROP TABLE IF EXISTS public.permissions;
DROP TABLE IF EXISTS public.login_challenges;
DROP TABLE IF EXISTS public.localization_settings;
DROP TABLE IF EXISTS public.jobs;
DROP TABLE IF EXISTS public.job_results;
DROP TABLE IF EXISTS public.imap_state;
DROP SEQUENCE IF EXISTS public.imap_ingested_id_seq;
DROP TABLE IF EXISTS public.imap_ingested;
DROP TABLE IF EXISTS public.email_settings;
DROP SEQUENCE IF EXISTS public.email_inbound_events_id_seq;
DROP TABLE IF EXISTS public.email_inbound_events;
DROP TABLE IF EXISTS public.dkim_settings;
DROP SEQUENCE IF EXISTS public.dkim_keys_id_seq;
DROP TABLE IF EXISTS public.dkim_keys;
DROP TABLE IF EXISTS public.devices;
DROP TABLE IF EXISTS public.company_profile;
DROP TABLE IF EXISTS public.checks;
DROP TABLE IF EXISTS public.check_runs;
DROP TABLE IF EXISTS public.check_assignments;
DROP TABLE IF EXISTS public.branding_settings;
DROP TABLE IF EXISTS public.backups_config;
DROP TABLE IF EXISTS public.backup_restores;
DROP TABLE IF EXISTS public.backup_jobs;
DROP TABLE IF EXISTS public.backup_job_manifests;
DROP TABLE IF EXISTS public.backup_job_logs;
DROP SEQUENCE IF EXISTS public.agents_id_seq;
DROP TABLE IF EXISTS public.agents;
DROP SEQUENCE IF EXISTS public.agent_software_id_seq;
DROP TABLE IF EXISTS public.agent_software;
DROP SEQUENCE IF EXISTS public.agent_jobs_id_seq;
DROP TABLE IF EXISTS public.agent_jobs;
DROP FUNCTION IF EXISTS public.set_users_updated_at();
DROP FUNCTION IF EXISTS public.set_updated_at();
DROP FUNCTION IF EXISTS public.select_all_tables(limit_rows integer);
DROP FUNCTION IF EXISTS public.role_meta_touch_updated_at();
DROP FUNCTION IF EXISTS public.agent_jobs_touch_updated_at();
DROP FUNCTION IF EXISTS public._touch_updated_at();
DROP TYPE IF EXISTS public.email_purpose;
DROP EXTENSION IF EXISTS pgcrypto;
--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
-- Name: email_purpose; Type: TYPE; Schema: public; Owner: remoteiq
--

CREATE TYPE public.email_purpose AS ENUM (
    'alerts',
    'invites',
    'password_resets',
    'reports'
);


ALTER TYPE public.email_purpose OWNER TO remoteiq;

--
-- Name: _touch_updated_at(); Type: FUNCTION; Schema: public; Owner: remoteiq
--

CREATE FUNCTION public._touch_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END$$;


ALTER FUNCTION public._touch_updated_at() OWNER TO remoteiq;

--
-- Name: agent_jobs_touch_updated_at(); Type: FUNCTION; Schema: public; Owner: remoteiq
--

CREATE FUNCTION public.agent_jobs_touch_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      NEW.updated_at := now();
      RETURN NEW;
    END
    $$;


ALTER FUNCTION public.agent_jobs_touch_updated_at() OWNER TO remoteiq;

--
-- Name: role_meta_touch_updated_at(); Type: FUNCTION; Schema: public; Owner: remoteiq
--

CREATE FUNCTION public.role_meta_touch_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION public.role_meta_touch_updated_at() OWNER TO remoteiq;

--
-- Name: select_all_tables(integer); Type: FUNCTION; Schema: public; Owner: remoteiq
--

CREATE FUNCTION public.select_all_tables(limit_rows integer DEFAULT 100) RETURNS TABLE(schema_name text, table_name text, payload jsonb)
    LANGUAGE plpgsql
    AS $$
DECLARE
  r RECORD;
  lim text := CASE WHEN limit_rows IS NULL OR limit_rows <= 0 THEN '' ELSE 'LIMIT '||limit_rows END;
BEGIN
  FOR r IN
    SELECT n.nspname AS schema_name, c.relname AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('r','p')                                 -- base + partitioned tables
      AND n.nspname NOT IN ('pg_catalog','information_schema','pg_toast')
    ORDER BY 1,2
  LOOP
    RETURN QUERY EXECUTE format(
      'SELECT %L::text AS schema_name, %L::text AS table_name, to_jsonb(t) AS payload
         FROM %I.%I t %s',
      r.schema_name, r.table_name, r.schema_name, r.table_name, lim
    );
  END LOOP;
END;
$$;


ALTER FUNCTION public.select_all_tables(limit_rows integer) OWNER TO remoteiq;

--
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: remoteiq
--

CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$;


ALTER FUNCTION public.set_updated_at() OWNER TO remoteiq;

--
-- Name: set_users_updated_at(); Type: FUNCTION; Schema: public; Owner: remoteiq
--

CREATE FUNCTION public.set_users_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;


ALTER FUNCTION public.set_users_updated_at() OWNER TO remoteiq;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: agent_jobs; Type: TABLE; Schema: public; Owner: remoteiq
--

CREATE TABLE public.agent_jobs (
    id bigint NOT NULL,
    agent_id integer NOT NULL,
    kind text NOT NULL,
    payload jsonb NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    result jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.agent_jobs OWNER TO remoteiq;

--
-- Name: agent_jobs_id_seq; Type: SEQUENCE; Schema: public; Owner: remoteiq
--

CREATE SEQUENCE public.agent_jobs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.agent_jobs_id_seq OWNER TO remoteiq;

--
-- Name: agent_jobs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: remoteiq
--

ALTER SEQUENCE public.agent_jobs_id_seq OWNED BY public.agent_jobs.id;


--
-- Name: agent_software; Type: TABLE; Schema: public; Owner: remoteiq
--

CREATE TABLE public.agent_software (
    agent_id integer NOT NULL,
    name text NOT NULL,
    version text,
    publisher text,
    install_date text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id bigint NOT NULL
);


ALTER TABLE public.agent_software OWNER TO remoteiq;

--
-- Name: agent_software_id_seq; Type: SEQUENCE; Schema: public; Owner: remoteiq
--

CREATE SEQUENCE public.agent_software_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.agent_software_id_seq OWNER TO remoteiq;

--
-- Name: agent_software_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: remoteiq
--

ALTER SEQUENCE public.agent_software_id_seq OWNED BY public.agent_software.id;


--
-- Name: agents; Type: TABLE; Schema: public; Owner: remoteiq
--

CREATE TABLE public.agents (
    id bigint NOT NULL,
    device_id text NOT NULL,
    hostname text NOT NULL,
    os text NOT NULL,
    arch text NOT NULL,
    version text NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    token_hash text,
    client text,
    site text,
    primary_ip text,
    logged_in_user text,
    facts jsonb DEFAULT '{}'::jsonb NOT NULL,
    agent_uuid uuid DEFAULT gen_random_uuid() NOT NULL,
    CONSTRAINT agents_arch_check CHECK ((arch = ANY (ARRAY['x64'::text, 'arm64'::text, 'x86'::text]))),
    CONSTRAINT agents_os_check CHECK ((os = ANY (ARRAY['windows'::text, 'linux'::text, 'macos'::text])))
);


ALTER TABLE public.agents OWNER TO remoteiq;

--
-- Name: agents_id_seq; Type: SEQUENCE; Schema: public; Owner: remoteiq
--

CREATE SEQUENCE public.agents_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.agents_id_seq OWNER TO remoteiq;

--
-- Name: agents_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: remoteiq
--

ALTER SEQUENCE public.agents_id_seq OWNED BY public.agents.id;


--
-- Name: backup_job_logs; Type: TABLE; Schema: public; Owner: remoteiq
--

CREATE TABLE public.backup_job_logs (
    job_id uuid NOT NULL,
    log_text text DEFAULT ''::text NOT NULL
);


ALTER TABLE public.backup_job_logs OWNER TO remoteiq;

--
-- Name: backup_job_manifests; Type: TABLE; Schema: public; Owner: remoteiq
--

CREATE TABLE public.backup_job_manifests (
    job_id uuid NOT NULL,
    manifest jsonb NOT NULL
);


ALTER TABLE public.backup_job_manifests OWNER TO remoteiq;

--
-- Name: backup_jobs; Type: TABLE; Schema: public; Owner: remoteiq
--

CREATE TABLE public.backup_jobs (
    id uuid NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone,
    status text NOT NULL,
    note text,
    size_bytes bigint,
    duration_sec integer,
    verified boolean,
    targets jsonb,
    destination jsonb,
    artifact_location jsonb,
    cancelled boolean DEFAULT false NOT NULL,
    CONSTRAINT backup_jobs_status_check CHECK ((status = ANY (ARRAY['running'::text, 'success'::text, 'failed'::text, 'cancelled'::text])))
);


ALTER TABLE public.backup_jobs OWNER TO remoteiq;

--
-- Name: backup_restores; Type: TABLE; Schema: public; Owner: remoteiq
--

CREATE TABLE public.backup_restores (
    id uuid NOT NULL,
    backup_id uuid NOT NULL,
    requested_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone,
    status text NOT NULL,
    note text,
    CONSTRAINT backup_restores_status_check CHECK ((status = ANY (ARRAY['running'::text, 'success'::text, 'failed'::text])))
);


ALTER TABLE public.backup_restores OWNER TO remoteiq;

--
-- Name: backups_config; Type: TABLE; Schema: public; Owner: remoteiq
--

CREATE TABLE public.backups_config (
    id text DEFAULT 'singleton'::text NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    targets jsonb DEFAULT '[]'::jsonb NOT NULL,
    schedule text NOT NULL,
    cron_expr text,
    retention_days integer DEFAULT 30 NOT NULL,
    encrypt boolean DEFAULT true NOT NULL,
    destination jsonb NOT NULL,
    notifications jsonb DEFAULT '{}'::jsonb NOT NULL,
    last_scheduled_at timestamp with time zone,
    CONSTRAINT backups_config_retention_days_check CHECK (((retention_days >= 1) AND (retention_days <= 3650))),
    CONSTRAINT backups_config_schedule_check CHECK ((schedule = ANY (ARRAY['hourly'::text, 'daily'::text, 'weekly'::text, 'cron'::text])))
);


ALTER TABLE public.backups_config OWNER TO remoteiq;

--
-- Name: branding_settings; Type: TABLE; Schema: public; Owner: remoteiq
--

CREATE TABLE public.branding_settings (
    id integer NOT NULL,
    primary_color text,
    secondary_color text,
    logo_light_url text,
    logo_dark_url text,
    login_background_url text,
    email_header text,
    email_footer text,
    custom_css text,
    allow_client_theme_toggle boolean,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    favicon_url text
);


ALTER TABLE public.branding_settings OWNER TO remoteiq;

--
-- Name: check_assignments; Type: TABLE; Schema: public; Owner: remoteiq
--

CREATE TABLE public.check_assignments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    device_id text NOT NULL,
    dedupe_key text,
    check_type text,
    check_name text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.check_assignments OWNER TO remoteiq;

--
-- Name: check_runs; Type: TABLE; Schema: public; Owner: remoteiq
--

CREATE TABLE public.check_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    assignment_id uuid,
    device_id text NOT NULL,
    status text NOT NULL,
    severity text,
    metrics jsonb,
    output text,
    started_at timestamp with time zone,
    finished_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.check_runs OWNER TO remoteiq;

--
-- Name: checks; Type: TABLE; Schema: public; Owner: remoteiq
--

CREATE TABLE public.checks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    scope text NOT NULL,
    type text NOT NULL,
    name text NOT NULL,
    description text,
    category text,
    config jsonb,
    threshold jsonb,
    severity_default text NOT NULL,
    interval_sec integer NOT NULL,
    timeout_sec integer NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    created_by uuid,
    updated_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT checks_interval_sec_check CHECK (((interval_sec >= 15) AND (interval_sec <= 86400))),
    CONSTRAINT checks_scope_check CHECK ((scope = ANY (ARRAY['DEVICE'::text, 'SITE'::text, 'CLIENT'::text, 'GLOBAL'::text]))),
    CONSTRAINT checks_severity_default_check CHECK ((severity_default = ANY (ARRAY['WARN'::text, 'CRIT'::text]))),
    CONSTRAINT checks_timeout_sec_check CHECK (((timeout_sec >= 1) AND (timeout_sec <= 600))),
    CONSTRAINT checks_type_check CHECK ((type = ANY (ARRAY['PING'::text, 'CPU'::text, 'MEMORY'::text, 'DISK'::text, 'SERVICE'::text, 'PROCESS'::text, 'PORT'::text, 'WINEVENT'::text, 'SOFTWARE'::text, 'SECURITY'::text, 'SCRIPT'::text, 'PATCH'::text, 'CERT'::text, 'SMART'::text, 'RDP'::text, 'SMB'::text, 'FIREWALL'::text])))
);


ALTER TABLE public.checks OWNER TO remoteiq;

--
-- Name: company_profile; Type: TABLE; Schema: public; Owner: remoteiq
--

CREATE TABLE public.company_profile (
    id smallint DEFAULT 1 NOT NULL,
    name text NOT NULL,
    legal_name text,
    email text,
    phone text,
    fax text,
    website text,
    vat_tin text,
    address1 text,
    address2 text,
    city text,
    state text,
    postal text,
    country text
);


ALTER TABLE public.company_profile OWNER TO remoteiq;

--
-- Name: devices; Type: TABLE; Schema: public; Owner: remoteiq
--

CREATE TABLE public.devices (
    id uuid NOT NULL,
    hostname text NOT NULL,
    os text NOT NULL,
    arch text,
    last_seen timestamp with time zone,
    status text NOT NULL,
    client text,
    site text,
    "user" text,
    agent_uuid uuid,
    CONSTRAINT devices_status_check CHECK ((status = ANY (ARRAY['online'::text, 'offline'::text])))
);


ALTER TABLE public.devices OWNER TO remoteiq;

--
-- Name: dkim_keys; Type: TABLE; Schema: public; Owner: remoteiq
--

CREATE TABLE public.dkim_keys (
    id integer NOT NULL,
    domain text NOT NULL,
    selector text NOT NULL,
    private_key text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.dkim_keys OWNER TO remoteiq;

--
-- Name: dkim_keys_id_seq; Type: SEQUENCE; Schema: public; Owner: remoteiq
--

CREATE SEQUENCE public.dkim_keys_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.dkim_keys_id_seq OWNER TO remoteiq;

--
-- Name: dkim_keys_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: remoteiq
--

ALTER SEQUENCE public.dkim_keys_id_seq OWNED BY public.dkim_keys.id;


--
-- Name: dkim_settings; Type: TABLE; Schema: public; Owner: remoteiq
--

CREATE TABLE public.dkim_settings (
    id smallint DEFAULT 1 NOT NULL,
    domain text DEFAULT ''::text NOT NULL,
    selector text DEFAULT ''::text NOT NULL,
    private_key text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.dkim_settings OWNER TO remoteiq;

--
-- Name: email_inbound_events; Type: TABLE; Schema: public; Owner: remoteiq
--

CREATE TABLE public.email_inbound_events (
    id bigint NOT NULL,
    purpose text NOT NULL,
    from_addr text,
    subject text,
    kind text,
    raw bytea,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.email_inbound_events OWNER TO remoteiq;

--
-- Name: email_inbound_events_id_seq; Type: SEQUENCE; Schema: public; Owner: remoteiq
--

CREATE SEQUENCE public.email_inbound_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.email_inbound_events_id_seq OWNER TO remoteiq;

--
-- Name: email_inbound_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: remoteiq
--

ALTER SEQUENCE public.email_inbound_events_id_seq OWNED BY public.email_inbound_events.id;


--
-- Name: email_settings; Type: TABLE; Schema: public; Owner: remoteiq
--

CREATE TABLE public.email_settings (
    purpose public.email_purpose NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    smtp_host text DEFAULT ''::text NOT NULL,
    smtp_port integer,
    smtp_username text DEFAULT ''::text NOT NULL,
    smtp_password text,
    smtp_use_tls boolean DEFAULT true NOT NULL,
    smtp_use_ssl boolean DEFAULT false NOT NULL,
    smtp_from_address text DEFAULT ''::text NOT NULL,
    imap_host text DEFAULT ''::text NOT NULL,
    imap_port integer,
    imap_username text DEFAULT ''::text NOT NULL,
    imap_password text,
    imap_use_ssl boolean DEFAULT true NOT NULL,
    pop_host text DEFAULT ''::text NOT NULL,
    pop_port integer,
    pop_username text DEFAULT ''::text NOT NULL,
    pop_password text,
    pop_use_ssl boolean DEFAULT true NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.email_settings OWNER TO remoteiq;

--
-- Name: imap_ingested; Type: TABLE; Schema: public; Owner: remoteiq
--

CREATE TABLE public.imap_ingested (
    id bigint NOT NULL,
    purpose text NOT NULL,
    uid bigint NOT NULL,
    from_addr text,
    subject text,
    size_bytes integer,
    headers_snippet text,
    is_bounce boolean DEFAULT false NOT NULL,
    bounce_recipient text,
    bounce_status text,
    bounce_action text,
    bounce_diagnostic text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.imap_ingested OWNER TO remoteiq;

--
-- Name: imap_ingested_id_seq; Type: SEQUENCE; Schema: public; Owner: remoteiq
--

CREATE SEQUENCE public.imap_ingested_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.imap_ingested_id_seq OWNER TO remoteiq;

--
-- Name: imap_ingested_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: remoteiq
--

ALTER SEQUENCE public.imap_ingested_id_seq OWNED BY public.imap_ingested.id;


--
-- Name: imap_state; Type: TABLE; Schema: public; Owner: remoteiq
--

CREATE TABLE public.imap_state (
    purpose text NOT NULL,
    last_uid bigint DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.imap_state OWNER TO remoteiq;

--
-- Name: job_results; Type: TABLE; Schema: public; Owner: remoteiq
--

CREATE TABLE public.job_results (
    job_id uuid NOT NULL,
    exit_code integer,
    stdout text,
    stderr text,
    duration_ms integer
);


ALTER TABLE public.job_results OWNER TO remoteiq;

--
-- Name: jobs; Type: TABLE; Schema: public; Owner: remoteiq
--

CREATE TABLE public.jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    agent_id bigint NOT NULL,
    type text NOT NULL,
    payload jsonb,
    status text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    dispatched_at timestamp with time zone,
    started_at timestamp with time zone,
    finished_at timestamp with time zone,
    agent_uuid uuid
);


ALTER TABLE public.jobs OWNER TO remoteiq;

--
-- Name: localization_settings; Type: TABLE; Schema: public; Owner: remoteiq
--

CREATE TABLE public.localization_settings (
    id integer NOT NULL,
    language text DEFAULT 'en-US'::text NOT NULL,
    date_format text DEFAULT 'MM/DD/YYYY'::text NOT NULL,
    time_format text DEFAULT 'h:mm a'::text NOT NULL,
    number_format text DEFAULT '1,234.56'::text NOT NULL,
    time_zone text DEFAULT 'UTC'::text NOT NULL,
    first_day_of_week text DEFAULT 'sunday'::text NOT NULL,
    currency text
);


ALTER TABLE public.localization_settings OWNER TO remoteiq;

--
-- Name: login_challenges; Type: TABLE; Schema: public; Owner: remoteiq
--

CREATE TABLE public.login_challenges (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.login_challenges OWNER TO remoteiq;

--
-- Name: permissions; Type: TABLE; Schema: public; Owner: remoteiq
--

CREATE TABLE public.permissions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    key text NOT NULL,
    label text NOT NULL,
    group_key text NOT NULL,
    group_label text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.permissions OWNER TO remoteiq;

--
-- Name: personal_tokens; Type: TABLE; Schema: public; Owner: remoteiq
--

CREATE TABLE public.personal_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    name text NOT NULL,
    token_hash text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    last_used_at timestamp with time zone,
    revoked_at timestamp with time zone
);


ALTER TABLE public.personal_tokens OWNER TO remoteiq;

--
-- Name: role_meta; Type: TABLE; Schema: public; Owner: remoteiq
--

CREATE TABLE public.role_meta (
    role_name text NOT NULL,
    description text,
    permissions text[] DEFAULT '{}'::text[] NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.role_meta OWNER TO remoteiq;

--
-- Name: role_permissions; Type: TABLE; Schema: public; Owner: remoteiq
--

CREATE TABLE public.role_permissions (
    role_id uuid NOT NULL,
    permission_id uuid NOT NULL
);


ALTER TABLE public.role_permissions OWNER TO remoteiq;

--
-- Name: roles; Type: TABLE; Schema: public; Owner: remoteiq
--

CREATE TABLE public.roles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    description text
);


ALTER TABLE public.roles OWNER TO remoteiq;

--
-- Name: users; Type: TABLE; Schema: public; Owner: remoteiq
--

CREATE TABLE public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    email text NOT NULL,
    role text DEFAULT 'User'::text NOT NULL,
    two_factor_enabled boolean DEFAULT false NOT NULL,
    suspended boolean DEFAULT false NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    last_seen timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    password_hash text,
    password_updated_at timestamp with time zone,
    phone text,
    address1 text,
    address2 text,
    city text,
    state text,
    postal text,
    country text,
    timezone text,
    locale text,
    avatar_url text,
    avatar_thumb_url text,
    totp_secret text,
    two_factor_recovery_codes text[] DEFAULT '{}'::text[] NOT NULL,
    two_factor_secret text,
    CONSTRAINT users_2fa_requires_secret CHECK (((two_factor_enabled IS NOT TRUE) OR ((two_factor_secret IS NOT NULL) AND (length(TRIM(BOTH FROM two_factor_secret)) > 0)))),
    CONSTRAINT users_status_check CHECK ((status = ANY (ARRAY['active'::text, 'invited'::text, 'suspended'::text])))
);


ALTER TABLE public.users OWNER TO remoteiq;

--
-- Name: roles_with_meta; Type: VIEW; Schema: public; Owner: remoteiq
--

CREATE VIEW public.roles_with_meta AS
 SELECT r.id,
    r.name,
    COALESCE(rm.description, ''::text) AS description,
    COALESCE(rm.permissions, '{}'::text[]) AS permissions,
    COALESCE(rm.updated_at, r.created_at) AS updated_at,
    r.created_at,
    ( SELECT (count(*))::integer AS count
           FROM public.users u
          WHERE (lower(u.role) = lower(r.name))) AS users_count
   FROM (public.roles r
     LEFT JOIN public.role_meta rm ON ((rm.role_name = r.name)));


ALTER VIEW public.roles_with_meta OWNER TO remoteiq;

--
-- Name: sessions; Type: TABLE; Schema: public; Owner: remoteiq
--

CREATE TABLE public.sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    jti text NOT NULL,
    user_agent text,
    ip inet,
    created_at timestamp with time zone DEFAULT now(),
    last_seen timestamp with time zone DEFAULT now(),
    revoked_at timestamp with time zone,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    trusted boolean DEFAULT false NOT NULL
);


ALTER TABLE public.sessions OWNER TO remoteiq;

--
-- Name: support_legal; Type: TABLE; Schema: public; Owner: remoteiq
--

CREATE TABLE public.support_legal (
    id integer NOT NULL,
    support_email text,
    support_phone text,
    knowledge_base_url text,
    status_page_url text,
    privacy_policy_url text,
    terms_url text,
    gdpr_contact_email text,
    legal_address text,
    ticket_portal_url text,
    phone_hours text,
    notes_html text
);


ALTER TABLE public.support_legal OWNER TO remoteiq;

--
-- Name: support_legal_settings; Type: TABLE; Schema: public; Owner: remoteiq
--

CREATE TABLE public.support_legal_settings (
    id integer NOT NULL,
    support_email text,
    support_phone text,
    support_url text,
    status_page_url text,
    kb_url text,
    terms_url text,
    privacy_url text,
    gdpr_contact text,
    dmca_contact text,
    show_chat_widget boolean DEFAULT false,
    chat_widget_code text,
    updated_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.support_legal_settings OWNER TO remoteiq;

--
-- Name: tickets; Type: TABLE; Schema: public; Owner: remoteiq
--

CREATE TABLE public.tickets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    number bigint NOT NULL,
    title text NOT NULL,
    description text,
    status text DEFAULT 'open'::text NOT NULL,
    priority text DEFAULT 'normal'::text NOT NULL,
    requester_name text,
    requester_email text,
    assignee_id uuid,
    client text,
    site text,
    device_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    customer_id text,
    customer_uuid uuid,
    assignee_user_id uuid
);


ALTER TABLE public.tickets OWNER TO remoteiq;

--
-- Name: tickets_number_seq; Type: SEQUENCE; Schema: public; Owner: remoteiq
--

ALTER TABLE public.tickets ALTER COLUMN number ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.tickets_number_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: trusted_devices; Type: TABLE; Schema: public; Owner: remoteiq
--

CREATE TABLE public.trusted_devices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    device_fingerprint text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL
);


ALTER TABLE public.trusted_devices OWNER TO remoteiq;

--
-- Name: agent_jobs id; Type: DEFAULT; Schema: public; Owner: remoteiq
--

ALTER TABLE ONLY public.agent_jobs ALTER COLUMN id SET DEFAULT nextval('public.agent_jobs_id_seq'::regclass);


--
-- Name: agent_software id; Type: DEFAULT; Schema: public; Owner: remoteiq
--

ALTER TABLE ONLY public.agent_software ALTER COLUMN id SET DEFAULT nextval('public.agent_software_id_seq'::regclass);


--
-- Name: agents id; Type: DEFAULT; Schema: public; Owner: remoteiq
--

ALTER TABLE ONLY public.agents ALTER COLUMN id SET DEFAULT nextval('public.agents_id_seq'::regclass);


--
-- Name: dkim_keys id; Type: DEFAULT; Schema: public; Owner: remoteiq
--

ALTER TABLE ONLY public.dkim_keys ALTER COLUMN id SET DEFAULT nextval('public.dkim_keys_id_seq'::regclass);


--
-- Name: email_inbound_events id; Type: DEFAULT; Schema: public; Owner: remoteiq
--

ALTER TABLE ONLY public.email_inbound_events ALTER COLUMN id SET DEFAULT nextval('public.email_inbound_events_id_seq'::regclass);


--
-- Name: imap_ingested id; Type: DEFAULT; Schema: public; Owner: remoteiq
--

ALTER TABLE ONLY public.imap_ingested ALTER COLUMN id SET DEFAULT nextval('public.imap_ingested_id_seq'::regclass);


--
-- Data for Name: agent_jobs; Type: TABLE DATA; Schema: public; Owner: remoteiq
--

COPY public.agent_jobs (id, agent_id, kind, payload, status, result, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: agent_software; Type: TABLE DATA; Schema: public; Owner: remoteiq
--

COPY public.agent_software (agent_id, name, version, publisher, install_date, updated_at, id) FROM stdin;
4	Mozilla Firefox (x64 en-US)	144.0.2	Mozilla	\N	2025-10-30 21:00:12.520201+00	33139
4	Bodycam	\N	Reissad Studio	\N	2025-10-30 19:04:06.111166+00	31223
4	Watch_Dogs	\N	Ubisoft	\N	2025-10-30 19:04:06.111166+00	31224
4	theHunter: Call of the Wild™	\N	Expansive Worlds	\N	2025-10-30 19:04:06.111166+00	31242
4	Satisfactory	\N	Coffee Stain Studios	\N	2025-10-30 19:04:06.111166+00	31243
4	Ancestors: The Humankind Odyssey	\N	Panache Digital Games	\N	2025-10-30 19:04:06.111166+00	31244
4	The Invisible Hand	\N	Power Struggle Games	\N	2025-10-30 19:04:06.111166+00	31245
4	Raft	\N	Redbeet Interactive	\N	2025-10-30 19:04:06.111166+00	31246
4	Occupy Mars: The Game	\N	▲ Pyramid Games	\N	2025-10-30 19:04:06.111166+00	31247
4	Green Hell	\N	Creepy Jar	\N	2025-10-30 19:04:06.111166+00	31248
4	Control Ultimate Edition	\N	Remedy Entertainment	\N	2025-10-30 19:04:06.111166+00	31249
4	Among Us	\N	Innersloth	\N	2025-10-30 19:04:06.111166+00	31250
4	Cities: Skylines II	\N	Colossal Order Ltd.	\N	2025-10-30 19:04:06.111166+00	31251
4	Tryton 64bit 6.0.41 (remove only)	\N	\N	\N	2025-10-30 19:04:06.111166+00	31252
4	Unity 6000.0.32f1	6000.0.32f1	Unity Technologies ApS	\N	2025-10-30 19:04:06.111166+00	31253
4	Unity Hub 3.10.0	3.10.0	Unity Technologies Inc.	\N	2025-10-30 19:04:06.111166+00	31254
4	WinRAR 6.11 (64-bit)	6.11.0	win.rar GmbH	\N	2025-10-30 19:04:06.111166+00	31255
4	XnView MP (x64)	1.9.3.0	Pierre-e Gougelet	2025-09-11 00:00:00+00	2025-10-30 19:04:06.111166+00	31256
4	Microsoft Visual C++ 2013 x64 Additional Runtime - 12.0.40664	12.0.40664	Microsoft Corporation	2025-09-22 00:00:00+00	2025-10-30 19:04:06.111166+00	31257
4	Microsoft GameInput	10.1.26100.6154	Microsoft Corporation	2025-10-16 00:00:00+00	2025-10-30 19:04:06.111166+00	31258
4	IIS Express Application Compatibility Database for x64	\N	\N	\N	2025-10-30 19:04:06.111166+00	31259
4	WD_BLACK AN1500	1.0.14.0	ENE TECHNOLOGY INC.	2023-12-28 00:00:00+00	2025-10-30 19:04:06.111166+00	31260
4	Python 3.12.2 Executables (64-bit)	3.12.2150.0	Python Software Foundation	2024-03-06 00:00:00+00	2025-10-30 19:04:06.111166+00	31261
4	Universal CRT Tools x64	10.1.19041.5609	Microsoft Corporation	2025-07-08 00:00:00+00	2025-10-30 19:04:06.111166+00	31262
4	iTunes	12.13.9.1	Apple Inc.	2025-10-17 00:00:00+00	2025-10-30 19:04:06.111166+00	31263
4	Microsoft ODBC Driver 17 for SQL Server	17.10.6.1	Microsoft Corporation	2024-12-26 00:00:00+00	2025-10-30 19:04:06.111166+00	31264
4	Microsoft.NET.Sdk.Maui.Manifest-8.0.100 (x64)	8.0.3	Microsoft Corporation	2025-10-26 00:00:00+00	2025-10-30 19:04:06.111166+00	31265
4	ASUS Ambient HAL	4.2.0.0	ASUSTeK COMPUTER INC.	2024-12-12 00:00:00+00	2025-10-30 19:04:06.111166+00	31267
4	IntelliTraceProfilerProxy	15.0.18198.01	Microsoft Corporation	2024-12-26 00:00:00+00	2025-10-30 19:04:06.111166+00	31268
4	Microsoft .NET 8.0 Templates 8.0.415 (x64)	32.13.57780	Microsoft Corporation	2025-10-26 00:00:00+00	2025-10-30 19:04:06.111166+00	31269
4	Microsoft Visual C++ 2010  x64 Redistributable - 10.0.40219	10.0.40219	Microsoft Corporation	2025-09-22 00:00:00+00	2025-10-30 19:04:06.111166+00	31270
4	Microsoft.NET.Workload.Emscripten.net7.Manifest (x64)	64.84.40819	Microsoft Corporation	2025-10-26 00:00:00+00	2025-10-30 19:04:06.111166+00	31271
4	Patriot Viper DRAM RGB	1.0.9.8	Patriot Memory	2024-12-12 00:00:00+00	2025-10-30 19:04:06.111166+00	31272
4	Python 3.13.7 Add to Path (64-bit)	3.13.7150.0	Python Software Foundation	2025-09-23 00:00:00+00	2025-10-30 19:04:06.111166+00	31273
4	ASUS AURA Extension Card HAL	1.1.0.20	ASUSTeK COMPUTER INC.	2023-12-28 00:00:00+00	2025-10-30 19:04:06.111166+00	31274
4	ROG Live Service	2.4.26.0	ASUSTek COMPUTER INC.	2024-12-19 00:00:00+00	2025-10-30 19:04:06.111166+00	31275
4	Microsoft ASP.NET Core 8.0.21 Targeting Pack (x64)	8.0.21.25475	Microsoft Corporation	2025-10-26 00:00:00+00	2025-10-30 19:04:06.111166+00	31276
4	Microsoft.NET.Workload.Mono.Toolchain.net6.Manifest (x64)	64.84.40925	Microsoft Corporation	2025-10-26 00:00:00+00	2025-10-30 19:04:06.111166+00	31277
4	Microsoft .NET AppHost Pack - 8.0.21 (x64)	64.84.40925	Microsoft Corporation	2025-10-26 00:00:00+00	2025-10-30 19:04:06.111166+00	31278
4	ASUS AURA Motherboard HAL	1.5.0.2	ASUSTeK COMPUTER INC.	2024-12-12 00:00:00+00	2025-10-30 19:04:06.111166+00	31279
4	ENE_EHD_M2_HAL	1.0.13.0	ENE TECHNOLOGY INC.	2024-12-12 00:00:00+00	2025-10-30 19:04:06.111166+00	31280
4	Microsoft Visual C++ 2012 x64 Additional Runtime - 11.0.61135	11.0.61135	Microsoft Corporation	2025-09-22 00:00:00+00	2025-10-30 19:04:06.111166+00	31281
4	AniMe Matrix MB EN	1.0.1	ASUS	2023-12-28 00:00:00+00	2025-10-30 19:04:06.111166+00	31282
4	Bitvise SSH Client - FlowSshNet (x64)	9.42.0.0	Bitvise Limited	2025-02-17 00:00:00+00	2025-10-30 19:04:06.111166+00	31283
4	SoundApp	2024.0.2	Boris FX	2025-01-03 00:00:00+00	2025-10-30 19:04:06.111166+00	31284
4	Microsoft Azure Libraries for .NET – v2.9	3.0.2310.23	Microsoft Corporation	2024-12-26 00:00:00+00	2025-10-30 19:04:06.111166+00	31285
4	Microsoft Command Line Utilities 15 for SQL Server	15.0.1300.359	Microsoft Corporation	2024-12-26 00:00:00+00	2025-10-30 19:04:06.111166+00	31287
4	Microsoft Visual C++ 2022 X64 Minimum Runtime - 14.44.35211	14.44.35211	Microsoft Corporation	2025-09-22 00:00:00+00	2025-10-30 19:04:06.111166+00	31288
4	Python 3.12.2 Core Interpreter (64-bit)	3.12.2150.0	Python Software Foundation	2024-03-06 00:00:00+00	2025-10-30 19:04:06.111166+00	31289
4	AMD WVR64	1.0.2	Advanced Micro Devices, Inc.	2024-08-29 00:00:00+00	2025-10-30 19:04:06.111166+00	31290
4	Microsoft SQL Server 2016 LocalDB	13.3.7037.1	Microsoft Corporation	2024-12-26 00:00:00+00	2025-10-30 19:04:06.111166+00	31291
4	Branding64	1.00.0009	Advanced Micro Devices, Inc.	2024-08-29 00:00:00+00	2025-10-30 19:04:06.111166+00	31292
4	ScreenToGif	2.41	Nicke Manarin	2024-04-29 00:00:00+00	2025-10-30 19:04:06.111166+00	31293
4	Logitech G HUB	2025.7.768359	Logitech	\N	2025-10-30 19:04:06.111166+00	31294
4	Windows App Certification Kit Native Components	10.1.19041.5609	Microsoft Corporation	2025-07-08 00:00:00+00	2025-10-30 19:04:06.111166+00	31295
4	Microsoft Visual C++ 2013 x64 Minimum Runtime - 12.0.40664	12.0.40664	Microsoft Corporation	2025-09-22 00:00:00+00	2025-10-30 19:04:06.111166+00	31296
4	Microsoft ASP.NET Core Module V2 for IIS Express	16.0.21322.0	Microsoft Corporation	2024-12-26 00:00:00+00	2025-10-30 19:04:06.111166+00	31297
4	Microsoft.NET.Sdk.tvOS.Manifest-8.0.100 (x64)	17.0.8478	Microsoft Corporation	2025-10-26 00:00:00+00	2025-10-30 19:04:06.111166+00	31298
4	Bonjour	3.1.0.1	Apple Inc.	2025-02-20 00:00:00+00	2025-10-30 19:04:06.111166+00	31299
4	Serato DJ Pro	2.4.1.1808	Serato Limited	2024-09-25 00:00:00+00	2025-10-30 19:04:06.111166+00	31300
4	Microsoft ASP.NET Core 8.0.21 Shared Framework (x64)	8.0.21.25475	Microsoft Corporation	2025-10-26 00:00:00+00	2025-10-30 19:04:06.111166+00	31301
4	Microsoft Visual C++ 2008 Redistributable - x64 9.0.30729.7523	9.0.30729.7523	Microsoft Corporation	2025-09-22 00:00:00+00	2025-10-30 19:04:06.111166+00	31302
4	ROGFontInstaller	1.0.0	ASUS	2023-12-28 00:00:00+00	2025-10-30 19:04:06.111166+00	31303
4	Cyberpunk 2077 Bonus Content	\N	CD PROJEKT RED	\N	2025-10-30 19:04:06.111166+00	31212
4	HITMAN 3	\N	IO Interactive A/S	\N	2025-10-30 19:04:06.111166+00	31213
4	Occupy Mars: Co-Op Playtest	\N	\N	\N	2025-10-30 19:04:06.111166+00	31214
4	Space Engineers	\N	Keen Software House	\N	2025-10-30 19:04:06.111166+00	31225
4	Microsoft Visual Studio 2010 Tools for Office Runtime (x64)	10.0.60922	Microsoft Corporation	2025-09-22 00:00:00+00	2025-10-30 19:04:06.111166+00	31304
4	Windows SDK DirectX x64 Remote	10.1.19041.5609	Microsoft Corporation	2025-07-08 00:00:00+00	2025-10-30 19:04:06.111166+00	31305
4	Microsoft Windows Desktop Runtime - 6.0.36 (x64)	48.144.23186	Microsoft Corporation	2024-11-14 00:00:00+00	2025-10-30 19:04:06.111166+00	31306
4	Revo Uninstaller Pro 5.3.0	5.3.0	VS Revo Group, Ltd.	2024-08-27 00:00:00+00	2025-10-30 19:04:06.111166+00	31307
4	Python 3.13.7 Test Suite (64-bit)	3.13.7150.0	Python Software Foundation	2025-09-23 00:00:00+00	2025-10-30 19:04:06.111166+00	31308
4	Active Directory Authentication Library for SQL Server	15.0.1300.359	Microsoft Corporation	2024-12-26 00:00:00+00	2025-10-30 19:04:06.111166+00	31309
4	Microsoft.NET.Sdk.iOS.Manifest-8.0.100 (x64)	17.0.8478	Microsoft Corporation	2025-10-26 00:00:00+00	2025-10-30 19:04:06.111166+00	31310
4	Silhouette Studio	4.5.791	Silhouette America	2024-07-13 00:00:00+00	2025-10-30 19:04:06.111166+00	31311
4	Microsoft Visual Studio Installer	3.14.2086.54749	Microsoft Corporation	2024-12-26 00:00:00+00	2025-10-30 19:04:06.111166+00	31312
4	Microsoft .NET Host - 8.0.21 (x64)	64.84.40925	Microsoft Corporation	2025-10-26 00:00:00+00	2025-10-30 19:04:06.111166+00	31313
4	Java 8 Update 471 (64-bit)	8.0.4710.9	Oracle Corporation	2025-10-26 00:00:00+00	2025-10-30 19:04:06.111166+00	31314
4	AMD Settings	2024.0823.1152.2026	Advanced Micro Devices, Inc.	2024-08-29 00:00:00+00	2025-10-30 19:04:06.111166+00	31315
4	AMD DVR64	1.0.2	Advanced Micro Devices, Inc.	2024-08-29 00:00:00+00	2025-10-30 19:04:06.111166+00	31316
4	Microsoft.NET.Workload.Mono.Toolchain.Current.Manifest (x64)	64.84.40925	Microsoft Corporation	2025-10-26 00:00:00+00	2025-10-30 19:04:06.111166+00	31317
4	Universal Holtek RGB DRAM	1.0.0.7	PD	2024-12-12 00:00:00+00	2025-10-30 19:04:06.111166+00	31318
4	Virtual Audio Cable (lite)	4.70	Eugene V. Muzychenko	\N	2025-10-30 19:04:06.111166+00	31319
4	Home Designer Pro 2024	25.1.0.0	Chief Architect	2025-06-09 00:00:00+00	2025-10-30 19:04:06.111166+00	31320
4	Voicemod	2.48.0.0	Voicemod, Inc., Sucursal en EspaÃ±a	2024-03-02 00:00:00+00	2025-10-30 19:04:06.111166+00	31321
4	Microsoft Visual C++ 2022 X64 Additional Runtime - 14.44.35211	14.44.35211	Microsoft Corporation	2025-09-22 00:00:00+00	2025-10-30 19:04:06.111166+00	31322
4	Windows Subsystem for Linux	2.6.1.0	Microsoft Corporation	2025-09-25 00:00:00+00	2025-10-30 19:04:06.111166+00	31323
4	Microsoft Silverlight	5.1.50918.0	Microsoft Corporation	2023-12-13 00:00:00+00	2025-10-30 19:04:06.111166+00	31324
4	Microsoft Web Deploy 4.0	10.0.8215	Microsoft Corporation	2024-12-26 00:00:00+00	2025-10-30 19:04:06.111166+00	31325
4	BorisFX CrumplePop	2023.6	Team V.R	2025-01-03 00:00:00+00	2025-10-30 19:04:06.111166+00	31326
4	Patriot Viper M2 SSD RGB	1.1.0.3	Patriot Memory	2023-12-28 00:00:00+00	2025-10-30 19:04:06.111166+00	31327
4	Microsoft.NET.Sdk.MacCatalyst.Manifest-8.0.100 (x64)	17.0.8478	Microsoft Corporation	2025-10-26 00:00:00+00	2025-10-30 19:04:06.111166+00	31328
4	Microsoft .NET Targeting Pack - 8.0.21 (x64)	64.84.40925	Microsoft Corporation	2025-10-26 00:00:00+00	2025-10-30 19:04:06.111166+00	31329
4	Ark Server Manager	1.1.446	Bletch1971	2024-05-12 00:00:00+00	2025-10-30 19:04:06.111166+00	31330
4	Microsoft System CLR Types for SQL Server 2019 CTP2.2	15.0.1200.24	Microsoft Corporation	2024-12-26 00:00:00+00	2025-10-30 19:04:06.111166+00	31331
4	Microsoft.NET.Workload.Mono.Toolchain.net7.Manifest (x64)	64.84.40925	Microsoft Corporation	2025-10-26 00:00:00+00	2025-10-30 19:04:06.111166+00	31332
4	Office 16 Click-to-Run Licensing Component	16.0.19029.20208	Microsoft Corporation	2025-08-23 00:00:00+00	2025-10-30 19:04:06.111166+00	31333
4	Office 16 Click-to-Run Extensibility Component	16.0.19231.20216	Microsoft Corporation	2025-10-25 00:00:00+00	2025-10-30 19:04:06.111166+00	31334
4	Microsoft Azure Authoring Tools - v2.9.7	2.9.8999.45	Microsoft Corporation	2024-12-26 00:00:00+00	2025-10-30 19:04:06.111166+00	31335
4	AMD User Experience Program Installer	2410.37.04.823	Advanced Micro Devices, Inc.	2024-08-29 00:00:00+00	2025-10-30 19:04:06.111166+00	31336
4	Python 3.12.2 Test Suite (64-bit)	3.12.2150.0	Python Software Foundation	2024-03-06 00:00:00+00	2025-10-30 19:04:06.111166+00	31337
4	Mattermost	5.9.0.0	Mattermost, Inc.	2024-10-25 00:00:00+00	2025-10-30 19:04:06.111166+00	31338
4	Kingston AURA DRAM Component	1.1.36	KINGSTON COMPONENTS INC.	2024-12-12 00:00:00+00	2025-10-30 19:04:06.111166+00	31339
4	PHISON HAL	1.0.9.0	PHISON Electronics Corp.	2023-12-28 00:00:00+00	2025-10-30 19:04:06.111166+00	31340
4	Python 3.13.7 Development Libraries (64-bit)	3.13.7150.0	Python Software Foundation	2025-09-23 00:00:00+00	2025-10-30 19:04:06.111166+00	31341
4	EpsonNet Print	3.1.4.0	SEIKO EPSON Corporation	2023-12-13 00:00:00+00	2025-10-30 19:04:06.111166+00	31342
4	Microsoft.NET.Sdk.macOS.Manifest-8.0.100 (x64)	14.0.8478	Microsoft Corporation	2025-10-26 00:00:00+00	2025-10-30 19:04:06.111166+00	31343
4	Microsoft.NET.Workload.Emscripten.net6.Manifest (x64)	64.84.40819	Microsoft Corporation	2025-10-26 00:00:00+00	2025-10-30 19:04:06.111166+00	31344
4	Microsoft .NET AppHost Pack - 8.0.21 (x64_x86)	64.84.40925	Microsoft Corporation	2025-10-26 00:00:00+00	2025-10-30 19:04:06.111166+00	31345
4	Product Improvement Study for HP LaserJet Pro MFP 4101 4102 4103 4104	54.4.5330.23293	HP Inc.	2025-06-03 00:00:00+00	2025-10-30 19:04:06.111166+00	31346
4	Python 3.13.7 Standard Library (64-bit)	3.13.7150.0	Python Software Foundation	2025-09-23 00:00:00+00	2025-10-30 19:04:06.111166+00	31347
4	Microsoft Windows Desktop Runtime - 8.0.21 (x64)	64.84.40919	Microsoft Corporation	2025-10-26 00:00:00+00	2025-10-30 19:04:06.111166+00	31348
4	VS Script Debugging Common	16.0.102.0	Microsoft Corporation	2024-12-26 00:00:00+00	2025-10-30 19:04:06.111166+00	31349
4	Python 3.13.7 Tcl/Tk Support (64-bit)	3.13.7150.0	Python Software Foundation	2025-09-23 00:00:00+00	2025-10-30 19:04:06.111166+00	31351
4	Paradox Launcher v2	2.4.0	Paradox Interactive	2024-07-25 00:00:00+00	2025-10-30 19:04:06.111166+00	31352
4	Microsoft .NET Standard Targeting Pack - 2.1.0 (x64)	24.0.28113	Microsoft Corporation	2025-10-26 00:00:00+00	2025-10-30 19:04:06.111166+00	31353
4	HP Universal Fax Driver	5.0.82.4109	HP Inc.	2025-06-03 00:00:00+00	2025-10-30 19:04:06.111166+00	31354
4	Microsoft Teams Meeting Add-in for Microsoft Office	1.25.24601	Microsoft	2025-10-05 00:00:00+00	2025-10-30 19:04:06.111166+00	31355
4	Corsair iCUE5 Software	5.14.93	Corsair	\N	2025-10-30 19:04:06.111166+00	31356
4	Microsoft .NET Host FX Resolver - 6.0.36 (x64)	48.144.23141	Microsoft Corporation	2024-11-14 00:00:00+00	2025-10-30 19:04:06.111166+00	31357
4	IIS Express Application Compatibility Database for x86	\N	\N	\N	2025-10-30 19:04:06.111166+00	31358
4	Microsoft Visual C++ 2005 Redistributable (x64)	8.0.61186	Microsoft Corporation	2025-09-22 00:00:00+00	2025-10-30 19:04:06.111166+00	31359
4	Microsoft Visual C++ 2019 X64 Debug Runtime - 14.29.30157	14.29.30157	Microsoft Corporation	2025-09-23 00:00:00+00	2025-10-30 19:04:06.111166+00	31360
4	Microsoft .NET Host FX Resolver - 8.0.21 (x64)	64.84.40925	Microsoft Corporation	2025-10-26 00:00:00+00	2025-10-30 19:04:06.111166+00	31361
4	Krisp Audio Drivers	3.0.4.1	Krisp Technologies, Inc.	2024-04-18 00:00:00+00	2025-10-30 19:04:06.111166+00	31362
4	PowerShell 7-x64	7.5.3.0	Microsoft Corporation	2025-10-10 00:00:00+00	2025-10-30 19:04:06.111166+00	31363
4	Python 3.12.2 Tcl/Tk Support (64-bit)	3.12.2150.0	Python Software Foundation	2024-03-06 00:00:00+00	2025-10-30 19:04:06.111166+00	31364
4	Microsoft.NET.Sdk.Android.Manifest-8.0.100 (x64)	34.0.43	Microsoft Corporation	2025-10-26 00:00:00+00	2025-10-30 19:04:06.111166+00	31365
4	AURA DRAM Component	1.1.27	ASUS	2024-12-12 00:00:00+00	2025-10-30 19:04:06.111166+00	31366
4	Canon MF642C/643C/644C	6.4.0.5	CANON INC.	\N	2025-10-30 19:04:06.111166+00	31367
4	Microsoft .NET Host FX Resolver - 6.0.16 (x64)	48.67.58427	Microsoft Corporation	2024-12-12 00:00:00+00	2025-10-30 19:04:06.111166+00	31368
4	Apple Mobile Device Support	19.0.1.27	Apple Inc.	2025-10-17 00:00:00+00	2025-10-30 19:04:06.111166+00	31369
4	Python 3.12.2 Documentation (64-bit)	3.12.2150.0	Python Software Foundation	2024-03-06 00:00:00+00	2025-10-30 19:04:06.111166+00	31370
4	Python 3.12.2 pip Bootstrap (64-bit)	3.12.2150.0	Python Software Foundation	2024-03-06 00:00:00+00	2025-10-30 19:04:06.111166+00	31371
4	Python 3.13.7 Core Interpreter (64-bit)	3.13.7150.0	Python Software Foundation	2025-09-23 00:00:00+00	2025-10-30 19:04:06.111166+00	31372
4	Microsoft .NET AppHost Pack - 8.0.21 (x64_arm64)	64.84.40925	Microsoft Corporation	2025-10-26 00:00:00+00	2025-10-30 19:04:06.111166+00	31373
4	EA app	13.423.0.5936	Electronic Arts	2024-02-16 00:00:00+00	2025-10-30 19:04:06.111166+00	31374
4	AURA lighting effect add-on x64	0.0.44	ASUSTek COMPUTER INC.	2024-12-12 00:00:00+00	2025-10-30 19:04:06.111166+00	31375
4	Microsoft Update Health Tools	5.72.0.0	Microsoft Corporation	2024-12-13 00:00:00+00	2025-10-30 19:04:06.111166+00	31376
4	Microsoft .NET Runtime - 6.0.16 (x64)	48.67.58427	Microsoft Corporation	2024-12-12 00:00:00+00	2025-10-30 19:04:06.111166+00	31377
4	Microsoft Windows Desktop Targeting Pack - 8.0.21 (x64)	64.84.40919	Microsoft Corporation	2025-10-26 00:00:00+00	2025-10-30 19:04:06.111166+00	31378
4	VS JIT Debugger	16.0.102.0	Microsoft Corporation	2024-12-26 00:00:00+00	2025-10-30 19:04:06.111166+00	31379
4	Krisp	2.57.8.0	Krisp Technologies, Inc.	2025-03-20 00:00:00+00	2025-10-30 19:04:06.111166+00	31381
4	Microsoft.NET.Workload.Emscripten.Current.Manifest (x64)	64.84.40819	Microsoft Corporation	2025-10-26 00:00:00+00	2025-10-30 19:04:06.111166+00	31382
4	Python 3.13.7 pip Bootstrap (64-bit)	3.13.7150.0	Python Software Foundation	2025-09-23 00:00:00+00	2025-10-30 19:04:06.111166+00	31383
4	Microsoft Visual C++ 2012 x64 Minimum Runtime - 11.0.61135	11.0.61135	Microsoft Corporation	2025-09-22 00:00:00+00	2025-10-30 19:04:06.111166+00	31384
4	ASUS Aura SDK	3.04.46	ASUSTek COMPUTER INC.	2024-12-12 00:00:00+00	2025-10-30 19:04:06.111166+00	31385
4	Python 3.13.7 Documentation (64-bit)	3.13.7150.0	Python Software Foundation	2025-09-23 00:00:00+00	2025-10-30 19:04:06.111166+00	31386
4	AMD Install Manager	25.20.25301.1159	Advanced Micro Devices, Inc.	2025-10-30 00:00:00+00	2025-10-30 19:04:06.111166+00	31387
4	OpenVPN Connect	3.4.4	OpenVPN Inc.	2024-07-12 00:00:00+00	2025-10-30 19:04:06.111166+00	31388
4	Application Verifier x64 External Package	10.1.19041.5609	Microsoft	2025-07-08 00:00:00+00	2025-10-30 19:04:06.111166+00	31389
4	Python 3.12.2 Add to Path (64-bit)	3.12.2150.0	Python Software Foundation	2024-03-06 00:00:00+00	2025-10-30 19:04:06.111166+00	31390
4	Node.js	22.19.0	Node.js Foundation	2025-09-23 00:00:00+00	2025-10-30 19:04:06.111166+00	31391
4	Microsoft .NET Host - 6.0.36 (x64)	48.144.23141	Microsoft Corporation	2024-11-14 00:00:00+00	2025-10-30 19:04:06.111166+00	31392
4	Update for x64-based Windows Systems (KB5001716)	8.94.0.0	Microsoft Corporation	2024-10-10 00:00:00+00	2025-10-30 19:04:06.111166+00	31393
4	ENE RGB HAL	1.1.53.0	Ene Tech.	2024-12-12 00:00:00+00	2025-10-30 19:04:06.111166+00	31394
4	DiagnosticsHub_CollectionService	16.11.36015	Microsoft Corporation	2025-05-14 00:00:00+00	2025-10-30 19:04:06.111166+00	31395
4	Python 3.12.2 Standard Library (64-bit)	3.12.2150.0	Python Software Foundation	2024-03-06 00:00:00+00	2025-10-30 19:04:06.111166+00	31396
4	Python 3.13.7 Executables (64-bit)	3.13.7150.0	Python Software Foundation	2025-09-23 00:00:00+00	2025-10-30 19:04:06.111166+00	31397
4	Java(TM) SE Development Kit 21.0.7 (64-bit)	21.0.7.0	Oracle Corporation	2025-05-20 00:00:00+00	2025-10-30 19:04:06.111166+00	31398
4	HP LaserJet Pro MFP 4101 4102 4103 4104 Basic Device Software	54.4.5330.23293	HP Inc.	2025-06-03 00:00:00+00	2025-10-30 19:04:06.111166+00	31399
4	Microsoft .NET Runtime - 8.0.21 (x64)	64.84.40925	Microsoft Corporation	2025-10-26 00:00:00+00	2025-10-30 19:04:06.111166+00	31401
4	ARMOURY CRATE Lite Service	5.9.14	ASUS	2023-12-28 00:00:00+00	2025-10-30 19:04:06.111166+00	31402
4	RyzenMasterSDK	1.2.3.5	Advanced Micro Devices, Inc.	2024-08-29 00:00:00+00	2025-10-30 19:04:06.111166+00	31403
4	Python 3.12.2 Development Libraries (64-bit)	3.12.2150.0	Python Software Foundation	2024-03-06 00:00:00+00	2025-10-30 19:04:06.111166+00	31404
4	Java(TM) SE Development Kit 17.0.10 (64-bit)	17.0.10.0	Oracle Corporation	2024-03-05 00:00:00+00	2025-10-30 19:04:06.111166+00	31405
4	Microsoft.NET.Sdk.Aspire.Manifest-8.0.100 (x64)	64.0.5426	Microsoft Corporation	2025-10-26 00:00:00+00	2025-10-30 19:04:06.111166+00	31406
4	Go Programming Language amd64 go1.22.4	1.22.4	https://go.dev	2024-06-08 00:00:00+00	2025-10-30 19:04:06.111166+00	31407
4	Synchronous Audio Router (64 bit)	0.13.1	Many Worlds	2024-12-14 00:00:00+00	2025-10-30 19:04:06.111166+00	31408
4	Epic Games Launcher Prerequisites (x64)	1.0.0.0	Epic Games, Inc.	2024-04-08 00:00:00+00	2025-10-30 19:04:06.111166+00	31409
4	Microsoft ASP.NET Core Module for IIS Express	12.2.18292.0	Microsoft Corporation	2024-12-26 00:00:00+00	2025-10-30 19:04:06.111166+00	31410
4	Microsoft .NET Toolset 8.0.415 (x64)	32.11.57780	Microsoft Corporation	2025-10-26 00:00:00+00	2025-10-30 19:04:06.111166+00	31411
4	Arcserve ImageManager	7.8.4.18	Arcserve LLC	2024-06-12 00:00:00+00	2025-10-30 19:04:06.111166+00	31412
4	3uAirPlayer3.0	3.01.65	ShangHai ZhangZheng Network Technology Co., Ltd.	\N	2025-10-30 19:04:06.111166+00	31413
4	3uTools(32bit)	3.20.009	Shenzhen Aidapu Network Technology Co.,Ltd.	\N	2025-10-30 19:04:06.111166+00	31414
4	Visual Studio Build Tools 2019 (2)	16.11.52	Microsoft Corporation	2025-09-23 00:00:00+00	2025-10-30 19:04:06.111166+00	31415
4	Visual Studio Community 2019	16.11.52	Microsoft Corporation	2024-12-26 00:00:00+00	2025-10-30 19:04:06.111166+00	31416
4	Adobe Creative Cloud	6.7.0.278	Adobe Inc.	\N	2025-10-30 19:04:06.111166+00	31417
4	AMD Chipset Software	6.07.22.037	Advanced Micro Devices, Inc.	\N	2025-10-30 19:04:06.111166+00	31418
4	Microsoft 365 Apps for business - en-us	16.0.19231.20216	Microsoft Corporation	\N	2025-10-30 19:04:06.111166+00	31194
4	Bellwright	\N	Donkey Crew	\N	2025-10-30 19:04:06.111166+00	31215
4	AnyDesk	ad 9.0.9	AnyDesk Software GmbH	\N	2025-10-30 19:04:06.111166+00	31419
4	Foxit Advanced PDF Editor 3	3.0.5.0	Foxit Corporation	2024-07-09 00:00:00+00	2025-10-30 19:04:06.111166+00	31420
4	Battle.net	\N	Blizzard Entertainment	\N	2025-10-30 19:04:06.111166+00	31421
4	Bitvise SSH Client 9.42 (remove only)	9.42	Bitvise Limited	\N	2025-10-30 19:04:06.111166+00	31422
4	WinFsp installed by Bitvise SSH Client (remove only)	2.0.23075	Bitvise Limited	\N	2025-10-30 19:04:06.111166+00	31423
4	Canon Easy-PhotoPrint Editor	1.8.0	Canon Inc.	\N	2025-10-30 19:04:06.111166+00	31424
4	Printer Registration	1.9.2	Canon Inc.	\N	2025-10-30 19:04:06.111166+00	31425
4	Canon IJ Printer Assistant Tool	1.90.3.30	Canon Inc.	\N	2025-10-30 19:04:06.111166+00	31426
4	Canon Inkjet Printer/Scanner/Fax Extended Survey Program	6.6.0	Canon Inc.	\N	2025-10-30 19:04:06.111166+00	31427
4	Canon IJ Network Scanner Selector EX2	2.0.10.2	Canon Inc.	\N	2025-10-30 19:04:06.111166+00	31428
4	Canon IJ Scan Utility	1.5.5.3	Canon Inc.	\N	2025-10-30 19:04:06.111166+00	31429
4	Device IP Configuration Utility 5.0.4	5.0.4	Schneider Electric	\N	2025-10-30 19:04:06.111166+00	31430
4	Epson PC-FAX Driver	\N	Seiko Epson Corporation	\N	2025-10-30 19:04:06.111166+00	31431
4	Epson Scan 2	\N	Seiko Epson Corporation	\N	2025-10-30 19:04:06.111166+00	31432
4	Escape from Tarkov	0.0.0.0.0	Battlestate Games	\N	2025-10-30 19:04:06.111166+00	31433
4	FileZilla 3.67.0	3.67.0	Tim Kosse	\N	2025-10-30 19:04:06.111166+00	31434
4	FL Studio 20	\N	Image-Line	\N	2025-10-30 19:04:06.111166+00	31435
4	FL Studio ASIO	\N	Image-Line	\N	2025-10-30 19:04:06.111166+00	31436
4	Google Chrome	142.0.7444.59	Google LLC	2025-10-28 00:00:00+00	2025-10-30 19:04:06.111166+00	31437
4	Guitar Guru Version 3.2.2.22	3.2.2.22	Musicnotes, Inc.	2024-07-27 00:00:00+00	2025-10-30 19:04:06.111166+00	31438
4	Adobe Illustrator 2024	28.2	Adobe Inc.	2024-08-21 00:00:00+00	2025-10-30 19:04:06.111166+00	31439
4	IObit Driver Booster 8.6.0.522	8.6.0.522	LRepacks	2023-12-13 00:00:00+00	2025-10-30 19:04:06.111166+00	31440
4	Linphone	5.2.4	Belledonne Communications	\N	2025-10-30 19:04:06.111166+00	31441
4	LSPD First Response	0.4.9	G17 Media	\N	2025-10-30 19:04:06.111166+00	31442
4	Macro Recorder 5.9.0	5.9.0	Jitbit Software	2024-04-18 00:00:00+00	2025-10-30 19:04:06.111166+00	31443
4	MEmu	9.2.0.0	Microvirt Software Technology Co., Ltd.	\N	2025-10-30 19:04:06.111166+00	31444
4	Microsoft Azure Storage Emulator - v5.10	5.10.19227.2113	Microsoft Corporation	2024-12-26 00:00:00+00	2025-10-30 19:04:06.111166+00	31445
4	Microsoft Edge	141.0.3537.99	Microsoft Corporation	2025-10-25 00:00:00+00	2025-10-30 19:04:06.111166+00	31446
4	Microsoft Edge WebView2 Runtime	141.0.3537.99	Microsoft Corporation	2025-10-25 00:00:00+00	2025-10-30 19:04:06.111166+00	31447
4	Npcap	1.79	Nmap Project	\N	2025-10-30 19:04:06.111166+00	31449
4	OBS Studio	31.1.2	OBS Project	\N	2025-10-30 19:04:06.111166+00	31450
4	Adobe Photoshop 2020	21.0.2	Adobe Systems Incorporated	2023-12-13 00:00:00+00	2025-10-30 19:04:06.111166+00	31452
4	Adobe Photoshop 2024	25.5.0.375	Adobe Inc.	2024-08-25 00:00:00+00	2025-10-30 19:04:06.111166+00	31453
4	Plex	1.100.1	Plex, Inc.	\N	2025-10-30 19:04:06.111166+00	31454
4	Adobe Premiere Pro 2024	24.2.1	Adobe Inc.	2024-12-06 00:00:00+00	2025-10-30 19:04:06.111166+00	31455
4	Punch! Home Design - Platinum	\N	\N	\N	2025-10-30 19:04:06.111166+00	31456
4	qBittorrent	5.1.0	The qBittorrent project	\N	2025-10-30 19:04:06.111166+00	31457
4	Razer Chroma	4.0.562	Razer Inc.	\N	2025-10-30 19:04:06.111166+00	31458
4	Razer Synapse	4.0.562	Razer Inc.	\N	2025-10-30 19:04:06.111166+00	31459
4	Rockstar Games Launcher	1.0.103.2534	Rockstar Games	\N	2025-10-30 19:04:06.111166+00	31460
4	Rockstar Games SDK	2.4.0.101	Rockstar Games	\N	2025-10-30 19:04:06.111166+00	31461
4	Streamlabs Plugin Package	\N	Streamlabs	\N	2025-10-30 19:04:06.111166+00	31462
4	Streamlabs Plugin Service	\N	Streamlabs	\N	2025-10-30 19:04:06.111166+00	31463
4	Steam	2.10.91.91	Valve Corporation	\N	2025-10-30 19:04:06.111166+00	31464
4	Unity 2021.3.45f1	2021.3.45f1	Unity Technologies ApS	\N	2025-10-30 19:04:06.111166+00	31465
4	Ubisoft Connect	73.0	Ubisoft	\N	2025-10-30 19:04:06.111166+00	31466
4	Epson ET-16650 User’s Guide	1.0	Epson America, Inc.	2024-08-21 00:00:00+00	2025-10-30 19:04:06.111166+00	31467
4	UXP WebView Support	1.2.0	Adobe Inc.	2024-09-26 00:00:00+00	2025-10-30 19:04:06.111166+00	31468
4	Virtual DJ Studio 8.3.0	\N	Next Generation Software	2024-12-15 00:00:00+00	2025-10-30 19:04:06.111166+00	31469
4	VLC media player	3.0.21	VideoLAN	\N	2025-10-30 19:04:06.111166+00	31470
4	Epson Software Updater	4.6.10	Seiko Epson Corporation	2025-09-03 00:00:00+00	2025-10-30 19:04:06.111166+00	31471
4	Universal CRT Redistributable	10.0.26624	Microsoft Corporation	2025-09-23 00:00:00+00	2025-10-30 19:04:06.111166+00	31473
4	Microsoft Windows Desktop Runtime - 6.0.36 (x64)	6.0.36.34217	Microsoft Corporation	\N	2025-10-30 19:04:06.111166+00	31474
4	Streamlabs Chatbot version 1.0.2.86	1.0.2.86	Streamlabs	2025-09-22 00:00:00+00	2025-10-30 19:04:06.111166+00	31475
4	vs_minshellmsires	16.10.31303	Microsoft Corporation	2024-12-26 00:00:00+00	2025-10-30 19:04:06.111166+00	31476
4	Windows SDK Desktop Tools x86	10.1.19041.5609	Microsoft Corporation	2025-07-08 00:00:00+00	2025-10-30 19:04:06.111166+00	31477
4	WinRT Intellisense Mobile - en-us	10.1.19041.5609	Microsoft Corporation	2025-07-08 00:00:00+00	2025-10-30 19:04:06.111166+00	31478
4	Epson FAX Utility	4.02.01.05	Seiko Epson Corporation	2024-08-21 00:00:00+00	2025-10-30 19:04:06.111166+00	31479
4	Tactical RMM Agent	2.8.0	AmidaWare Inc	2024-10-07 00:00:00+00	2025-10-30 19:04:06.111166+00	31480
4	Aiseesoft iPhone Unlocker 2.0.86	2.0.86	Aiseesoft Studio	2025-01-07 00:00:00+00	2025-10-30 19:04:06.111166+00	31482
4	vs_filehandler_amd64	16.11.31503	Microsoft Corporation	2024-12-26 00:00:00+00	2025-10-30 19:04:06.111166+00	31483
4	QuickTime 7	7.75.80.95	Apple Inc.	2024-09-25 00:00:00+00	2025-10-30 19:04:06.111166+00	31484
4	Microsoft .NET CoreRuntime SDK	1.1.27004.0	Microsoft Corporation	2024-12-26 00:00:00+00	2025-10-30 19:04:06.111166+00	31485
4	Windows IoT Extension SDK	10.1.19041.5609	Microsoft Corporation	2025-07-08 00:00:00+00	2025-10-30 19:04:06.111166+00	31486
4	icecap_collectionresources	16.11.34827	Microsoft Corporation	2024-12-26 00:00:00+00	2025-10-30 19:04:06.111166+00	31487
4	Visual C++ Library CRT Desktop Appx Package	14.29.30133	Microsoft Corporation	2024-12-26 00:00:00+00	2025-10-30 19:04:06.111166+00	31488
4	Tools for .Net 3.5	3.11.50727	Microsoft Corporation	2024-12-26 00:00:00+00	2025-10-30 19:04:06.111166+00	31489
4	Windows Desktop Extension SDK	10.1.19041.5609	Microsoft Corporation	2025-07-08 00:00:00+00	2025-10-30 19:04:06.111166+00	31490
4	Microsoft .NET Framework 4.7.2 Targeting Pack	4.7.03062	Microsoft Corporation	2024-12-26 00:00:00+00	2025-10-30 19:04:06.111166+00	31491
4	WinRT Intellisense UAP - en-us	10.1.19041.5609	Microsoft Corporation	2025-07-08 00:00:00+00	2025-10-30 19:04:06.111166+00	31492
4	HP FTP Plugin	56.0.480.0	HP	2025-06-03 00:00:00+00	2025-10-30 19:04:06.111166+00	31493
4	Visual C++ Library CRT Appx Package	14.29.30133	Microsoft Corporation	2024-12-26 00:00:00+00	2025-10-30 19:04:06.111166+00	31494
4	AURA lighting effect add-on	0.0.44	ASUSTek COMPUTER INC.	2024-12-12 00:00:00+00	2025-10-30 19:04:06.111166+00	31495
4	Epson Event Manager	3.11.79	Seiko Epson Corporation	2024-08-21 00:00:00+00	2025-10-30 19:04:06.111166+00	31496
4	Communicator	22.9.47.18	Verizon	2024-10-29 00:00:00+00	2025-10-30 19:04:06.111166+00	31497
4	Epson Printer Driver Security Support Tool	1.0.1.0	Seiko Epson Corporation	2025-08-20 00:00:00+00	2025-10-30 19:04:06.111166+00	31498
4	vs_clickoncebootstrappermsires	16.0.28329	Microsoft Corporation	2024-12-26 00:00:00+00	2025-10-30 19:04:06.111166+00	31499
4	Windows SDK Desktop Headers arm64	10.1.19041.5609	Microsoft Corporation	2025-07-08 00:00:00+00	2025-10-30 19:04:06.111166+00	31500
4	Windows SDK Desktop Tools arm64	10.1.19041.5609	Microsoft Corporation	2025-07-08 00:00:00+00	2025-10-30 19:04:06.111166+00	31501
4	Windows SDK Desktop Tools x64	10.1.19041.5609	Microsoft Corporation	2025-07-08 00:00:00+00	2025-10-30 19:04:06.111166+00	31502
4	Microsoft .NET Runtime - 6.0.16 (x64)	6.0.16.32323	Microsoft Corporation	\N	2025-10-30 19:04:06.111166+00	31503
4	Windows SDK Signing Tools	10.1.19041.5609	Microsoft Corporation	2025-07-08 00:00:00+00	2025-10-30 19:04:06.111166+00	31504
4	Microsoft .NET Framework 4.6 Targeting Pack	4.6.00081	Microsoft Corporation	2024-12-26 00:00:00+00	2025-10-30 19:04:06.111166+00	31505
4	WinRT Intellisense Desktop - Other Languages	10.1.19041.5609	Microsoft Corporation	2025-07-08 00:00:00+00	2025-10-30 19:04:06.111166+00	31506
4	Universal CRT Extension SDK	10.1.19041.5609	Microsoft Corporation	2025-07-08 00:00:00+00	2025-10-30 19:04:06.111166+00	31507
4	ROG FAN XPERT 4	4.02.04	ASUSTek Computer Inc.	\N	2025-10-30 19:04:06.111166+00	31508
4	Windows App Certification Kit SupportedApiList x86	10.1.19041.5609	Microsoft Corporation	2025-07-08 00:00:00+00	2025-10-30 19:04:06.111166+00	31509
4	vs_clickoncesigntoolmsi	16.0.28329	Microsoft Corporation	2024-12-26 00:00:00+00	2025-10-30 19:04:06.111166+00	31510
4	ASUS Framework Service	4.2.0.4	ASUSTeK Computer Inc.	2024-12-12 00:00:00+00	2025-10-30 19:04:06.111166+00	31511
4	AMD PPM Provisioning File Driver	8.0.0.33	Advanced Micro Devices, Inc.	2024-08-15 00:00:00+00	2025-10-30 19:04:06.111166+00	31512
4	vs_communitymsires	16.10.31213	Microsoft Corporation	2024-12-26 00:00:00+00	2025-10-30 19:04:06.111166+00	31513
4	vs_communitymsi	16.11.34930	Microsoft Corporation	2024-12-26 00:00:00+00	2025-10-30 19:04:06.111166+00	31514
4	Windows Simulator - ENU	16.0.35824	Microsoft Corporation	2025-03-25 00:00:00+00	2025-10-30 19:04:06.111166+00	31515
4	Epson Printer Connection Checker	3.4.1.0	Seiko Epson Corporation	2025-08-20 00:00:00+00	2025-10-30 19:04:06.111166+00	31516
4	HP SharePoint Plugin	56.0.480.0	HP	2025-06-03 00:00:00+00	2025-10-30 19:04:06.111166+00	31517
4	SDK ARM Additions	10.1.19041.5609	Microsoft Corporation	2025-07-08 00:00:00+00	2025-10-30 19:04:06.111166+00	31518
4	Launcher Prerequisites (x64)	1.0.0.0	Epic Games, Inc.	\N	2025-10-30 19:04:06.111166+00	31519
4	Windows SDK Redistributables	10.1.19041.5609	Microsoft Corporation	2025-07-08 00:00:00+00	2025-10-30 19:04:06.111166+00	31520
4	Windows Team Extension SDK Contracts	10.1.19041.5609	Microsoft Corporation	2025-07-08 00:00:00+00	2025-10-30 19:04:06.111166+00	31521
4	Microsoft .NET CoreRuntime For CoreCon	1.0.0.0	Microsoft Corporation	2024-12-26 00:00:00+00	2025-10-30 19:04:06.111166+00	31522
4	The Sims™ 4	1.104.58.1030	Electronic Arts, Inc.	\N	2025-10-30 19:04:06.111166+00	31523
4	Microsoft ASP.NET Web Tools Packages 16.0 - ENU	1.0.21125.0	Microsoft Corporation	2024-12-26 00:00:00+00	2025-10-30 19:04:06.111166+00	31524
4	Java Auto Updater	2.8.471.9	Oracle Corporation	2025-10-26 00:00:00+00	2025-10-30 19:04:06.111166+00	31525
4	MSI Development Tools	10.1.19041.5609	Microsoft Corporation	2025-07-08 00:00:00+00	2025-10-30 19:04:06.111166+00	31526
4	HP BIOS Configuration Utility	4.0.32.1	HP Inc.	2024-07-08 00:00:00+00	2025-10-30 19:04:06.111166+00	31527
4	HP EmailSMTP Plugin	56.0.480.0	HP	2025-06-03 00:00:00+00	2025-10-30 19:04:06.111166+00	31528
4	EPSON Scan PDF Extensions	1.03.02.02	Seiko Epson Corporation	2025-08-20 00:00:00+00	2025-10-30 19:04:06.111166+00	31529
4	WinAppDeploy	10.1.19041.5609	Microsoft Corporation	2025-07-08 00:00:00+00	2025-10-30 19:04:06.111166+00	31530
4	Microsoft .NET Framework 4.7.1 Targeting Pack	4.7.02558	Microsoft Corporation	2024-12-26 00:00:00+00	2025-10-30 19:04:06.111166+00	31531
4	Microsoft .NET Framework 4.5 Multi-Targeting Pack	4.5.50710	Microsoft Corporation	2024-12-26 00:00:00+00	2025-10-30 19:04:06.111166+00	31532
4	AURA Service	3.07.54	ASUSTeK Computer Inc.	2024-12-12 00:00:00+00	2025-10-30 19:04:06.111166+00	31533
4	Epic Online Services	2.0.44.0	Epic Games, Inc.	2024-04-08 00:00:00+00	2025-10-30 19:04:06.111166+00	31534
4	windows_toolscorepkg	16.11.34827	Microsoft Corporation	2024-12-26 00:00:00+00	2025-10-30 19:04:06.111166+00	31535
4	Simple Chord Detection version 1.2	1.2	UltimatePlugin	2024-07-29 00:00:00+00	2025-10-30 19:04:06.111166+00	31536
4	Windows Software Development Kit - Windows 10.0.19041.5609	10.1.19041.5609	Microsoft Corporation	\N	2025-10-30 19:04:06.111166+00	31537
4	TH8 RS Shifter	1.TH8RS.2023	Thrustmaster	2023-12-29 00:00:00+00	2025-10-30 19:04:06.111166+00	31538
4	Universal CRT Headers Libraries and Sources	10.1.19041.5609	Microsoft Corporation	2025-07-08 00:00:00+00	2025-10-30 19:04:06.111166+00	31545
4	vs_clickoncebootstrappermsi	16.10.31206	Microsoft Corporation	2024-12-26 00:00:00+00	2025-10-30 19:04:06.111166+00	31546
4	Microsoft Visual C++ 2005 Redistributable	8.0.61187	Microsoft Corporation	2025-09-22 00:00:00+00	2025-10-30 19:04:06.111166+00	31547
4	Microsoft TestPlatform SDK Local Feed	16.11.0.4953698	Microsoft	2024-12-26 00:00:00+00	2025-10-30 19:04:06.111166+00	31548
4	Microsoft NetStandard SDK	15.0.51105	Microsoft Corporation	2024-12-26 00:00:00+00	2025-10-30 19:04:06.111166+00	31549
4	Windows SDK for Windows Store Apps	10.1.19041.5609	Microsoft Corporation	2025-07-08 00:00:00+00	2025-10-30 19:04:06.111166+00	31550
4	Java 8 Update 471	8.0.4710.9	Oracle Corporation	2025-10-26 00:00:00+00	2025-10-30 19:04:06.111166+00	31551
4	Windows SDK Modern Non-Versioned Developer Tools	10.1.19041.5609	Microsoft Corporation	2025-07-08 00:00:00+00	2025-10-30 19:04:06.111166+00	31552
4	WinRT Intellisense Desktop - en-us	10.1.19041.5609	Microsoft Corporation	2025-07-08 00:00:00+00	2025-10-30 19:04:06.111166+00	31553
4	Windows SDK for Windows Store Apps Metadata	10.1.19041.5609	Microsoft Corporation	2025-07-08 00:00:00+00	2025-10-30 19:04:06.111166+00	31554
4	Microsoft Visual C++ 2013 x86 Minimum Runtime - 12.0.40664	12.0.40664	Microsoft Corporation	2025-09-22 00:00:00+00	2025-10-30 19:04:06.111166+00	31555
4	Move Transition version 3.1.5	3.1.5	Exeldro	2025-09-22 00:00:00+00	2025-10-30 19:04:06.111166+00	31556
4	Windows SDK Desktop Libs x86	10.1.19041.5609	Microsoft Corporation	2025-07-08 00:00:00+00	2025-10-30 19:04:06.111166+00	31557
4	Rust	\N	Facepunch Studios	\N	2025-10-30 19:04:06.111166+00	31226
4	FortressCraft Evolved	\N	ProjectorGames	\N	2025-10-30 19:04:06.111166+00	31227
4	Chained Together	\N	Anegar Games	\N	2025-10-30 19:04:06.111166+00	31228
4	ContractVille	\N	MYM Games Studios	\N	2025-10-30 19:04:06.111166+00	31229
4	Supermarket Together	\N	DeadDevsTellNoLies	\N	2025-10-30 19:04:06.111166+00	31230
4	Grand Theft Auto V	\N	Rockstar North	\N	2025-10-30 19:04:06.111166+00	31231
4	Battlefield™ 6 Open Beta	\N	\N	\N	2025-10-30 19:04:06.111166+00	31233
4	Grand Theft Auto V Enhanced	\N	Rockstar North	\N	2025-10-30 19:04:06.111166+00	31234
4	Space Engineers - Mod SDK	\N	\N	\N	2025-10-30 19:04:06.111166+00	31235
4	30 Days on Ship Demo	\N	Madnetic Games	\N	2025-10-30 19:04:06.111166+00	31236
4	RV There Yet?	\N	Nuggets Entertainment	\N	2025-10-30 19:04:06.111166+00	31237
4	Factorio	\N	Wube Software LTD.	\N	2025-10-30 19:04:06.111166+00	31238
4	Wallpaper Engine	\N	Wallpaper Engine Team	\N	2025-10-30 19:04:06.111166+00	31239
4	Borderlands 2	\N	Gearbox Software	\N	2025-10-30 19:04:06.111166+00	31240
4	SCUM	\N	Gamepires	\N	2025-10-30 19:04:06.111166+00	31241
4	Kits Configuration Installer	10.1.19041.5609	Microsoft	2025-07-08 00:00:00+00	2025-10-30 19:04:06.111166+00	31558
4	vs_minshellinteropmsi	16.10.31306	Microsoft Corporation	2024-12-26 00:00:00+00	2025-10-30 19:04:06.111166+00	31559
4	ClickOnce Bootstrapper Package for Microsoft .NET Framework	4.8.04739	Microsoft Corporation	2024-12-26 00:00:00+00	2025-10-30 19:04:06.111166+00	31560
4	Windows SDK for Windows Store Apps Libs	10.1.19041.5609	Microsoft Corporation	2025-07-08 00:00:00+00	2025-10-30 19:04:06.111166+00	31561
4	Python Launcher	3.13.7150.0	Python Software Foundation	2025-09-23 00:00:00+00	2025-10-30 19:04:06.111166+00	31562
4	Microsoft .NET Framework 4.6.1 Targeting Pack	4.6.01055	Microsoft Corporation	2024-12-26 00:00:00+00	2025-10-30 19:04:06.111166+00	31563
4	Windows SDK Desktop Headers arm	10.1.19041.5609	Microsoft Corporation	2025-07-08 00:00:00+00	2025-10-30 19:04:06.111166+00	31564
4	icecap_collection_neutral	16.11.34930	Microsoft Corporation	2024-12-26 00:00:00+00	2025-10-30 19:04:06.111166+00	31565
4	Windows SDK DirectX x86 Remote	10.1.19041.5609	Microsoft Corporation	2025-07-08 00:00:00+00	2025-10-30 19:04:06.111166+00	31566
4	Epson ScanSmart	3.7.13	Seiko Epson Corporation	2024-09-04 00:00:00+00	2025-10-30 19:04:06.111166+00	31567
4	Microsoft .NET Framework 4.7.1 Doc Redirected Targeting Pack (ENU)	4.7.02558	Microsoft Corporation	2024-12-26 00:00:00+00	2025-10-30 19:04:06.111166+00	31568
4	Universal CRT Redistributable	10.1.19041.5609	Microsoft Corporation	2025-07-08 00:00:00+00	2025-10-30 19:04:06.111166+00	31569
4	Windows SDK for Windows Store Apps Contracts	10.1.19041.5609	Microsoft Corporation	2025-07-08 00:00:00+00	2025-10-30 19:04:06.111166+00	31570
4	AMD_Chipset_Drivers	6.07.22.037	Advanced Micro Devices, Inc.	2024-08-15 00:00:00+00	2025-10-30 19:04:06.111166+00	31582
4	Windows SDK Desktop Headers x64	10.1.19041.5609	Microsoft Corporation	2025-07-08 00:00:00+00	2025-10-30 19:04:06.111166+00	31583
4	Windows Team Extension SDK	10.1.19041.5609	Microsoft Corporation	2025-07-08 00:00:00+00	2025-10-30 19:04:06.111166+00	31584
4	VS Immersive Activate Helper	16.0.102.0	Microsoft Corporation	2024-12-26 00:00:00+00	2025-10-30 19:04:06.111166+00	31585
4	Windows Simulator	16.0.35824	Microsoft Corporation	2025-03-25 00:00:00+00	2025-10-30 19:04:06.111166+00	31586
4	Windows SDK for Windows Store Apps Tools	10.1.19041.5609	Microsoft Corporation	2025-07-08 00:00:00+00	2025-10-30 19:04:06.111166+00	31587
4	ASUS Update Helper	1.3.107.145	ASUSTeK Computer Inc.	2025-10-30 00:00:00+00	2025-10-30 19:04:06.111166+00	31588
4	Microsoft Visual C++ 2015-2022 Redistributable (x86) - 14.32.31332	14.32.31332.0	Microsoft Corporation	\N	2025-10-30 19:04:06.111166+00	31589
4	icecap_collectionresourcesx64	16.11.34827	Microsoft Corporation	2024-12-26 00:00:00+00	2025-10-30 19:04:06.111166+00	31590
4	AMD SBxxx SMBus Driver	5.12.0.44	Advanced Micro Devices, Inc.	2024-08-15 00:00:00+00	2025-10-30 19:04:06.111166+00	31591
4	Microsoft .NET Framework 4.7.2 Targeting Pack (ENU)	4.7.03062	Microsoft Corporation	2024-12-26 00:00:00+00	2025-10-30 19:04:06.111166+00	31602
4	Promontory_GPIO Driver	3.0.2.0	Advanced Micro Devices, Inc.	2024-08-15 00:00:00+00	2025-10-30 19:04:06.111166+00	31603
4	vs_BlendMsi	16.0.28329	Microsoft Corporation	2024-12-26 00:00:00+00	2025-10-30 19:04:06.111166+00	31604
4	Epic Games Launcher	1.3.93.0	Epic Games, Inc.	2024-04-08 00:00:00+00	2025-10-30 19:04:06.111166+00	31605
4	WinRT Intellisense UAP - Other Languages	10.1.19041.5609	Microsoft Corporation	2025-07-08 00:00:00+00	2025-10-30 19:04:06.111166+00	31606
4	Microsoft .NET Framework 4.5.2 Multi-Targeting Pack	4.5.51209	Microsoft Corporation	2024-12-26 00:00:00+00	2025-10-30 19:04:06.111166+00	31607
4	Microsoft Visual C++ 2012 x86 Minimum Runtime - 11.0.61135	11.0.61135	Microsoft Corporation	2025-09-22 00:00:00+00	2025-10-30 19:04:06.111166+00	31608
4	Microsoft Visual C++ 2019 X86 Debug Runtime - 14.29.30157	14.29.30157	Microsoft Corporation	2025-09-23 00:00:00+00	2025-10-30 19:04:06.111166+00	31616
4	HP SFTP Plugin	56.0.480.0	HP Inc.	2025-06-03 00:00:00+00	2025-10-30 19:04:06.111166+00	31644
4	Windows Driver Package - SAMSUNG Electronics Co., Ltd.  (ssudmdm) Modem  (12/02/2015 2.12.1.0)	12/02/2015 2.12.1.0	SAMSUNG Electronics Co., Ltd.	\N	2025-10-30 19:04:06.111166+00	31177
4	Android Studio	2024.3	Google LLC	\N	2025-10-30 19:04:06.111166+00	31179
4	AutoHotkey	2.0.12	AutoHotkey Foundation LLC	\N	2025-10-30 19:04:06.111166+00	31180
4	Windows Driver Package - Google, Inc. (WinUSB) AndroidUsbDeviceClass  (08/27/2012 7.0.0000.00004)	08/27/2012 7.0.0000.00004	Google, Inc.	\N	2025-10-30 19:04:06.111166+00	31181
4	BlueStacks	5.21.640.1002	now.gg, Inc.	2025-02-23 00:00:00+00	2025-10-30 19:04:06.111166+00	31182
4	Certify The Web version 6.0.18	6.0.18	Webprofusion Pty Ltd	2024-06-12 00:00:00+00	2025-10-30 19:04:06.111166+00	31183
4	Click-o-Matic Ultimate	Ultimate	NickLeStrange	\N	2025-10-30 19:04:06.111166+00	31184
4	Docker Desktop	4.47.0	Docker Inc.	\N	2025-10-30 19:04:06.111166+00	31185
4	EPSON ET-16650 Series Printer Uninstall	\N	Seiko Epson Corporation	\N	2025-10-30 19:04:06.111166+00	31186
4	Equalizer APO	1.4.2	\N	\N	2025-10-30 19:04:06.111166+00	31187
4	Git	2.51.1	The Git Development Community	2025-10-19 00:00:00+00	2025-10-30 19:04:06.111166+00	31188
4	Mesh Agent	2022-12-02 14:42:16.000-05:00	\N	\N	2025-10-30 19:04:06.111166+00	31189
4	Microsoft Azure Compute Emulator - v2.9.7	2.9.8999.43	Microsoft Corporation	2024-12-26 00:00:00+00	2025-10-30 19:04:06.111166+00	31190
4	Mozilla Maintenance Service	144.0	Mozilla	\N	2025-10-30 19:04:06.111166+00	31192
4	Notepad++ (64-bit x64)	8.8.5	Notepad++ Team	\N	2025-10-30 19:04:06.111166+00	31193
4	Microsoft OneDrive	25.189.0928.0002	Microsoft Corporation	\N	2025-10-30 19:04:06.111166+00	31195
4	Speccy	1.33	Piriform	\N	2025-10-30 19:04:06.111166+00	31196
4	PGA TOUR 2K21	\N	HB Studios Multimedia Ltd.	\N	2025-10-30 19:04:06.111166+00	31197
4	Destiny 2	\N	Bungie	\N	2025-10-30 19:04:06.111166+00	31198
4	Cyberpunk 2077	\N	CD PROJEKT RED	\N	2025-10-30 19:04:06.111166+00	31199
4	Medieval Dynasty	\N	Render Cube	\N	2025-10-30 19:04:06.111166+00	31200
4	Space Engineers 2	\N	Keen Software House	\N	2025-10-30 19:04:06.111166+00	31201
4	Icarus	\N	RocketWerkz	\N	2025-10-30 19:04:06.111166+00	31202
4	Red Dead Redemption 2	\N	Rockstar Games	\N	2025-10-30 19:04:06.111166+00	31203
4	Enshrouded	\N	Keen Games GmbH	\N	2025-10-30 19:04:06.111166+00	31204
4	The Sims™ 4	\N	Maxis	\N	2025-10-30 19:04:06.111166+00	31205
4	ELDEN RING	\N	FromSoftware Inc.	\N	2025-10-30 19:04:06.111166+00	31206
4	Farming Simulator 22	\N	Giants Software	\N	2025-10-30 19:04:06.111166+00	31207
4	Sons Of The Forest	\N	Endnight Games Ltd	\N	2025-10-30 19:04:06.111166+00	31208
4	Manor Lords	\N	Slavic Magic	\N	2025-10-30 19:04:06.111166+00	31209
4	Gravity Field	\N	Kazakov Studios	\N	2025-10-30 19:04:06.111166+00	31210
4	Techtonica	\N	Fire Hose Games	\N	2025-10-30 19:04:06.111166+00	31211
4	Marvel’s Spider-Man Remastered	\N	Insomniac Games	\N	2025-10-30 19:04:06.111166+00	31216
4	Marvel's Spider-Man: Miles Morales	\N	Insomniac Games	\N	2025-10-30 19:04:06.111166+00	31217
4	ASKA	\N	Sand Sailor Studio	\N	2025-10-30 19:04:06.111166+00	31218
4	Call of Duty®	\N	Treyarch	\N	2025-10-30 19:04:06.111166+00	31219
4	Mozilla Firefox (x64 en-US)	144.0	Mozilla	\N	2025-10-30 19:04:06.111166+00	31191
4	Sunkenland	\N	Vector3 Studio	\N	2025-10-30 19:04:06.111166+00	31220
4	Once Human	\N	Starry Studio	\N	2025-10-30 19:04:06.111166+00	31221
4	ARK: Survival Ascended	\N	Studio Wildcard	\N	2025-10-30 19:04:06.111166+00	31222
4	Windows Driver Package - Many Worlds (SynchronousAudioRouter) MEDIA  (04/07/2018 8.46.47.980)	04/07/2018 8.46.47.980	Many Worlds	\N	2025-10-30 19:04:06.111166+00	31172
4	7-Zip 25.01 (x64)	25.01	Igor Pavlov	\N	2025-10-30 19:04:06.111166+00	31173
4	Windows Driver Package - SAMSUNG Electronics Co., Ltd.  (WinUSB) AndroidUsbDeviceClass  (12/02/2015 2.12.1.0)	12/02/2015 2.12.1.0	SAMSUNG Electronics Co., Ltd.	\N	2025-10-30 19:04:06.111166+00	31174
4	Windows Driver Package - Many Worlds (SarNdis) NetService  (04/07/2018 8.46.48.11)	04/07/2018 8.46.48.11	Many Worlds	\N	2025-10-30 19:04:06.111166+00	31175
4	Windows Driver Package - SAMSUNG Electronics Co., Ltd.  (dg_ssudbus) USB  (12/02/2015 2.12.1.0)	12/02/2015 2.12.1.0	SAMSUNG Electronics Co., Ltd.	\N	2025-10-30 19:04:06.111166+00	31176
4	AMD Software	24.8.1	Advanced Micro Devices, Inc.	\N	2025-10-30 19:04:06.111166+00	31178
4	No Man's Sky	\N	Hello Games	\N	2025-10-30 19:04:06.111166+00	31232
4	Canon TS8300 series MP Drivers	1.03	Canon Inc.	\N	2025-10-30 19:04:06.111166+00	31266
4	icecap_collection_x64	16.11.34930	Microsoft Corporation	2024-12-26 00:00:00+00	2025-10-30 19:04:06.111166+00	31286
4	IIS 10.0 Express	10.0.08608	Microsoft Corporation	2024-12-26 00:00:00+00	2025-10-30 19:04:06.111166+00	31350
4	Microsoft .NET Runtime - 6.0.36 (x64)	48.144.23141	Microsoft Corporation	2024-11-14 00:00:00+00	2025-10-30 19:04:06.111166+00	31380
4	ASUS AIOFan HAL	1.4.6.0	ASUSTeK COMPUTER INC.	2025-01-29 00:00:00+00	2025-10-30 19:04:06.111166+00	31400
4	OpenAL	\N	\N	\N	2025-10-30 19:04:06.111166+00	31451
4	Nmap 7.95	7.95	Nmap Project	\N	2025-10-30 19:04:06.111166+00	31448
4	GameSDK Service	1.0.5.0	ASUSTek COMPUTER INC.	\N	2025-10-30 19:04:06.111166+00	31472
4	UE4 Prerequisites (x64)	1.0.14.0	Epic Games, Inc.	\N	2025-10-30 19:04:06.111166+00	31481
4	Windows SDK Modern Versioned Developer Tools	10.1.19041.5609	Microsoft Corporation	2025-07-08 00:00:00+00	2025-10-30 19:04:06.111166+00	31539
4	Microsoft Windows Desktop Runtime - 8.0.21 (x64)	8.0.21.35325	Microsoft Corporation	\N	2025-10-30 19:04:06.111166+00	31540
4	Microsoft .NET Framework 4.5.1 Multi-Targeting Pack	4.5.50932	Microsoft Corporation	2024-12-26 00:00:00+00	2025-10-30 19:04:06.111166+00	31541
4	Microsoft Visual Studio Setup Configuration	3.7.2182.35401	Microsoft Corporation	2024-12-26 00:00:00+00	2025-10-30 19:04:06.111166+00	31542
4	vs_filehandler_x86	16.11.31503	Microsoft Corporation	2024-12-26 00:00:00+00	2025-10-30 19:04:06.111166+00	31543
4	TypeScript SDK	4.3.5.0	Microsoft Corporation	2024-12-26 00:00:00+00	2025-10-30 19:04:06.111166+00	31544
4	Microsoft Visual C++ 2022 X86 Minimum Runtime - 14.44.35211	14.44.35211	Microsoft Corporation	2025-09-22 00:00:00+00	2025-10-30 19:04:06.111166+00	31571
4	ASUS Motherboard	4.05.06	ASUSTek Computer Inc.	\N	2025-10-30 19:04:06.111166+00	31572
4	Microsoft .NET Framework 4.8 SDK	4.8.03928	Microsoft Corporation	2024-12-26 00:00:00+00	2025-10-30 19:04:06.111166+00	31573
4	AMD PSP Driver	5.30.0.0	Advanced Micro Devices, Inc.	2024-08-15 00:00:00+00	2025-10-30 19:04:06.111166+00	31574
4	vs_SQLClickOnceBootstrappermsi	16.10.31205	Microsoft Corporation	2024-12-26 00:00:00+00	2025-10-30 19:04:06.111166+00	31575
4	VirtualDJ 8	8.0.0	Atomix Productions	2024-12-15 00:00:00+00	2025-10-30 19:04:06.111166+00	31576
4	Windows SDK for Windows Store Apps Headers	10.1.19041.5609	Microsoft Corporation	2025-07-08 00:00:00+00	2025-10-30 19:04:06.111166+00	31577
4	Microsoft Visual C++ 2008 Redistributable - x86 9.0.30729.7523	9.0.30729.7523	Microsoft Corporation	2025-09-22 00:00:00+00	2025-10-30 19:04:06.111166+00	31578
4	Microsoft .NET Runtime - 6.0.36 (x64)	6.0.36.34214	Microsoft Corporation	\N	2025-10-30 19:04:06.111166+00	31579
4	Microsoft .NET SDK 8.0.415 (x64)	8.4.1525.47604	Microsoft Corporation	\N	2025-10-30 19:04:06.111166+00	31580
4	Windows SDK Desktop Headers x86	10.1.19041.5609	Microsoft Corporation	2025-07-08 00:00:00+00	2025-10-30 19:04:06.111166+00	31581
4	vs_FileTracker_Singleton	16.11.34827	Microsoft Corporation	2024-12-26 00:00:00+00	2025-10-30 19:04:06.111166+00	31592
4	vs_devenvmsi	16.0.28329	Microsoft Corporation	2024-12-26 00:00:00+00	2025-10-30 19:04:06.111166+00	31593
4	Windows SDK for Windows Store Apps DirectX x86 Remote	10.1.19041.5609	Microsoft Corporation	2025-07-08 00:00:00+00	2025-10-30 19:04:06.111166+00	31594
4	PassFab Android Unlock	2.11.0.9	PassFab, Inc.	2024-01-13 00:00:00+00	2025-10-30 19:04:06.111166+00	31595
4	Visual C++ Library CRT ARM64 Appx Package	14.29.30133	Microsoft Corporation	2024-12-26 00:00:00+00	2025-10-30 19:04:06.111166+00	31596
4	Battlestate Games Launcher 14.0.0.2297	14.0.0.2297	Battlestate Games	2023-12-22 00:00:00+00	2025-10-30 19:04:06.111166+00	31597
4	Microsoft Visual C++ 2012 x86 Additional Runtime - 11.0.61135	11.0.61135	Microsoft Corporation	2025-09-22 00:00:00+00	2025-10-30 19:04:06.111166+00	31598
4	Apple Software Update	2.7.0.3	Apple Inc.	2025-01-07 00:00:00+00	2025-10-30 19:04:06.111166+00	31599
4	AMD I2C Driver	1.2.0.124	Advanced Micro Devices, Inc.	2024-08-15 00:00:00+00	2025-10-30 19:04:06.111166+00	31600
4	NVIDIA PhysX	9.14.0702	NVIDIA Corporation	2025-05-22 00:00:00+00	2025-10-30 19:04:06.111166+00	31601
4	Project64 version 3.0.1.5664	3.0.1.5664	\N	2025-02-16 00:00:00+00	2025-10-30 19:04:06.111166+00	31609
4	Microsoft UniversalWindowsPlatform SDK	15.9.14	Microsoft	2024-12-26 00:00:00+00	2025-10-30 19:04:06.111166+00	31610
4	vs_minshellmsi	16.11.34902	Microsoft Corporation	2024-12-26 00:00:00+00	2025-10-30 19:04:06.111166+00	31611
4	Microsoft Visual C++ 2022 X86 Additional Runtime - 14.44.35211	14.44.35211	Microsoft Corporation	2025-09-22 00:00:00+00	2025-10-30 19:04:06.111166+00	31612
4	Microsoft .NET Framework Cumulative Intellisense Pack for Visual Studio (ENU)	4.8.03761	Microsoft Corporation	2024-12-26 00:00:00+00	2025-10-30 19:04:06.111166+00	31613
4	EPSON Scan OCR Component	3.00.06	Seiko Epson Corporation	2025-08-20 00:00:00+00	2025-10-30 19:04:06.111166+00	31614
4	Windows IoT Extension SDK Contracts	10.1.19041.5609	Microsoft Corporation	2025-07-08 00:00:00+00	2025-10-30 19:04:06.111166+00	31615
4	Microsoft Visual Basic/C++ Runtime (x86)	1.1.0	Microsoft Corporation	2025-09-22 00:00:00+00	2025-10-30 19:04:06.111166+00	31617
4	Windows SDK Desktop Libs arm64	10.1.19041.5609	Microsoft Corporation	2025-07-08 00:00:00+00	2025-10-30 19:04:06.111166+00	31618
4	Microsoft Visual Studio 2019 Tools for Unity	4.11.4.0	Microsoft Corporation	2024-12-26 00:00:00+00	2025-10-30 19:04:06.111166+00	31619
4	Windows SDK Desktop Libs arm	10.1.19041.5609	Microsoft Corporation	2025-07-08 00:00:00+00	2025-10-30 19:04:06.111166+00	31620
4	Microsoft .NET Framework 4 Multi-Targeting Pack	4.0.30319	Microsoft Corporation	2024-12-26 00:00:00+00	2025-10-30 19:04:06.111166+00	31621
4	Update for  (KB2504637)	1	Microsoft Corporation	\N	2025-10-30 19:04:06.111166+00	31622
4	WinRT Intellisense IoT - en-us	10.1.19041.5609	Microsoft Corporation	2025-07-08 00:00:00+00	2025-10-30 19:04:06.111166+00	31623
4	Windows SDK	10.1.19041.5609	Microsoft Corporation	2025-07-08 00:00:00+00	2025-10-30 19:04:06.111166+00	31624
4	Universal General MIDI DLS Extension SDK	10.1.19041.5609	Microsoft Corporation	2025-07-08 00:00:00+00	2025-10-30 19:04:06.111166+00	31625
4	Microsoft Visual C++ 2013 x86 Additional Runtime - 12.0.40664	12.0.40664	Microsoft Corporation	2025-09-22 00:00:00+00	2025-10-30 19:04:06.111166+00	31626
4	Microsoft XNA Framework Redistributable 4.0 Refresh	4.0.30901.0	Microsoft Corporation	2023-12-13 00:00:00+00	2025-10-30 19:04:06.111166+00	31627
4	Microsoft ASP.NET Diagnostic Pack for Visual Studio	16.11.127.19732	Microsoft Corporation	2025-10-15 00:00:00+00	2025-10-30 19:04:06.111166+00	31628
4	Windows Desktop Extension SDK Contracts	10.1.19041.5609	Microsoft Corporation	2025-07-08 00:00:00+00	2025-10-30 19:04:06.111166+00	31629
4	Microsoft Visual C++ 2015-2022 Redistributable (x64) - 14.44.35211	14.44.35211.0	Microsoft Corporation	\N	2025-10-30 19:04:06.111166+00	31630
4	Windows Mobile Extension SDK	10.1.19041.5609	Microsoft Corporation	2025-07-08 00:00:00+00	2025-10-30 19:04:06.111166+00	31631
4	Epson Connect Printer Setup	1.4.10	Seiko Epson Corporation	2025-08-20 00:00:00+00	2025-10-30 19:04:06.111166+00	31632
4	iMyFone LockWiper 8.1.2.2	8.1.2.2	iMyFone Technology Co., Ltd.	2025-01-07 00:00:00+00	2025-10-30 19:04:06.111166+00	31633
4	Windows SDK Facade Windows WinMD Versioned	10.1.19041.5609	Microsoft Corporation	2025-07-08 00:00:00+00	2025-10-30 19:04:06.111166+00	31634
4	Windows Mobile Extension SDK Contracts	10.1.19041.5609	Microsoft Corporation	2025-07-08 00:00:00+00	2025-10-30 19:04:06.111166+00	31635
4	Windows SDK AddOn	10.1.0.0	Microsoft Corporation	2024-12-26 00:00:00+00	2025-10-30 19:04:06.111166+00	31636
4	Windows SDK EULA	10.1.19041.5609	Microsoft Corporations	2025-07-08 00:00:00+00	2025-10-30 19:04:06.111166+00	31637
4	vs_tipsmsi	16.0.28329	Microsoft Corporation	2024-12-26 00:00:00+00	2025-10-30 19:04:06.111166+00	31638
4	vcpp_crt.redist.clickonce	14.29.30157	Microsoft Corporation	2024-12-26 00:00:00+00	2025-10-30 19:04:06.111166+00	31639
4	Windows SDK Desktop Libs x64	10.1.19041.5609	Microsoft Corporation	2025-07-08 00:00:00+00	2025-10-30 19:04:06.111166+00	31640
4	Microsoft Visual Studio Setup WMI Provider	3.7.2182.35401	Microsoft Corporation	2024-12-26 00:00:00+00	2025-10-30 19:04:06.111166+00	31641
4	AMD GPIO2 Driver	2.2.0.133	Advanced Micro Devices, Inc.	2024-08-15 00:00:00+00	2025-10-30 19:04:06.111166+00	31642
4	WinRT Intellisense IoT - Other Languages	10.1.19041.5609	Microsoft Corporation	2025-07-08 00:00:00+00	2025-10-30 19:04:06.111166+00	31643
4	WinRT Intellisense PPI - en-us	10.1.19041.5609	Microsoft Corporation	2025-07-08 00:00:00+00	2025-10-30 19:04:06.111166+00	31645
4	Visual C++ Library CRT Appx Resource Package	14.29.30133	Microsoft Corporation	2024-12-26 00:00:00+00	2025-10-30 19:04:06.111166+00	31646
4	Windows SDK for Windows Store Managed Apps Libs	10.1.19041.5609	Microsoft Corporation	2025-07-08 00:00:00+00	2025-10-30 19:04:06.111166+00	31647
4	WinRT Intellisense PPI - Other Languages	10.1.19041.5609	Microsoft Corporation	2025-07-08 00:00:00+00	2025-10-30 19:04:06.111166+00	31648
4	Microsoft .NET Native SDK	15.0.24211.07	Microsoft Corporation	2024-12-26 00:00:00+00	2025-10-30 19:04:06.111166+00	31649
4	SDK ARM Redistributables	10.1.19041.5609	Microsoft Corporation	2025-07-08 00:00:00+00	2025-10-30 19:04:06.111166+00	31650
4	Microsoft Visual C++ 2010  x86 Redistributable - 10.0.40219	10.0.40219	Microsoft Corporation	2025-09-22 00:00:00+00	2025-10-30 19:04:06.111166+00	31651
4	Realtek Audio Driver	6.0.9360.1	Realtek Semiconductor Corp.	2024-08-29 00:00:00+00	2025-10-30 19:04:06.111166+00	31652
4	Bitvise SSH Client - FlowSshNet (x86)	9.42.0.0	Bitvise Limited	2025-02-17 00:00:00+00	2025-10-30 19:04:06.111166+00	31653
4	Epson Photo+	4.0.2.0	Seiko Epson Corporation	2025-08-20 00:00:00+00	2025-10-30 19:04:06.111166+00	31654
4	Windows App Certification Kit x64	10.1.19041.5609	Microsoft Corporation	2025-07-08 00:00:00+00	2025-10-30 19:04:06.111166+00	31655
4	Entity Framework 6.2.0 Tools  for Visual Studio 2019	6.2.0.0	Microsoft Corporation	2024-12-26 00:00:00+00	2025-10-30 19:04:06.111166+00	31656
4	Windows SDK ARM Desktop Tools	10.1.19041.5609	Microsoft Corporation	2025-07-08 00:00:00+00	2025-10-30 19:04:06.111166+00	31657
4	Universal CRT Tools x86	10.1.19041.5609	Microsoft Corporation	2025-07-08 00:00:00+00	2025-10-30 19:04:06.111166+00	31658
\.


--
-- Data for Name: agents; Type: TABLE DATA; Schema: public; Owner: remoteiq
--

COPY public.agents (id, device_id, hostname, os, arch, version, last_seen_at, created_at, updated_at, token_hash, client, site, primary_ip, logged_in_user, facts, agent_uuid) FROM stdin;
4	win-c2b731a9-9b9c-482f-bbf8-47881c5ca072	LSITS-OFFICE-PC	windows	x64	1.0.0.0	2025-10-31 03:28:32.672657+00	2025-10-30 19:04:05.957943+00	2025-10-31 03:28:32.672657+00	b01982e3cef93839f1f4e939fc56aefd647ad9c389f30e97ad3df6b33dbd0180	\N	\N	192.168.1.67	LSITS-OFFICE-PC\\Last Stop	{}	f41a7567-072e-4fe7-8829-4f14d1e208a3
\.


--
-- Data for Name: backup_job_logs; Type: TABLE DATA; Schema: public; Owner: remoteiq
--

COPY public.backup_job_logs (job_id, log_text) FROM stdin;
519608c9-fc92-493f-bd0e-867f3ccf2a67	Exporting targets: users, roles, devices, policies, audit_logs, settings, templates\n  - users: 1 rows (from public.users)\n  - roles: 4 rows (from public.roles)\n  - devices: 4 rows (from public.devices)\n    (no table/view found for target "policies")\n  - policies: skipped (no mapped table/view exists)\n    (no table/view found for target "audit_logs")\n  - audit_logs: skipped (no mapped table/view exists)\n    (no table/view found for target "settings")\n  - settings: skipped (no mapped table/view exists)\n    (no table/view found for target "templates")\n  - templates: skipped (no mapped table/view exists)\nArchive created: backup_2025-11-06T08-00-30.tar.gz (1154 bytes)\nSaved to local path: \\var\\remoteiq\\backups\\backup_2025-11-06T08-00-30.tar.gz\nDone in 1s\n
9f019275-2c22-4044-b79a-e88a2208547d	Exporting targets: users, roles, devices, policies, audit_logs, settings, templates\n  - users: 1 rows (from public.users)\n  - roles: 4 rows (from public.roles)\n  - devices: 4 rows (from public.devices)\n    (no table/view found for target "policies")\n  - policies: skipped (no mapped table/view exists)\n    (no table/view found for target "audit_logs")\n  - audit_logs: skipped (no mapped table/view exists)\n    (no table/view found for target "settings")\n  - settings: skipped (no mapped table/view exists)\n    (no table/view found for target "templates")\n  - templates: skipped (no mapped table/view exists)\nArchive created: backup_2025-11-06T08-00-00.tar.gz (1153 bytes)\nSaved to local path: \\var\\remoteiq\\backups\\backup_2025-11-06T08-00-00.tar.gz\nDone in 1s\n
89c7a2e4-20b2-4dc1-97fb-6ab18f340f9c	Exporting targets: users, devices, settings\n  - users: 1 rows\n  - devices: 4 rows\nExporting targets: users, devices, settings\n  - users: 1 rows\n  - devices: 4 rows\n
8b9904ff-fae0-43c0-85a4-26a6e6eb87b7	Exporting targets: users, devices, settings\n  - users: 1 rows (from public.users)\n  - devices: 4 rows (from public.devices)\n    (no table/view found for target "settings")\n  - settings: skipped (no mapped table/view exists)\nArchive created: backup_2025-11-06T05-23-12.tar.gz (962 bytes)\nSaved to local path: C:\\RemoteIQ\\backups\\backup_2025-11-06T05-23-12.tar.gz\nDone in 1s\n
ae1e5d7e-60ed-4c2f-aa9a-7b0fd5b234a3	Exporting targets: users, devices, settings\n  - users: 1 rows (from public.users)\n  - devices: 4 rows (from public.devices)\n    (no table/view found for target "settings")\n  - settings: skipped (no mapped table/view exists)\nArchive created: backup_2025-11-06T04-02-55.tar.gz (962 bytes)\nSaved to local path: C:\\RemoteIQ\\backups\\backup_2025-11-06T04-02-55.tar.gz\nDone in 1s\n
a2461696-0216-45a8-b258-802e8662c13a	Exporting targets: users, devices, settings\n  - users: 1 rows (from public.users)\n  - devices: 4 rows (from public.devices)\n    (no table/view found for target "settings")\n  - settings: skipped (no mapped table/view exists)\nArchive created: backup_2025-11-06T04-02-58.tar.gz (963 bytes)\nSaved to local path: C:\\RemoteIQ\\backups\\backup_2025-11-06T04-02-58.tar.gz\nDone in 1s\n
1aaf2669-9422-44a5-872d-c9c596aa70ae	Exporting targets: users, devices, settings\n  - users: 1 rows (from public.users)\n  - devices: 4 rows (from public.devices)\n    (no table/view found for target "settings")\n  - settings: skipped (no mapped table/view exists)\nArchive created: backup_2025-11-06T04-49-50.tar.gz (962 bytes)\nSaved to local path: C:\\RemoteIQ\\backups\\backup_2025-11-06T04-49-50.tar.gz\nDone in 1s\n
\.


--
-- Data for Name: backup_job_manifests; Type: TABLE DATA; Schema: public; Owner: remoteiq
--

COPY public.backup_job_manifests (job_id, manifest) FROM stdin;
ae1e5d7e-60ed-4c2f-aa9a-7b0fd5b234a3	{"id": "ae1e5d7e-60ed-4c2f-aa9a-7b0fd5b234a3", "files": ["users.ndjson", "devices.ndjson"], "counts": {"users": 1, "devices": 4, "settings": 0}, "targets": ["users", "devices", "settings"], "createdAt": "2025-11-06T04:02:55.558Z"}
a2461696-0216-45a8-b258-802e8662c13a	{"id": "a2461696-0216-45a8-b258-802e8662c13a", "files": ["users.ndjson", "devices.ndjson"], "counts": {"users": 1, "devices": 4, "settings": 0}, "targets": ["users", "devices", "settings"], "createdAt": "2025-11-06T04:02:58.608Z"}
1aaf2669-9422-44a5-872d-c9c596aa70ae	{"id": "1aaf2669-9422-44a5-872d-c9c596aa70ae", "files": ["users.ndjson", "devices.ndjson"], "counts": {"users": 1, "devices": 4, "settings": 0}, "targets": ["users", "devices", "settings"], "createdAt": "2025-11-06T04:49:50.623Z"}
8b9904ff-fae0-43c0-85a4-26a6e6eb87b7	{"id": "8b9904ff-fae0-43c0-85a4-26a6e6eb87b7", "files": ["users.ndjson", "devices.ndjson"], "counts": {"users": 1, "devices": 4, "settings": 0}, "targets": ["users", "devices", "settings"], "createdAt": "2025-11-06T05:23:12.872Z"}
9f019275-2c22-4044-b79a-e88a2208547d	{"id": "9f019275-2c22-4044-b79a-e88a2208547d", "files": ["users.ndjson", "roles.ndjson", "devices.ndjson"], "counts": {"roles": 4, "users": 1, "devices": 4, "policies": 0, "settings": 0, "templates": 0, "audit_logs": 0}, "targets": ["users", "roles", "devices", "policies", "audit_logs", "settings", "templates"], "createdAt": "2025-11-06T08:00:00.903Z"}
519608c9-fc92-493f-bd0e-867f3ccf2a67	{"id": "519608c9-fc92-493f-bd0e-867f3ccf2a67", "files": ["users.ndjson", "roles.ndjson", "devices.ndjson"], "counts": {"roles": 4, "users": 1, "devices": 4, "policies": 0, "settings": 0, "templates": 0, "audit_logs": 0}, "targets": ["users", "roles", "devices", "policies", "audit_logs", "settings", "templates"], "createdAt": "2025-11-06T08:00:30.908Z"}
\.


--
-- Data for Name: backup_jobs; Type: TABLE DATA; Schema: public; Owner: remoteiq
--

COPY public.backup_jobs (id, started_at, finished_at, status, note, size_bytes, duration_sec, verified, targets, destination, artifact_location, cancelled) FROM stdin;
89c7a2e4-20b2-4dc1-97fb-6ab18f340f9c	2025-11-06 03:49:24.160687+00	2025-11-06 03:57:31.037795+00	failed	relation "settings" does not exist	\N	\N	\N	\N	\N	\N	f
ae1e5d7e-60ed-4c2f-aa9a-7b0fd5b234a3	2025-11-06 03:57:31.018098+00	2025-11-06 04:02:55.585135+00	success	Scheduled run	962	1	t	\N	\N	{"kind": "local", "path": "C:\\\\RemoteIQ\\\\backups\\\\backup_2025-11-06T04-02-55.tar.gz"}	f
a2461696-0216-45a8-b258-802e8662c13a	2025-11-06 04:02:58.604604+00	2025-11-06 04:02:58.625959+00	success	Scheduled run	963	1	t	\N	\N	{"kind": "local", "path": "C:\\\\RemoteIQ\\\\backups\\\\backup_2025-11-06T04-02-58.tar.gz"}	f
1aaf2669-9422-44a5-872d-c9c596aa70ae	2025-11-06 04:49:50.619984+00	2025-11-06 04:49:50.666011+00	success	Scheduled run	962	1	t	\N	\N	{"kind": "local", "path": "C:\\\\RemoteIQ\\\\backups\\\\backup_2025-11-06T04-49-50.tar.gz"}	f
8b9904ff-fae0-43c0-85a4-26a6e6eb87b7	2025-11-06 05:23:12.869114+00	2025-11-06 05:23:12.894374+00	success	Scheduled run	962	1	t	\N	\N	{"kind": "local", "path": "C:\\\\RemoteIQ\\\\backups\\\\backup_2025-11-06T05-23-12.tar.gz"}	f
9f019275-2c22-4044-b79a-e88a2208547d	2025-11-06 08:00:00.898047+00	2025-11-06 08:00:00.953315+00	success	Scheduled run	1153	1	t	\N	\N	{"kind": "local", "path": "\\\\var\\\\remoteiq\\\\backups\\\\backup_2025-11-06T08-00-00.tar.gz"}	f
519608c9-fc92-493f-bd0e-867f3ccf2a67	2025-11-06 08:00:30.903638+00	2025-11-06 08:00:30.955257+00	success	Scheduled run	1154	1	t	\N	\N	{"kind": "local", "path": "\\\\var\\\\remoteiq\\\\backups\\\\backup_2025-11-06T08-00-30.tar.gz"}	f
\.


--
-- Data for Name: backup_restores; Type: TABLE DATA; Schema: public; Owner: remoteiq
--

COPY public.backup_restores (id, backup_id, requested_at, finished_at, status, note) FROM stdin;
\.


--
-- Data for Name: backups_config; Type: TABLE DATA; Schema: public; Owner: remoteiq
--

COPY public.backups_config (id, enabled, targets, schedule, cron_expr, retention_days, encrypt, destination, notifications, last_scheduled_at) FROM stdin;
singleton	t	["users", "roles", "devices", "policies", "audit_logs", "settings", "templates"]	daily	0 3 * * *	30	t	{"kind": "local", "path": "/var/remoteiq/backups"}	{"email": false, "slack": false, "webhook": false}	\N
\.


--
-- Data for Name: branding_settings; Type: TABLE DATA; Schema: public; Owner: remoteiq
--

COPY public.branding_settings (id, primary_color, secondary_color, logo_light_url, logo_dark_url, login_background_url, email_header, email_footer, custom_css, allow_client_theme_toggle, created_at, updated_at, favicon_url) FROM stdin;
1	#ff129b	#0a6abf	http://localhost:3001/static/uploads/1761077735717_logo.png	http://localhost:3001/static/uploads/1761077738293_logo.png		<h1>{{org_name}}</h1>	<p>Copyright 2025. All rights reserved.</p>	/* Your custom CSS here */	t	2025-10-18 23:12:48.313331+00	2025-10-21 20:23:29.517408+00	http://localhost:3001/static/uploads/1761078203776_logo.ico
\.


--
-- Data for Name: check_assignments; Type: TABLE DATA; Schema: public; Owner: remoteiq
--

COPY public.check_assignments (id, device_id, dedupe_key, check_type, check_name, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: check_runs; Type: TABLE DATA; Schema: public; Owner: remoteiq
--

COPY public.check_runs (id, assignment_id, device_id, status, severity, metrics, output, started_at, finished_at, created_at) FROM stdin;
\.


--
-- Data for Name: checks; Type: TABLE DATA; Schema: public; Owner: remoteiq
--

COPY public.checks (id, scope, type, name, description, category, config, threshold, severity_default, interval_sec, timeout_sec, enabled, created_by, updated_by, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: company_profile; Type: TABLE DATA; Schema: public; Owner: remoteiq
--

COPY public.company_profile (id, name, legal_name, email, phone, fax, website, vat_tin, address1, address2, city, state, postal, country) FROM stdin;
1	RemoteIQ Technologies, LLC	RemoteIQ Technologies, LLC	info@remoteiq.com	+1 555-555-0100	\N	https://remoteiq.com	US-12-3456789	123 Main St	\N	Austin	TX	73301	US
\.


--
-- Data for Name: devices; Type: TABLE DATA; Schema: public; Owner: remoteiq
--

COPY public.devices (id, hostname, os, arch, last_seen, status, client, site, "user", agent_uuid) FROM stdin;
11111111-1111-1111-1111-111111111111	wkstn-001	windows	x64	2025-10-18 18:27:08.305547+00	online	Supr Solutions LLC	Dayton	svc-dc	\N
33333333-3333-3333-3333-333333333333	srv-db-prod	linux	x86_64	2025-10-18 18:27:08.307261+00	online	Supr Solutions LLC	Dayton	alice	\N
22222222-2222-2222-2222-222222222222	wkstn-002	windows	x64	2025-10-18 18:27:08.306626+00	offline	Supr Solutions LLC	Dayton	bob	\N
44444444-4444-4444-4444-444444444444	mac-mini-01	macos	arm64	2025-10-18 18:27:08.307881+00	online	Supr Solutions LLC	Dayton	alex	\N
\.


--
-- Data for Name: dkim_keys; Type: TABLE DATA; Schema: public; Owner: remoteiq
--

COPY public.dkim_keys (id, domain, selector, private_key, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: dkim_settings; Type: TABLE DATA; Schema: public; Owner: remoteiq
--

COPY public.dkim_settings (id, domain, selector, private_key, updated_at) FROM stdin;
1	suprsolutions.com	default	-----BEGIN PRIVATE KEY-----\\nsdfvdsv\\n-----END PRIVATE KEY-----	2025-10-20 21:36:04.998+00
\.


--
-- Data for Name: email_inbound_events; Type: TABLE DATA; Schema: public; Owner: remoteiq
--

COPY public.email_inbound_events (id, purpose, from_addr, subject, kind, raw, created_at) FROM stdin;
\.


--
-- Data for Name: email_settings; Type: TABLE DATA; Schema: public; Owner: remoteiq
--

COPY public.email_settings (purpose, enabled, smtp_host, smtp_port, smtp_username, smtp_password, smtp_use_tls, smtp_use_ssl, smtp_from_address, imap_host, imap_port, imap_username, imap_password, imap_use_ssl, pop_host, pop_port, pop_username, pop_password, pop_use_ssl, updated_at) FROM stdin;
alerts	t	mail.suprsolutions.com	587	alerts@suprsolutions.com	=,96,AlessEPlUMVesterBERYPTIBLOOtHErN	t	f	alerts@suprsolutions.com	mail.suprsolutions.com	993	alerts@suprsolutions.com	=,96,AlessEPlUMVesterBERYPTIBLOOtHErN	t		\N		\N	t	2025-10-21 00:59:08.743+00
invites	t	mail.remoteiq.com	587	no-reply@remoteiq.com	\N	t	f	no-reply@remoteiq.com		\N		\N	t		\N		\N	t	2025-10-21 00:59:08.744+00
password_resets	t		\N		\N	t	f			\N		\N	t		\N		\N	t	2025-10-21 00:59:08.745+00
reports	t		\N		\N	t	f			\N		\N	t		\N		\N	t	2025-10-21 00:59:08.746+00
\.


--
-- Data for Name: imap_ingested; Type: TABLE DATA; Schema: public; Owner: remoteiq
--

COPY public.imap_ingested (id, purpose, uid, from_addr, subject, size_bytes, headers_snippet, is_bounce, bounce_recipient, bounce_status, bounce_action, bounce_diagnostic, created_at) FROM stdin;
1	alerts	35	alerts@suprsolutions.com	vzdump backup status (PVESS01.local): backup successful	39173	Return-Path: <alerts@suprsolutions.com>\r\nDelivered-To: alerts@suprsolutions.com\r\nReceived: from mail.suprsolutions.com ([172.22.1.253])\r\n\tby 6865e5e1852e with LMTP\r\n\tid EEiqArnN9mgwiwQAHEHyOw\r\n\t(envelope-from <alerts@suprsolutions.com>)\r\n\tfor <alerts@suprsolutions.com>; Mon, 20 Oct 2025 20:03:05 -0400\r\nX-Original-To: alerts@suprsolutions.com\r\nReceived: from [127.0.0.1] (localhost [127.0.0.1]) by localhost (Mailerdaemon) with ESMTPSA id 6C185102FC2\r\n\tfor <alerts@suprsolutions.com>; Mon, 20 Oct 2025 20:03:03 -0400 (EDT)\r\nDKIM-Signature: v=1; a=rsa-sha256; c=relaxed/relaxed; d=suprsolutions.com;\r\n\ts=dkim; t=1761004984; h=from:subject:date:to:mime-version:content-type;\r\n\tbh=t6l2p8LzFSLVMihYsIFDQLeRjGZfF+pziLnO2hdXJmM=;\r\n\tb=ajGo8o6Rb2zmhpfyaetZDWQq8IQfkBm3HBcRMV8a5uuEihx/OsP4Hfr8+ntr17/0/fxXI5\r\n\t3d6hVPpZv4Z2sJL7mF3HYNMw5Pc08Ofgua/XE+hdaDzTlAtBA5lPsj8jmJdxTxbIo5FyU9\r\n\t+hJy10flesC4VzAPBTHUbpOfrr1RGS+enu1/SY0GqUI2ccnlWqyVOSXE1zEOloiOU0sSap\r\n\tzVX/Pp52IqvTJa0C0IE6KAfV+p+W7HDfQTiwUUVq6YjHgBCeNjnUt0em1uyQTLL+uw9Ym+\r\n\tGFCd99MvNNCVBk6J6Cab7o7zTkPZneP0BmtIEAFWhHGlMOHmlEgLJgYBV4cwcA==\r\nFrom: PVESS01 <alerts@suprsolutions.com>\r\nTo: alerts@suprsolutions.com\r\nSubject: vzdump backup status (PVESS01.local): backup successful \r\nMIME-Version: 1.0\r\nDate: Tue, 21 Oct 2025 00:03:02 +0000\r\nAuto-Submitted: auto-generated;\r\nContent-Type: multipart/alternative;\r\n boundary="8En7gwb5LrSfgVBQgFYnVa4KOxSMp2jjfN3ZNjPM"\r\nX-Last-TLS-Session-Version: TLSv1.3\r\n\r\n--8En7gwb5LrSfgVBQgFYnVa4KOxSMp2jjfN3ZNjPM\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n\r\nDetails\r\n=3D=3D=3D=3D=3D=3D=3D\r\nVMID    Name                         Status    Time     Size           File=\r\nname                       =20\r\n100     network.suprsolutions.com    ok        21s      2.222 GiB      ct/1=\r\n00/2025-10-21T00:00:01Z    =20\r\n101     cloud.suprsolutions.com      ok        1m 3s    4.506 GiB      ct/1=\r\n01/2025-10-21T00:00:23Z    =20\r\n102     vaultwarden-server           ok        19s      2.032 GiB      ct/1=\r\n02/2025-10-21T00:01:26Z    =20\r\n200     mail-server                  ok        10s      200.001 GiB    vm/2=\r\n00/2025-10-21T00:01:45Z    =20\r\n201     tacticalrmm-server           ok        15s      32.001 GiB     vm/2=\r\n01/2025-10-21T00:01:55Z    =20\r\n202     itflow-server                ok        6s       48 GiB         vm/2=\r\n02/2025-10-21T00:02:10Z    =20\r\n1000    ubuntu24-vm                  ok        46s      16.001 GiB     vm/1=\r\n000/2025-10-21T00:02:16Z   =20\r\n\r\nTotal running time: 3m 1s\r\nTotal size: 304.762 GiB\r\n\r\nLogs\r\n=3D=3D=3D=3D\r\nvzdump 100 101 102 200 202 1000 201 --mode snapshot --notes-template '{{gue=\r\nstname}}' --quiet 1 --fleecing 0 --storage BACKUP-SERVER --node PVESS01\r\n\r\n\r\n100: 2025-10-20 20:00:01 INFO: Starting Backup of VM 100 (lxc)\r\n100: 2025-10-20 20:00:01 INFO: status =3D running\r\n100: 2025-10-20 20:00:01 INFO: CT Name: network.suprsolutions.com\r\n100: 2025-10-20 20:00:01 INFO: including mount point rootfs ('/') in backup\r\n100: 2025-10-20 20:00:01 INFO: backup mode: snapshot\r\n100: 2025-10-20 20:00:01 INFO: ionice priority: 7\r\n100: 2025-10-20 20:00:01 INFO: create storage snapshot 'vzdump'\r\n100: 2025-10-20 20:00:02 INFO: creating Proxmox Backup Server archive 'ct/1=\r\n00/2025-10-21T00:00:01Z'\r\n100: 2025-10-20 20:00:02 INFO: set max number of entries in memory for file=\r\n-based backups to 1048576\r\n100: 2025-10-20 20:00:02 INFO: run: lxc-usernsexec -m u:0:100000:65536 -m g=\r\n:0:100000:65536 -- /usr/bin/proxmox-backup-client backup --crypt-mode=3Dnon=\r\ne pct.conf:/var/tmp/vzdumptmp2196102_100/etc/vzdump/pct.conf root.pxar:/mnt=\r\n/vzsnap0 --include-dev /mnt/vzsnap0/./ --skip-lost-and-found --exclude=3D/t=\r\nmp/?* --exclude=3D/var/tmp/?* --exclude=3D/var/run/?*.pid --backup-type ct =\r\n--backup-id 100 --backup-time 1761004801 --entries-max 1048576 --repository=\r\n root@pam@192.168.1.253:budata --ns pvess01\r\n100: 2025-10-20 20:00:02 INFO: Starting backup: [pvess01]:ct/100/2025-10-21=\r\nT00:00:01Z   =20\r\n100: 2025-10-20 20:00:02 INF	f	\N	\N	\N	\N	2025-10-21 00:04:01.013166+00
635	alerts	36	alerts@suprsolutions.com	vzdump backup status (PVESS01.local): backup successful	176988	Return-Path: <alerts@suprsolutions.com>\r\nDelivered-To: alerts@suprsolutions.com\r\nReceived: from mail.suprsolutions.com ([172.22.1.253])\r\n\tby 6865e5e1852e with LMTP\r\n\tid iN8dND3O/mh42QUAHEHyOw\r\n\t(envelope-from <alerts@suprsolutions.com>)\r\n\tfor <alerts@suprsolutions.com>; Sun, 26 Oct 2025 21:43:25 -0400\r\nX-Original-To: alerts@suprsolutions.com\r\nReceived: from [127.0.0.1] (localhost [127.0.0.1]) by localhost (Mailerdaemon) with ESMTPSA id B8D9D1030C9\r\n\tfor <alerts@suprsolutions.com>; Sun, 26 Oct 2025 21:43:24 -0400 (EDT)\r\nDKIM-Signature: v=1; a=rsa-sha256; c=relaxed/relaxed; d=suprsolutions.com;\r\n\ts=dkim; t=1761529405; h=from:subject:date:to:mime-version:content-type;\r\n\tbh=5q9zdfrATWpBjZICiEZyNazEf2ZJN4ogdrvbqaEKNrw=;\r\n\tb=GjtBMcWJ40jG5FVdjgY8G5xoqdKe1UfIeCFx2O5Jen7Ydc/ltADcJk8uYk3X6XFr2OKlQ9\r\n\tUxvL5H0CH2YafustbINbD5631lsZlzk3+1eI/QeaOtEovRe2QvtD4S1XIM4NSJHNBug/Ny\r\n\tmGnbsEPu/0bA66vurOQZ7uFQD88flMSTEidZtZ5RaGe9802thiDAjsk1IIINCpKLtJubjJ\r\n\tMkLQy+LaPZjfS76g67lwqlWaqJlXXsvhGHzeAt2dhUUYgSOToZUGTgQHvXpYT7nwYMcwBP\r\n\tFEVlO6q0MhSEebBLARS1vPWHMoU8xxFyTSW7yNgWWZ2NyXWRUOuVMG5eEzCR5w==\r\nFrom: PVESS01 <alerts@suprsolutions.com>\r\nTo: alerts@suprsolutions.com\r\nSubject: vzdump backup status (PVESS01.local): backup successful \r\nMIME-Version: 1.0\r\nDate: Mon, 27 Oct 2025 01:43:23 +0000\r\nAuto-Submitted: auto-generated;\r\nContent-Type: multipart/alternative;\r\n boundary="KV2stRz9loxsNdU7rf3RZtjiJSj4F6lYL4CWQbro"\r\nX-Last-TLS-Session-Version: TLSv1.3\r\n\r\n--KV2stRz9loxsNdU7rf3RZtjiJSj4F6lYL4CWQbro\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n\r\nDetails\r\n=3D=3D=3D=3D=3D=3D=3D\r\nVMID    Name                         Status    Time       Size           Fi=\r\nlename                       =20\r\n100     network.suprsolutions.com    ok        21s        2.319 GiB      ct=\r\n/100/2025-10-27T00:01:30Z    =20\r\n101     cloud.suprsolutions.com      ok        1m 6s      4.631 GiB      ct=\r\n/101/2025-10-27T00:01:52Z    =20\r\n102     vaultwarden-server           ok        20s        2.057 GiB      ct=\r\n/102/2025-10-27T00:02:58Z    =20\r\n200     mail-server                  ok        4m 2s      200.001 GiB    vm=\r\n/200/2025-10-27T00:03:18Z    =20\r\n201     tacticalrmm-server           ok        1m 56s     32.001 GiB     vm=\r\n/201/2025-10-27T00:07:20Z    =20\r\n202     itflow-server                ok        2m 5s      48 GiB         vm=\r\n/202/2025-10-27T00:09:16Z    =20\r\n300     home.suprcloud.io            ok        22m 56s    146.519 GiB    ct=\r\n/300/2025-10-27T00:11:21Z    =20\r\n301     intecit.suprcloud.io         ok        10m 35s    80.406 GiB     ct=\r\n/301/2025-10-27T00:34:17Z    =20\r\n302     supr-domain-controller       ok        6m 35s     64.001 GiB     vm=\r\n/302/2025-10-27T00:44:53Z    =20\r\n303     tor-server                   ok        2m 57s     16.001 GiB     vm=\r\n/303/2025-10-27T00:51:29Z    =20\r\n304     valheim-server               ok        9m 20s     55.001 GiB     vm=\r\n/304/2025-10-27T00:54:26Z    =20\r\n305     admin-workstation            ok        10m 2s     64.001 GiB     vm=\r\n/305/2025-10-27T01:03:47Z    =20\r\n306     intec-work-pc                ok        28m 46s    500.004 GiB    vm=\r\n/306/2025-10-27T01:13:49Z    =20\r\n1000    ubuntu24-vm                  ok        47s        16.001 GiB     vm=\r\n/1000/2025-10-27T01:42:36Z   =20\r\n\r\nTotal running time: 1h 41m 53s\r\nTotal size: 1.202 TiB\r\n\r\nLogs\r\n=3D=3D=3D=3D\r\nvzdump --all 1 --notes-template '{{guestname}}' --storage BACKUP-SERVER --f=\r\nleecing 0 --node PVESS01 --mode snapshot\r\n\r\n\r\n100: 2025-10-26 20:01:30 INFO: Starting Backup of VM 100 (lxc)\r\n100: 2025-10-26 20:01:30 INFO: status =3D running\r\n100: 2025-10-26 20:01:30 INFO: CT Name: network.suprsolutions.com\r\n100: 2025-10-26 20:01:30 INFO: including mount point rootfs ('/') in backup\r\n100: 2025-10-26 20:01:30 INFO: backup mode: snapshot\r\n100: 2025-10-26 20:01:30 INFO: ionice priority: 7\r\n100: 2025-10-26 20:01:30 INFO: create storage snapshot 'vzdump'\r\n100: 2025-10-26 20:01:31 INFO: creating Proxmox Backup Server archive 'ct/	f	\N	\N	\N	\N	2025-10-27 01:43:30.84574+00
670	alerts	37	alerts@suprsolutions.com	vzdump backup status (PVESS01.local): backup successful	95175	Return-Path: <alerts@suprsolutions.com>\r\nDelivered-To: alerts@suprsolutions.com\r\nReceived: from mail.suprsolutions.com ([172.22.1.253])\r\n\tby 6865e5e1852e with LMTP\r\n\tid MA5sHjXf/mjp6AUAHEHyOw\r\n\t(envelope-from <alerts@suprsolutions.com>)\r\n\tfor <alerts@suprsolutions.com>; Sun, 26 Oct 2025 22:55:49 -0400\r\nX-Original-To: alerts@suprsolutions.com\r\nReceived: from [127.0.0.1] (localhost [127.0.0.1]) by localhost (Mailerdaemon) with ESMTPSA id 67267102FC4\r\n\tfor <alerts@suprsolutions.com>; Sun, 26 Oct 2025 22:55:48 -0400 (EDT)\r\nDKIM-Signature: v=1; a=rsa-sha256; c=relaxed/relaxed; d=suprsolutions.com;\r\n\ts=dkim; t=1761533749; h=from:subject:date:to:mime-version:content-type;\r\n\tbh=FubILrzzID5ITXuBBz/JDsgLqSpuu7cYrZMIVwDGYpM=;\r\n\tb=FIuZSbTb0SluxE4vHeXOMuGeyZFH8INiWI7w3aYLybBqpMRCMu6jlI3MPfYSReQp9zSneW\r\n\tFAOoaSu6ztybAikhDjSFIiHpnqb08Yb7oL74hH/PhZM43syKzZh5CFvx3StDVMDRx30V7S\r\n\tyl2DQ/LdUGJp0ID42i7KG/5ZuoXyiJKNQmik8UZOUXqVfso9Nvi7gS35dhxq67gnaw5xZ2\r\n\tJOZN71P2BdVXAxycAqm481GZ54j3bO4GgD7tSd4+Uudqv7RWEjdqr684YrBY2E6X1KDoDS\r\n\tv0FpgiND3bBT9DFPwZse1caDI+7LTkxwgxKQ/CQgSbtogmm9xoi8WwJYnQoj1g==\r\nFrom: PVESS01 <alerts@suprsolutions.com>\r\nTo: alerts@suprsolutions.com\r\nSubject: vzdump backup status (PVESS01.local): backup successful \r\nMIME-Version: 1.0\r\nDate: Mon, 27 Oct 2025 02:55:47 +0000\r\nAuto-Submitted: auto-generated;\r\nContent-Type: multipart/alternative;\r\n boundary="TmSeglvjk4LAgINxHJYy37H5xdN6w3SzrAbRpoZt"\r\nX-Last-TLS-Session-Version: TLSv1.3\r\n\r\n--TmSeglvjk4LAgINxHJYy37H5xdN6w3SzrAbRpoZt\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n\r\nDetails\r\n=3D=3D=3D=3D=3D=3D=3D\r\nVMID    Name                         Status    Time       Size           Fi=\r\nlename                       =20\r\n100     network.suprsolutions.com    ok        23s        2.307 GiB      ct=\r\n/100/2025-10-27T02:30:16Z    =20\r\n101     cloud.suprsolutions.com      ok        1m 6s      4.631 GiB      ct=\r\n/101/2025-10-27T02:30:39Z    =20\r\n102     vaultwarden-server           ok        20s        2.057 GiB      ct=\r\n/102/2025-10-27T02:31:45Z    =20\r\n200     mail-server                  ok        9s         200.001 GiB    vm=\r\n/200/2025-10-27T02:32:05Z    =20\r\n201     tacticalrmm-server           ok        6s         32.001 GiB     vm=\r\n/201/2025-10-27T02:32:14Z    =20\r\n202     itflow-server                ok        5s         48 GiB         vm=\r\n/202/2025-10-27T02:32:20Z    =20\r\n300     home.suprcloud.io            ok        10m 21s    146.522 GiB    ct=\r\n/300/2025-10-27T02:32:25Z    =20\r\n301     intecit.suprcloud.io         ok        6m 1s      80.406 GiB     ct=\r\n/301/2025-10-27T02:42:47Z    =20\r\n302     supr-domain-controller       ok        46s        64.001 GiB     vm=\r\n/302/2025-10-27T02:48:48Z    =20\r\n303     tor-server                   ok        10s        16.001 GiB     vm=\r\n/303/2025-10-27T02:49:35Z    =20\r\n304     valheim-server               ok        3m 8s      55.001 GiB     vm=\r\n/304/2025-10-27T02:49:46Z    =20\r\n305     admin-workstation            ok        37s        64.001 GiB     vm=\r\n/305/2025-10-27T02:52:54Z    =20\r\n306     intec-work-pc                ok        1m 28s     500.004 GiB    vm=\r\n/306/2025-10-27T02:53:32Z    =20\r\n1000    ubuntu24-vm                  ok        47s        16.001 GiB     vm=\r\n/1000/2025-10-27T02:55:00Z   =20\r\n\r\nTotal running time: 25m 31s\r\nTotal size: 1.202 TiB\r\n\r\nLogs\r\n=3D=3D=3D=3D\r\nvzdump --notes-template '{{guestname}}' --mode snapshot --node PVESS01 --al=\r\nl 1 --quiet 1 --storage BACKUP-SERVER --fleecing 0\r\n\r\n\r\n100: 2025-10-26 22:30:16 INFO: Starting Backup of VM 100 (lxc)\r\n100: 2025-10-26 22:30:16 INFO: status =3D running\r\n100: 2025-10-26 22:30:16 INFO: CT Name: network.suprsolutions.com\r\n100: 2025-10-26 22:30:16 INFO: including mount point rootfs ('/') in backup\r\n100: 2025-10-26 22:30:16 INFO: backup mode: snapshot\r\n100: 2025-10-26 22:30:16 INFO: ionice priority: 7\r\n100: 2025-10-26 22:30:16 INFO: create storage snapshot 'vzdump'\r\n100: 2025-10-26 22:30:17 INFO: creating Proxmox Backup Server archi	f	\N	\N	\N	\N	2025-10-27 02:57:30.970937+00
881	alerts	38	alerts@suprsolutions.com	vzdump backup status (PVESS01.local): backup successful	98926	Return-Path: <alerts@suprsolutions.com>\r\nDelivered-To: alerts@suprsolutions.com\r\nReceived: from mail.suprsolutions.com ([172.22.1.253])\r\n\tby 6865e5e1852e with LMTP\r\n\tid YEgxJqUX/2jPFAYAHEHyOw\r\n\t(envelope-from <alerts@suprsolutions.com>)\r\n\tfor <alerts@suprsolutions.com>; Mon, 27 Oct 2025 02:56:37 -0400\r\nX-Original-To: alerts@suprsolutions.com\r\nReceived: from [127.0.0.1] (localhost [127.0.0.1]) by localhost (Mailerdaemon) with ESMTPSA id 67BA7102FC6\r\n\tfor <alerts@suprsolutions.com>; Mon, 27 Oct 2025 02:56:36 -0400 (EDT)\r\nDKIM-Signature: v=1; a=rsa-sha256; c=relaxed/relaxed; d=suprsolutions.com;\r\n\ts=dkim; t=1761548197; h=from:subject:date:to:mime-version:content-type;\r\n\tbh=6cB0kOgx7WLGZJotaNJKupynTfdYOmG24FQDexdJcM0=;\r\n\tb=T/Rx7/xo7u+rjMLNMuh5R4z7xwOvlCo6nUDhreuNBm2wPIVHw0qRMTzgM+Pb5e6JPA2znB\r\n\tGcxqYF2aHyUhCYLo1Kl+moZrjRfqd0dlnNtp54kDTXYYpuWlz2lAOjR08g5M4R7AIJe/Df\r\n\t9cumGO8f4SU+ieSZj4/fRZNYPydMNxXCKOftXHyLkfTsmD5bXGByvRNHVJqDm1KZrj3ENI\r\n\ts26dtAqDZZ+EvuG/Q2t0kK8IwFVZpvtmuxj7Yh+iudYleOWuBqonTbKX1Z9SVyxK8Eyz7a\r\n\tCtQ9U8WUCzbVScPQGQ6SNz9vELdCu8Fvxsshoat2fD2y4coyllj0crth9U5u+A==\r\nFrom: PVESS01 <alerts@suprsolutions.com>\r\nTo: alerts@suprsolutions.com\r\nSubject: vzdump backup status (PVESS01.local): backup successful \r\nMIME-Version: 1.0\r\nDate: Mon, 27 Oct 2025 06:56:35 +0000\r\nAuto-Submitted: auto-generated;\r\nContent-Type: multipart/alternative;\r\n boundary="gJd75Czjlhri9iIVKsqSzzGtTcWS3rPPPD7nvzef"\r\nX-Last-TLS-Session-Version: TLSv1.3\r\n\r\n--gJd75Czjlhri9iIVKsqSzzGtTcWS3rPPPD7nvzef\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n\r\nDetails\r\n=3D=3D=3D=3D=3D=3D=3D\r\nVMID    Name                         Status    Time       Size           Fi=\r\nlename                       =20\r\n100     network.suprsolutions.com    ok        22s        2.311 GiB      ct=\r\n/100/2025-10-27T06:30:01Z    =20\r\n101     cloud.suprsolutions.com      ok        1m 5s      4.631 GiB      ct=\r\n/101/2025-10-27T06:30:24Z    =20\r\n102     vaultwarden-server           ok        19s        2.057 GiB      ct=\r\n/102/2025-10-27T06:31:29Z    =20\r\n200     mail-server                  ok        7s         200.001 GiB    vm=\r\n/200/2025-10-27T06:31:49Z    =20\r\n201     tacticalrmm-server           ok        6s         32.001 GiB     vm=\r\n/201/2025-10-27T06:31:57Z    =20\r\n202     itflow-server                ok        4s         48 GiB         vm=\r\n/202/2025-10-27T06:32:04Z    =20\r\n300     home.suprcloud.io            ok        10m 33s    146.46 GiB     ct=\r\n/300/2025-10-27T06:32:09Z    =20\r\n301     intecit.suprcloud.io         ok        6m 2s      80.347 GiB     ct=\r\n/301/2025-10-27T06:42:42Z    =20\r\n302     supr-domain-controller       ok        18s        64.001 GiB     vm=\r\n/302/2025-10-27T06:48:44Z    =20\r\n303     tor-server                   ok        15s        16.001 GiB     vm=\r\n/303/2025-10-27T06:49:03Z    =20\r\n304     valheim-server               ok        3m 11s     55.001 GiB     vm=\r\n/304/2025-10-27T06:49:18Z    =20\r\n305     admin-workstation            ok        1m 8s      64.001 GiB     vm=\r\n/305/2025-10-27T06:52:30Z    =20\r\n306     intec-work-pc                ok        2m 7s      500.004 GiB    vm=\r\n/306/2025-10-27T06:53:39Z    =20\r\n1000    ubuntu24-vm                  ok        48s        16.001 GiB     vm=\r\n/1000/2025-10-27T06:55:47Z   =20\r\n\r\nTotal running time: 26m 34s\r\nTotal size: 1.202 TiB\r\n\r\nLogs\r\n=3D=3D=3D=3D\r\nvzdump --fleecing 0 --quiet 1 --storage BACKUP-SERVER --all 1 --notes-templ=\r\nate '{{guestname}}' --node PVESS01 --mode snapshot\r\n\r\n\r\n100: 2025-10-27 02:30:01 INFO: Starting Backup of VM 100 (lxc)\r\n100: 2025-10-27 02:30:01 INFO: status =3D running\r\n100: 2025-10-27 02:30:01 INFO: CT Name: network.suprsolutions.com\r\n100: 2025-10-27 02:30:01 INFO: including mount point rootfs ('/') in backup\r\n100: 2025-10-27 02:30:01 INFO: backup mode: snapshot\r\n100: 2025-10-27 02:30:01 INFO: ionice priority: 7\r\n100: 2025-10-27 02:30:01 INFO: create storage snapshot 'vzdump'\r\n100: 2025-10-27 02:30:02 INFO: creating Proxmox Backup Server archi	f	\N	\N	\N	\N	2025-10-27 06:57:31.572177+00
2205	alerts	39	alerts@suprsolutions.com	vzdump backup status (PVESS01.local): backup successful	126809	Return-Path: <alerts@suprsolutions.com>\r\nDelivered-To: alerts@suprsolutions.com\r\nReceived: from mail.suprsolutions.com ([172.22.1.253])\r\n\tby 6865e5e1852e with LMTP\r\n\tid 2PrtFmMyAGkp+gYAHEHyOw\r\n\t(envelope-from <alerts@suprsolutions.com>)\r\n\tfor <alerts@suprsolutions.com>; Mon, 27 Oct 2025 23:02:59 -0400\r\nX-Original-To: alerts@suprsolutions.com\r\nReceived: from [127.0.0.1] (localhost [127.0.0.1]) by localhost (Mailerdaemon) with ESMTPSA id 1F6A7102F87\r\n\tfor <alerts@suprsolutions.com>; Mon, 27 Oct 2025 23:02:57 -0400 (EDT)\r\nDKIM-Signature: v=1; a=rsa-sha256; c=relaxed/relaxed; d=suprsolutions.com;\r\n\ts=dkim; t=1761620578; h=from:subject:date:to:mime-version:content-type;\r\n\tbh=pGTU+2ocpuu5GH4yCc+SJ/4KoSfVJVVj/LIFRBoUdbI=;\r\n\tb=RF3RLs/XjvpzmbDRutZdURqa5bFl5t5z0Id+jKJCnVNjxNNuGPM+jjP/QJZs8wzijpLM/y\r\n\t1T9Tg77DoduUIacPRZbHccSk2SeUlvsycKUDUSUHtuY7UozNYJu7VF9HnaH6bKXutJ7xf8\r\n\tgkQFkEa3gbEddiZ+JLzGntys8SD0XcD3aHQy5Fyu8WylCn61v5k0QfaWH/5wdbjwZEH7dO\r\n\tesDj69aP9Siz39mohdHBOCUxCgSwjuLhBMmavohD51cg5Fg4HuI1r2Y1F1JRiVoV/85aPV\r\n\tL5D5MjyM+tJCeh3IJv15vUhmPM+n7Ajd1rw4SBbPzILq76En0xF2lrG1QATAEg==\r\nFrom: PVESS01 <alerts@suprsolutions.com>\r\nTo: alerts@suprsolutions.com\r\nSubject: vzdump backup status (PVESS01.local): backup successful \r\nMIME-Version: 1.0\r\nDate: Tue, 28 Oct 2025 03:02:57 +0000\r\nAuto-Submitted: auto-generated;\r\nContent-Type: multipart/alternative;\r\n boundary="zwRjuwNxwA2eciR7N3I79NWeIqdxtGpj7Wls6gGz"\r\nX-Last-TLS-Session-Version: TLSv1.3\r\n\r\n--zwRjuwNxwA2eciR7N3I79NWeIqdxtGpj7Wls6gGz\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n\r\nDetails\r\n=3D=3D=3D=3D=3D=3D=3D\r\nVMID    Name                         Status    Time       Size           Fi=\r\nlename                       =20\r\n100     network.suprsolutions.com    ok        23s        2.334 GiB      ct=\r\n/100/2025-10-28T02:30:02Z    =20\r\n101     cloud.suprsolutions.com      ok        1m 6s      4.573 GiB      ct=\r\n/101/2025-10-28T02:30:26Z    =20\r\n102     vaultwarden-server           ok        20s        2.058 GiB      ct=\r\n/102/2025-10-28T02:31:32Z    =20\r\n200     mail-server                  ok        27s        200.001 GiB    vm=\r\n/200/2025-10-28T02:31:52Z    =20\r\n201     tacticalrmm-server           ok        11s        32.001 GiB     vm=\r\n/201/2025-10-28T02:32:20Z    =20\r\n202     itflow-server                ok        9s         48 GiB         vm=\r\n/202/2025-10-28T02:32:32Z    =20\r\n300     home.suprcloud.io            ok        10m 31s    146.456 GiB    ct=\r\n/300/2025-10-28T02:32:42Z    =20\r\n301     intecit.suprcloud.io         ok        6m 4s      80.416 GiB     ct=\r\n/301/2025-10-28T02:43:13Z    =20\r\n302     supr-domain-controller       ok        1m 12s     64.001 GiB     vm=\r\n/302/2025-10-28T02:49:17Z    =20\r\n303     tor-server                   ok        34s        16.001 GiB     vm=\r\n/303/2025-10-28T02:50:29Z    =20\r\n304     valheim-server               ok        3m 12s     55.001 GiB     vm=\r\n/304/2025-10-28T02:51:03Z    =20\r\n305     admin-workstation            ok        2m 38s     64.001 GiB     vm=\r\n/305/2025-10-28T02:54:16Z    =20\r\n306     intec-work-pc                ok        4m 21s     500.004 GiB    vm=\r\n/306/2025-10-28T02:56:54Z    =20\r\n307     intec-testing-pc             ok        52s        72.004 GiB     vm=\r\n/307/2025-10-28T03:01:16Z    =20\r\n1000    ubuntu24-vm                  ok        47s        16.001 GiB     vm=\r\n/1000/2025-10-28T03:02:09Z   =20\r\n\r\nTotal running time: 32m 55s\r\nTotal size: 1.272 TiB\r\n\r\nLogs\r\n=3D=3D=3D=3D\r\nvzdump --fleecing 0 --quiet 1 --storage BACKUP-SERVER --all 1 --node PVESS0=\r\n1 --mode snapshot --notes-template '{{guestname}}'\r\n\r\n\r\n100: 2025-10-27 22:30:02 INFO: Starting Backup of VM 100 (lxc)\r\n100: 2025-10-27 22:30:02 INFO: status =3D running\r\n100: 2025-10-27 22:30:02 INFO: CT Name: network.suprsolutions.com\r\n100: 2025-10-27 22:30:02 INFO: including mount point rootfs ('/') in backup\r\n100: 2025-10-27 22:30:02 INFO: backup mode: snapshot\r\n100: 2025-10-27 22:30:02 INFO: ionice priority: 7\r\n100: 2025-10-27 22:3	f	\N	\N	\N	\N	2025-10-28 03:05:31.262086+00
2698	alerts	40	alerts@suprsolutions.com	vzdump backup status (PVESS01.local): backup failed	110554	Return-Path: <alerts@suprsolutions.com>\r\nDelivered-To: alerts@suprsolutions.com\r\nReceived: from mail.suprsolutions.com ([172.22.1.253])\r\n\tby 6865e5e1852e with LMTP\r\n\tid kPzXE7hpAGn+KQcAHEHyOw\r\n\t(envelope-from <alerts@suprsolutions.com>)\r\n\tfor <alerts@suprsolutions.com>; Tue, 28 Oct 2025 02:59:04 -0400\r\nX-Original-To: alerts@suprsolutions.com\r\nReceived: from [127.0.0.1] (localhost [127.0.0.1]) by localhost (Mailerdaemon) with ESMTPSA id F2603102F87\r\n\tfor <alerts@suprsolutions.com>; Tue, 28 Oct 2025 02:59:02 -0400 (EDT)\r\nDKIM-Signature: v=1; a=rsa-sha256; c=relaxed/relaxed; d=suprsolutions.com;\r\n\ts=dkim; t=1761634743; h=from:subject:date:to:mime-version:content-type;\r\n\tbh=+Za5AdgkCl1PAgw8/QOXcmil8SMnpLXcq5ZuaqkxLTA=;\r\n\tb=PSiOW2rS5pRIW1OTrVZVUPJkIwKB7R89EhYaaXpdf75u7/X7u8gNKQvL7XQZqNLw8hI728\r\n\tQn3sdgrmIzk68+fHVh0kZoO8QNI41UEiIMb/d7GJGamyxVbw3xxTWNGPMCYBPm8W9/TKBC\r\n\twr//DRJ8mV2PtRizerko1JN4CDPt499VV0Tara+C6CiUBUgoz5DPQlPUKJgqMAg7s+YpGL\r\n\tzqGsMeHWvuQzeHnkjn4ujQ5X8C3h8q3Dp7VNKE56eOPQO/V6zDw962Idf/V/Zr2DbI0M1J\r\n\t91fBBIXbc2/4LP1nf8zJ4CDOPk0FZmoj/MsVrewOgyeD2rNomfDfdEL+eiEhkw==\r\nFrom: PVESS01 <alerts@suprsolutions.com>\r\nTo: alerts@suprsolutions.com\r\nSubject: vzdump backup status (PVESS01.local): backup failed \r\nMIME-Version: 1.0\r\nDate: Tue, 28 Oct 2025 06:59:02 +0000\r\nAuto-Submitted: auto-generated;\r\nContent-Type: multipart/alternative;\r\n boundary="6c9MCJ9UpAurpBb4x4a6sYpmIdTvI3B429DzSTIJ"\r\nX-Last-TLS-Session-Version: TLSv1.3\r\n\r\n--6c9MCJ9UpAurpBb4x4a6sYpmIdTvI3B429DzSTIJ\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n\r\nDetails\r\n=3D=3D=3D=3D=3D=3D=3D\r\nVMID    Name                         Status    Time       Size           Fi=\r\nlename                       =20\r\n100     network.suprsolutions.com    ok        23s        2.338 GiB      ct=\r\n/100/2025-10-28T06:30:04Z    =20\r\n101     cloud.suprsolutions.com      ok        1m 7s      4.641 GiB      ct=\r\n/101/2025-10-28T06:30:27Z    =20\r\n102     vaultwarden-server           ok        19s        2.057 GiB      ct=\r\n/102/2025-10-28T06:31:34Z    =20\r\n200     mail-server                  ok        9s         200.001 GiB    vm=\r\n/200/2025-10-28T06:31:53Z    =20\r\n201     tacticalrmm-server           ok        15s        32.001 GiB     vm=\r\n/201/2025-10-28T06:32:03Z    =20\r\n202     itflow-server                ok        4s         48 GiB         vm=\r\n/202/2025-10-28T06:32:19Z    =20\r\n300     home.suprcloud.io            ok        10m 37s    146.461 GiB    ct=\r\n/300/2025-10-28T06:32:24Z    =20\r\n301     intecit.suprcloud.io         ok        6m 4s      80.417 GiB     ct=\r\n/301/2025-10-28T06:43:02Z    =20\r\n302     supr-domain-controller       ok        35s        64.001 GiB     vm=\r\n/302/2025-10-28T06:49:07Z    =20\r\n303     tor-server                   ok        19s        16.001 GiB     vm=\r\n/303/2025-10-28T06:49:43Z    =20\r\n304     valheim-server               ok        3m 7s      55.001 GiB     vm=\r\n/304/2025-10-28T06:50:03Z    =20\r\n305     admin-workstation            ok        1m 15s     64.001 GiB     vm=\r\n/305/2025-10-28T06:53:10Z    =20\r\n306     intec-work-pc                ok        3m 47s     500.004 GiB    vm=\r\n/306/2025-10-28T06:54:26Z    =20\r\n307     intec-testing-pc             err       1s         0 B            nu=\r\nll                           =20\r\n1000    ubuntu24-vm                  ok        46s        16.001 GiB     vm=\r\n/1000/2025-10-28T06:58:15Z   =20\r\n\r\nTotal running time: 28m 58s\r\nTotal size: 1.202 TiB\r\n\r\nLogs\r\n=3D=3D=3D=3D\r\nvzdump --notes-template '{{guestname}}' --mode snapshot --node PVESS01 --al=\r\nl 1 --storage BACKUP-SERVER --quiet 1 --fleecing 0\r\n\r\n\r\n100: 2025-10-28 02:30:04 INFO: Starting Backup of VM 100 (lxc)\r\n100: 2025-10-28 02:30:04 INFO: status =3D running\r\n100: 2025-10-28 02:30:04 INFO: CT Name: network.suprsolutions.com\r\n100: 2025-10-28 02:30:04 INFO: including mount point rootfs ('/') in backup\r\n100: 2025-10-28 02:30:05 INFO: backup mode: snapshot\r\n100: 2025-10-28 02:30:05 INFO: ionice priority: 7\r\n100: 2025-10-28 02:30:05	f	\N	\N	\N	\N	2025-10-28 07:00:01.414133+00
4751	alerts	41	alerts@suprsolutions.com	vzdump backup status (PVESS01.local): backup failed	125460	Return-Path: <alerts@suprsolutions.com>\r\nDelivered-To: alerts@suprsolutions.com\r\nReceived: from mail.suprsolutions.com ([172.22.1.253])\r\n\tby 6865e5e1852e with LMTP\r\n\tid UGPGNbSDAWluHggAHEHyOw\r\n\t(envelope-from <alerts@suprsolutions.com>)\r\n\tfor <alerts@suprsolutions.com>; Tue, 28 Oct 2025 23:02:12 -0400\r\nX-Original-To: alerts@suprsolutions.com\r\nReceived: from [127.0.0.1] (localhost [127.0.0.1]) by localhost (Mailerdaemon) with ESMTPSA id D5417102FC6\r\n\tfor <alerts@suprsolutions.com>; Tue, 28 Oct 2025 23:02:11 -0400 (EDT)\r\nDKIM-Signature: v=1; a=rsa-sha256; c=relaxed/relaxed; d=suprsolutions.com;\r\n\ts=dkim; t=1761706932; h=from:subject:date:to:mime-version:content-type;\r\n\tbh=6pDuHPZmgJbi/dJhccVp32PjIKVVeW+OE5sXAaGI9+c=;\r\n\tb=Nb4kWHXd3t6qIACcgriVBkKrntnM4Mfr/tweRVpGCsKk8U2vQNsqJURbXyOdSPVloAPIr4\r\n\tvujDZecnRS1iGGbIHVKEv07uaoCutP+35c0Hqm0IAGKu7AeeBxTJSqvu71fFmP1Dpus8Af\r\n\tj+bDmAAoIAE/00yrH9zpR7VMgQTFVZMIiMCHAnenQplbvt80KtAU3o269kHDN01QokLJZX\r\n\t6dNm3qghJBZAlINs8hDSAOisbYn25lYQzewzW8UFMtpZr116/QjukBRma4QZirKTemI570\r\n\t+E7jIMdqWxM2+QXLTUdm9OTo3X527mKEAnsMgrbsMyK+ByvcgZ7/xamg9TiyjQ==\r\nFrom: PVESS01 <alerts@suprsolutions.com>\r\nTo: alerts@suprsolutions.com\r\nSubject: vzdump backup status (PVESS01.local): backup failed \r\nMIME-Version: 1.0\r\nDate: Wed, 29 Oct 2025 03:02:11 +0000\r\nAuto-Submitted: auto-generated;\r\nContent-Type: multipart/alternative;\r\n boundary="CvmjAOI3LKdvm9anNOSlYSOC2LShuyHNLQdE7mzO"\r\nX-Last-TLS-Session-Version: TLSv1.3\r\n\r\n--CvmjAOI3LKdvm9anNOSlYSOC2LShuyHNLQdE7mzO\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n\r\nDetails\r\n=3D=3D=3D=3D=3D=3D=3D\r\nVMID    Name                         Status    Time      Size           Fil=\r\nename                       =20\r\n100     network.suprsolutions.com    ok        22s       2.348 GiB      ct/=\r\n100/2025-10-29T02:30:12Z    =20\r\n101     cloud.suprsolutions.com      ok        1m 6s     4.581 GiB      ct/=\r\n101/2025-10-29T02:30:35Z    =20\r\n102     vaultwarden-server           ok        19s       2.066 GiB      ct/=\r\n102/2025-10-29T02:31:41Z    =20\r\n200     mail-server                  ok        27s       200.001 GiB    vm/=\r\n200/2025-10-29T02:32:01Z    =20\r\n201     tacticalrmm-server           ok        55s       32.001 GiB     vm/=\r\n201/2025-10-29T02:32:28Z    =20\r\n202     itflow-server                ok        13s       48 GiB         vm/=\r\n202/2025-10-29T02:33:23Z    =20\r\n300     home.suprcloud.io            ok        10m 9s    146.526 GiB    ct/=\r\n300/2025-10-29T02:33:37Z    =20\r\n301     intecit.suprcloud.io         ok        5m 58s    80.426 GiB     ct/=\r\n301/2025-10-29T02:43:47Z    =20\r\n302     supr-domain-controller       ok        1m 12s    64.001 GiB     vm/=\r\n302/2025-10-29T02:49:45Z    =20\r\n303     tor-server                   ok        22s       16.001 GiB     vm/=\r\n303/2025-10-29T02:50:57Z    =20\r\n304     valheim-server               ok        3m 11s    55.001 GiB     vm/=\r\n304/2025-10-29T02:51:20Z    =20\r\n305     admin-workstation            ok        2m 40s    64.001 GiB     vm/=\r\n305/2025-10-29T02:54:31Z    =20\r\n306     intec-work-pc                ok        4m 12s    500.004 GiB    vm/=\r\n306/2025-10-29T02:57:11Z    =20\r\n307     intec-testing-pc             err       1s        0 B            nul=\r\nl                           =20\r\n1000    ubuntu24-vm                  ok        46s       16.001 GiB     vm/=\r\n1000/2025-10-29T03:01:24Z   =20\r\n\r\nTotal running time: 31m 59s\r\nTotal size: 1.202 TiB\r\n\r\nLogs\r\n=3D=3D=3D=3D\r\nvzdump --quiet 1 --storage BACKUP-SERVER --fleecing 0 --mode snapshot --nod=\r\ne PVESS01 --notes-template '{{guestname}}' --all 1\r\n\r\n\r\n100: 2025-10-28 22:30:12 INFO: Starting Backup of VM 100 (lxc)\r\n100: 2025-10-28 22:30:12 INFO: status =3D running\r\n100: 2025-10-28 22:30:12 INFO: CT Name: network.suprsolutions.com\r\n100: 2025-10-28 22:30:12 INFO: including mount point rootfs ('/') in backup\r\n100: 2025-10-28 22:30:12 INFO: backup mode: snapshot\r\n100: 2025-10-28 22:30:12 INFO: ionice priority: 7\r\n100: 2025-10-28 22:30:12 INFO: create st	f	\N	\N	\N	\N	2025-10-29 15:12:31.733013+00
4752	alerts	42	alerts@suprsolutions.com	vzdump backup status (PVESS01.local): backup failed	106587	Return-Path: <alerts@suprsolutions.com>\r\nDelivered-To: alerts@suprsolutions.com\r\nReceived: from mail.suprsolutions.com ([172.22.1.253])\r\n\tby 6865e5e1852e with LMTP\r\n\tid QDe/Hv26AWllTAgAHEHyOw\r\n\t(envelope-from <alerts@suprsolutions.com>)\r\n\tfor <alerts@suprsolutions.com>; Wed, 29 Oct 2025 02:58:05 -0400\r\nX-Original-To: alerts@suprsolutions.com\r\nReceived: from [127.0.0.1] (localhost [127.0.0.1]) by localhost (Mailerdaemon) with ESMTPSA id AC503102FC9\r\n\tfor <alerts@suprsolutions.com>; Wed, 29 Oct 2025 02:58:03 -0400 (EDT)\r\nDKIM-Signature: v=1; a=rsa-sha256; c=relaxed/relaxed; d=suprsolutions.com;\r\n\ts=dkim; t=1761721084; h=from:subject:date:to:mime-version:content-type;\r\n\tbh=cZrjMJxHeEoXw7ovlmWgSLclqAAFQICxB/60LMTLVCI=;\r\n\tb=hEuas0iGRZuVjJutydQIsDxR8BFe7ndBgFsDPmBhjToOpAf+l8qGawmoCjDqiRbobUfFN7\r\n\ta3OOpPSZdud0GlhpIuIeDr3WQt4rdxh1Xqbl4gPkZIcyr2u8oh3kaVrqPGA0vccvDq+26e\r\n\tdHaFibQCi8h/vSIAtErd+tBeB5Jvx9HmOe+miXJrE9fURz+LAyk5hSMMRHV287xUN6lTxL\r\n\tQ+z9uDgOyQqsozYZJaO7+HqV5RAr7cW5qKO05pqc7spLW0hyF97wlSE4ZSf3x7zjUgYevc\r\n\tWu0FulXLvYSVwkuw82CkSZBe3ISnTzzeE3khd1+bk2GpbXI+ixl8DY+GZ3HnBw==\r\nFrom: PVESS01 <alerts@suprsolutions.com>\r\nTo: alerts@suprsolutions.com\r\nSubject: vzdump backup status (PVESS01.local): backup failed \r\nMIME-Version: 1.0\r\nDate: Wed, 29 Oct 2025 06:58:02 +0000\r\nAuto-Submitted: auto-generated;\r\nContent-Type: multipart/alternative;\r\n boundary="PyKTU4FltE3VuAqWkceyukYcc6Yf7h2UlR0mHuST"\r\nX-Last-TLS-Session-Version: TLSv1.3\r\n\r\n--PyKTU4FltE3VuAqWkceyukYcc6Yf7h2UlR0mHuST\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n\r\nDetails\r\n=3D=3D=3D=3D=3D=3D=3D\r\nVMID    Name                         Status    Time       Size           Fi=\r\nlename                       =20\r\n100     network.suprsolutions.com    ok        22s        2.348 GiB      ct=\r\n/100/2025-10-29T06:30:02Z    =20\r\n101     cloud.suprsolutions.com      ok        1m 6s      4.649 GiB      ct=\r\n/101/2025-10-29T06:30:24Z    =20\r\n102     vaultwarden-server           ok        19s        2.065 GiB      ct=\r\n/102/2025-10-29T06:31:31Z    =20\r\n200     mail-server                  ok        8s         200.001 GiB    vm=\r\n/200/2025-10-29T06:31:50Z    =20\r\n201     tacticalrmm-server           ok        8s         32.001 GiB     vm=\r\n/201/2025-10-29T06:31:58Z    =20\r\n202     itflow-server                ok        10s        48 GiB         vm=\r\n/202/2025-10-29T06:32:06Z    =20\r\n300     home.suprcloud.io            ok        10m 37s    146.463 GiB    ct=\r\n/300/2025-10-29T06:32:17Z    =20\r\n301     intecit.suprcloud.io         ok        5m 59s     80.426 GiB     ct=\r\n/301/2025-10-29T06:42:55Z    =20\r\n302     supr-domain-controller       ok        23s        64.001 GiB     vm=\r\n/302/2025-10-29T06:48:54Z    =20\r\n303     tor-server                   ok        17s        16.001 GiB     vm=\r\n/303/2025-10-29T06:49:17Z    =20\r\n304     valheim-server               ok        3m 10s     55.001 GiB     vm=\r\n/304/2025-10-29T06:49:34Z    =20\r\n305     admin-workstation            ok        1m 13s     64.001 GiB     vm=\r\n/305/2025-10-29T06:52:44Z    =20\r\n306     intec-work-pc                ok        3m 16s     500.004 GiB    vm=\r\n/306/2025-10-29T06:53:57Z    =20\r\n307     intec-testing-pc             err       <0.1s      0 B            nu=\r\nll                           =20\r\n1000    ubuntu24-vm                  ok        48s        16.001 GiB     vm=\r\n/1000/2025-10-29T06:57:14Z   =20\r\n\r\nTotal running time: 28m\r\nTotal size: 1.202 TiB\r\n\r\nLogs\r\n=3D=3D=3D=3D\r\nvzdump --all 1 --notes-template '{{guestname}}' --mode snapshot --node PVES=\r\nS01 --quiet 1 --storage BACKUP-SERVER --fleecing 0\r\n\r\n\r\n100: 2025-10-29 02:30:02 INFO: Starting Backup of VM 100 (lxc)\r\n100: 2025-10-29 02:30:02 INFO: status =3D running\r\n100: 2025-10-29 02:30:02 INFO: CT Name: network.suprsolutions.com\r\n100: 2025-10-29 02:30:02 INFO: including mount point rootfs ('/') in backup\r\n100: 2025-10-29 02:30:02 INFO: backup mode: snapshot\r\n100: 2025-10-29 02:30:02 INFO: ionice priority: 7\r\n100: 2025-10-29 02:30:02 INF	f	\N	\N	\N	\N	2025-10-29 15:12:31.888176+00
5961	alerts	43	alerts@suprsolutions.com	vzdump backup status (PVESS01.local): backup successful	123661	Return-Path: <alerts@suprsolutions.com>\r\nDelivered-To: alerts@suprsolutions.com\r\nReceived: from mail.suprsolutions.com ([172.22.1.253])\r\n\tby 6865e5e1852e with LMTP\r\n\tid oNDcEUPVAmnSQAkAHEHyOw\r\n\t(envelope-from <alerts@suprsolutions.com>)\r\n\tfor <alerts@suprsolutions.com>; Wed, 29 Oct 2025 23:02:27 -0400\r\nX-Original-To: alerts@suprsolutions.com\r\nReceived: from [127.0.0.1] (localhost [127.0.0.1]) by localhost (Mailerdaemon) with ESMTPSA id 2D3DA102FC5\r\n\tfor <alerts@suprsolutions.com>; Wed, 29 Oct 2025 23:02:26 -0400 (EDT)\r\nDKIM-Signature: v=1; a=rsa-sha256; c=relaxed/relaxed; d=suprsolutions.com;\r\n\ts=dkim; t=1761793346; h=from:subject:date:to:mime-version:content-type;\r\n\tbh=NlMixchJHaVkeFTgBPWZJl3N1B39UHKZlelbXg20kEM=;\r\n\tb=i3PI+at5CL0hM03xgC9QJagr/UoofsptlU36qncEg887JwSY5oR5FmLJe4+dthvKygBBbV\r\n\tJG3IUwviwt7JqoRAOGiutzGQiLQUdtigs2q6P7QzdtcxO36KJN6BGeqAeLVMzlvWILiWUf\r\n\tfqLxN6XlsnHLO/D113DFCcSqGz8Sf/Ggy/a5/fYFGMQZnN/ywSEA7uWqye8u9ZR8EAmEl5\r\n\tUbdNneuyLNx04pU5+Tr7E0nsfJEPVRPL5amgZQGZvSmjlFHfzkeDMdrGioRl1vI6b/NIVa\r\n\t6p8QKZ/QRWqNtSeUGOW77EMpKwUpgw9Xz4KoeDqejwPY7WAUP8tgagOPvuPOww==\r\nFrom: PVESS01 <alerts@suprsolutions.com>\r\nTo: alerts@suprsolutions.com\r\nSubject: vzdump backup status (PVESS01.local): backup successful \r\nMIME-Version: 1.0\r\nDate: Thu, 30 Oct 2025 03:02:25 +0000\r\nAuto-Submitted: auto-generated;\r\nContent-Type: multipart/alternative;\r\n boundary="3p6xG6S5pHmWFJwgLrc7Ffpjzxa0aRteLCmanGyu"\r\nX-Last-TLS-Session-Version: TLSv1.3\r\n\r\n--3p6xG6S5pHmWFJwgLrc7Ffpjzxa0aRteLCmanGyu\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n\r\nDetails\r\n=3D=3D=3D=3D=3D=3D=3D\r\nVMID    Name                         Status    Time       Size           Fi=\r\nlename                       =20\r\n100     network.suprsolutions.com    ok        22s        2.357 GiB      ct=\r\n/100/2025-10-30T02:30:02Z    =20\r\n101     cloud.suprsolutions.com      ok        1m 11s     4.658 GiB      ct=\r\n/101/2025-10-30T02:30:25Z    =20\r\n102     vaultwarden-server           ok        19s        2.066 GiB      ct=\r\n/102/2025-10-30T02:31:36Z    =20\r\n200     mail-server                  ok        37s        200.001 GiB    vm=\r\n/200/2025-10-30T02:31:55Z    =20\r\n201     tacticalrmm-server           ok        15s        32.001 GiB     vm=\r\n/201/2025-10-30T02:32:32Z    =20\r\n202     itflow-server                ok        12s        48 GiB         vm=\r\n/202/2025-10-30T02:32:47Z    =20\r\n300     home.suprcloud.io            ok        10m 29s    146.559 GiB    ct=\r\n/300/2025-10-30T02:32:59Z    =20\r\n301     intecit.suprcloud.io         ok        5m 55s     80.437 GiB     ct=\r\n/301/2025-10-30T02:43:29Z    =20\r\n302     supr-domain-controller       ok        1m 16s     64.001 GiB     vm=\r\n/302/2025-10-30T02:49:25Z    =20\r\n303     tor-server                   ok        25s        16.001 GiB     vm=\r\n/303/2025-10-30T02:50:41Z    =20\r\n304     valheim-server               ok        3m 6s      55.001 GiB     vm=\r\n/304/2025-10-30T02:51:07Z    =20\r\n305     admin-workstation            ok        2m 21s     64.001 GiB     vm=\r\n/305/2025-10-30T02:54:14Z    =20\r\n306     intec-work-pc                ok        5m 2s      500.004 GiB    vm=\r\n/306/2025-10-30T02:56:35Z    =20\r\n1000    ubuntu24-vm                  ok        46s        16.001 GiB     vm=\r\n/1000/2025-10-30T03:01:38Z   =20\r\n\r\nTotal running time: 32m 23s\r\nTotal size: 1.202 TiB\r\n\r\nLogs\r\n=3D=3D=3D=3D\r\nvzdump --fleecing 0 --storage BACKUP-SERVER --quiet 1 --node PVESS01 --mode=\r\n snapshot --notes-template '{{guestname}}' --all 1\r\n\r\n\r\n100: 2025-10-29 22:30:02 INFO: Starting Backup of VM 100 (lxc)\r\n100: 2025-10-29 22:30:02 INFO: status =3D running\r\n100: 2025-10-29 22:30:02 INFO: CT Name: network.suprsolutions.com\r\n100: 2025-10-29 22:30:02 INFO: including mount point rootfs ('/') in backup\r\n100: 2025-10-29 22:30:02 INFO: backup mode: snapshot\r\n100: 2025-10-29 22:30:02 INFO: ionice priority: 7\r\n100: 2025-10-29 22:30:02 INFO: create storage snapshot 'vzdump'\r\n100: 2025-10-29 22:30:03 INFO: creating Proxmox Backup Server archi	f	\N	\N	\N	\N	2025-10-30 03:03:01.434621+00
6099	alerts	44	alerts@suprsolutions.com	vzdump backup status (PVESS01.local): backup successful	105401	Return-Path: <alerts@suprsolutions.com>\r\nDelivered-To: alerts@suprsolutions.com\r\nReceived: from mail.suprsolutions.com ([172.22.1.253])\r\n\tby 6865e5e1852e with LMTP\r\n\tid eJjPM7kMA2mxbQkAHEHyOw\r\n\t(envelope-from <alerts@suprsolutions.com>)\r\n\tfor <alerts@suprsolutions.com>; Thu, 30 Oct 2025 02:59:05 -0400\r\nX-Original-To: alerts@suprsolutions.com\r\nReceived: from [127.0.0.1] (localhost [127.0.0.1]) by localhost (Mailerdaemon) with ESMTPSA id 935CB102F87\r\n\tfor <alerts@suprsolutions.com>; Thu, 30 Oct 2025 02:59:04 -0400 (EDT)\r\nDKIM-Signature: v=1; a=rsa-sha256; c=relaxed/relaxed; d=suprsolutions.com;\r\n\ts=dkim; t=1761807545; h=from:subject:date:to:mime-version:content-type;\r\n\tbh=u56DIi0HMjtiTta8FOQ380+Gqw7dT7TtsnanPhoL6jg=;\r\n\tb=npGjNWePZVXPuNUqCU8aykpbgp67JY3FcWQU2R5HESrtTeNuVlKUlkU8zeQ+y6DXXxlwkl\r\n\tUO3Vw+Sd+krJldgmtvka2K038vjszzbJjE8X/tgvlHTRlXLqUfY2dQQewYX8OyycviF5RK\r\n\tBB9O7sTQ7NodG656yVLJDgM+I81EM/mrLhkaQST84JgRJCj4Ju7LhU40eT0kg83wK2KyOg\r\n\tjgv9SYR1gqab2o4oRjE4xP8yevCTnStZV3pzxEcdYMSdtq4tWEMBND+cIPIUIbsvdw5S7y\r\n\t+ye4GLsARWJC4QgL0Hf3b/SzO2l/JtiIiZ9uPE/TkdBaPo3RQ2gmCcgDfArc1Q==\r\nFrom: PVESS01 <alerts@suprsolutions.com>\r\nTo: alerts@suprsolutions.com\r\nSubject: vzdump backup status (PVESS01.local): backup successful \r\nMIME-Version: 1.0\r\nDate: Thu, 30 Oct 2025 06:59:03 +0000\r\nAuto-Submitted: auto-generated;\r\nContent-Type: multipart/alternative;\r\n boundary="e2m10IMZwtHehhGFB0RlMvKLWT7K8i0YzXGQHOO6"\r\nX-Last-TLS-Session-Version: TLSv1.3\r\n\r\n--e2m10IMZwtHehhGFB0RlMvKLWT7K8i0YzXGQHOO6\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n\r\nDetails\r\n=3D=3D=3D=3D=3D=3D=3D\r\nVMID    Name                         Status    Time       Size           Fi=\r\nlename                       =20\r\n100     network.suprsolutions.com    ok        21s        2.357 GiB      ct=\r\n/100/2025-10-30T06:30:05Z    =20\r\n101     cloud.suprsolutions.com      ok        1m 7s      4.658 GiB      ct=\r\n/101/2025-10-30T06:30:26Z    =20\r\n102     vaultwarden-server           ok        19s        2.065 GiB      ct=\r\n/102/2025-10-30T06:31:34Z    =20\r\n200     mail-server                  ok        11s        200.001 GiB    vm=\r\n/200/2025-10-30T06:31:53Z    =20\r\n201     tacticalrmm-server           ok        6s         32.001 GiB     vm=\r\n/201/2025-10-30T06:32:05Z    =20\r\n202     itflow-server                ok        5s         48 GiB         vm=\r\n/202/2025-10-30T06:32:12Z    =20\r\n300     home.suprcloud.io            ok        10m 44s    146.566 GiB    ct=\r\n/300/2025-10-30T06:32:18Z    =20\r\n301     intecit.suprcloud.io         ok        6m 16s     80.438 GiB     ct=\r\n/301/2025-10-30T06:43:03Z    =20\r\n302     supr-domain-controller       ok        2m 15s     192.001 GiB    vm=\r\n/302/2025-10-30T06:49:20Z    =20\r\n303     tor-server                   ok        11s        16.001 GiB     vm=\r\n/303/2025-10-30T06:51:35Z    =20\r\n304     valheim-server               ok        3m 8s      55.001 GiB     vm=\r\n/304/2025-10-30T06:51:47Z    =20\r\n305     admin-workstation            ok        45s        64.001 GiB     vm=\r\n/305/2025-10-30T06:54:55Z    =20\r\n306     intec-work-pc                ok        2m 34s     500.004 GiB    vm=\r\n/306/2025-10-30T06:55:40Z    =20\r\n1000    ubuntu24-vm                  ok        48s        16.001 GiB     vm=\r\n/1000/2025-10-30T06:58:15Z   =20\r\n\r\nTotal running time: 28m 58s\r\nTotal size: 1.327 TiB\r\n\r\nLogs\r\n=3D=3D=3D=3D\r\nvzdump --storage BACKUP-SERVER --quiet 1 --fleecing 0 --notes-template '{{g=\r\nuestname}}' --mode snapshot --node PVESS01 --all 1\r\n\r\n\r\n100: 2025-10-30 02:30:05 INFO: Starting Backup of VM 100 (lxc)\r\n100: 2025-10-30 02:30:05 INFO: status =3D running\r\n100: 2025-10-30 02:30:05 INFO: CT Name: network.suprsolutions.com\r\n100: 2025-10-30 02:30:05 INFO: including mount point rootfs ('/') in backup\r\n100: 2025-10-30 02:30:05 INFO: backup mode: snapshot\r\n100: 2025-10-30 02:30:05 INFO: ionice priority: 7\r\n100: 2025-10-30 02:30:05 INFO: create storage snapshot 'vzdump'\r\n100: 2025-10-30 02:30:05 INFO: creating Proxmox Backup Server archi	f	\N	\N	\N	\N	2025-10-30 14:56:03.45473+00
7424	alerts	45	alerts@suprsolutions.com	vzdump backup status (PVESS01.local): backup successful	123683	Return-Path: <alerts@suprsolutions.com>\r\nDelivered-To: alerts@suprsolutions.com\r\nReceived: from mail.suprsolutions.com ([172.22.1.253])\r\n\tby 6865e5e1852e with LMTP\r\n\tid SJR+LNwmBGkgUAoAHEHyOw\r\n\t(envelope-from <alerts@suprsolutions.com>)\r\n\tfor <alerts@suprsolutions.com>; Thu, 30 Oct 2025 23:02:52 -0400\r\nX-Original-To: alerts@suprsolutions.com\r\nReceived: from [127.0.0.1] (localhost [127.0.0.1]) by localhost (Mailerdaemon) with ESMTPSA id 902E5102FC1\r\n\tfor <alerts@suprsolutions.com>; Thu, 30 Oct 2025 23:02:51 -0400 (EDT)\r\nDKIM-Signature: v=1; a=rsa-sha256; c=relaxed/relaxed; d=suprsolutions.com;\r\n\ts=dkim; t=1761879772; h=from:subject:date:to:mime-version:content-type;\r\n\tbh=G6B+XqwUQyxyczM3C3axncHgb7RrrRMcBZ9nTEQ3Mzg=;\r\n\tb=QzNJEJhqdafz8qnaq4s90ttCFNBSvcozNzTQEhOF7KRP/vUPXW+nMC8RWhf6Txbt6j3had\r\n\twR+Lt5nIl8yJju45ebgG9j37plAA0PT2gqii7VbXu7C+hTiL98cEq4g2LBMGy82UP1YP94\r\n\tmFvn551x8pF032vWv/8vfAL8j9lgtAH/Amj/v02KU45vK/U6bp3wMtsFZtpoxunPlK19nE\r\n\tkDPnsruRqTdytzLif6iFZW0guZo9KaaMkK8b+/WIcHQPX7ReuyOuMcX0j2VdY5/0lWvvUn\r\n\t8rgWQV4QOKPfH1pCuIrU4jxwJT6N9e29hRE2QD3rB0dcxFL116lJkAam6SjcqQ==\r\nFrom: PVESS01 <alerts@suprsolutions.com>\r\nTo: alerts@suprsolutions.com\r\nSubject: vzdump backup status (PVESS01.local): backup successful \r\nMIME-Version: 1.0\r\nDate: Fri, 31 Oct 2025 03:02:50 +0000\r\nAuto-Submitted: auto-generated;\r\nContent-Type: multipart/alternative;\r\n boundary="8pUUJwgbTiXbsyN44dsiIgcoOZrCbcozLKSuqPvD"\r\nX-Last-TLS-Session-Version: TLSv1.3\r\n\r\n--8pUUJwgbTiXbsyN44dsiIgcoOZrCbcozLKSuqPvD\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n\r\nDetails\r\n=3D=3D=3D=3D=3D=3D=3D\r\nVMID    Name                         Status    Time       Size           Fi=\r\nlename                       =20\r\n100     network.suprsolutions.com    ok        22s        2.367 GiB      ct=\r\n/100/2025-10-31T02:30:08Z    =20\r\n101     cloud.suprsolutions.com      ok        1m 5s      4.6 GiB        ct=\r\n/101/2025-10-31T02:30:31Z    =20\r\n102     vaultwarden-server           ok        20s        2.066 GiB      ct=\r\n/102/2025-10-31T02:31:37Z    =20\r\n200     mail-server                  ok        22s        200.001 GiB    vm=\r\n/200/2025-10-31T02:31:57Z    =20\r\n201     tacticalrmm-server           ok        15s        32.001 GiB     vm=\r\n/201/2025-10-31T02:32:19Z    =20\r\n202     itflow-server                ok        12s        48 GiB         vm=\r\n/202/2025-10-31T02:32:34Z    =20\r\n300     home.suprcloud.io            ok        10m 44s    146.592 GiB    ct=\r\n/300/2025-10-31T02:32:46Z    =20\r\n301     intecit.suprcloud.io         ok        6m 3s      80.448 GiB     ct=\r\n/301/2025-10-31T02:43:30Z    =20\r\n302     supr-domain-controller       ok        1m 21s     192.001 GiB    vm=\r\n/302/2025-10-31T02:49:34Z    =20\r\n303     tor-server                   ok        18s        16.001 GiB     vm=\r\n/303/2025-10-31T02:50:56Z    =20\r\n304     valheim-server               ok        3m 8s      55.001 GiB     vm=\r\n/304/2025-10-31T02:51:14Z    =20\r\n305     admin-workstation            ok        2m 39s     64.001 GiB     vm=\r\n/305/2025-10-31T02:54:23Z    =20\r\n306     intec-work-pc                ok        4m 58s     500.004 GiB    vm=\r\n/306/2025-10-31T02:57:03Z    =20\r\n1000    ubuntu24-vm                  ok        49s        16.001 GiB     vm=\r\n/1000/2025-10-31T03:02:01Z   =20\r\n\r\nTotal running time: 32m 42s\r\nTotal size: 1.327 TiB\r\n\r\nLogs\r\n=3D=3D=3D=3D\r\nvzdump --fleecing 0 --quiet 1 --storage BACKUP-SERVER --all 1 --notes-templ=\r\nate '{{guestname}}' --node PVESS01 --mode snapshot\r\n\r\n\r\n100: 2025-10-30 22:30:08 INFO: Starting Backup of VM 100 (lxc)\r\n100: 2025-10-30 22:30:08 INFO: status =3D running\r\n100: 2025-10-30 22:30:08 INFO: CT Name: network.suprsolutions.com\r\n100: 2025-10-30 22:30:08 INFO: including mount point rootfs ('/') in backup\r\n100: 2025-10-30 22:30:08 INFO: backup mode: snapshot\r\n100: 2025-10-30 22:30:08 INFO: ionice priority: 7\r\n100: 2025-10-30 22:30:08 INFO: create storage snapshot 'vzdump'\r\n100: 2025-10-30 22:30:09 INFO: creating Proxmox Backup Server archi	f	\N	\N	\N	\N	2025-10-31 03:04:01.416688+00
7498	alerts	46	alerts@suprsolutions.com	vzdump backup status (PVESS01.local): backup successful	104574	Return-Path: <alerts@suprsolutions.com>\r\nDelivered-To: alerts@suprsolutions.com\r\nReceived: from mail.suprsolutions.com ([172.22.1.253])\r\n\tby 6865e5e1852e with LMTP\r\n\tid SAJVKQ1eBGkBewoAHEHyOw\r\n\t(envelope-from <alerts@suprsolutions.com>)\r\n\tfor <alerts@suprsolutions.com>; Fri, 31 Oct 2025 02:58:21 -0400\r\nX-Original-To: alerts@suprsolutions.com\r\nReceived: from [127.0.0.1] (localhost [127.0.0.1]) by localhost (Mailerdaemon) with ESMTPSA id B2D17102FC6\r\n\tfor <alerts@suprsolutions.com>; Fri, 31 Oct 2025 02:58:20 -0400 (EDT)\r\nDKIM-Signature: v=1; a=rsa-sha256; c=relaxed/relaxed; d=suprsolutions.com;\r\n\ts=dkim; t=1761893901; h=from:subject:date:to:mime-version:content-type;\r\n\tbh=r8dtxUPgsfJew/mnf4tUxT1vFwaKbcrJ6EE0ELCd8QI=;\r\n\tb=W1Fl3izt68jwZSWiYXTG94MLOfD9VuBWSpuK/oY4iyavB/lNx8atl8KCZqrqN7GHcnUOoE\r\n\tCB5DxbP1z4O0bYgpnRnmhGpa8brt6z5s/PQ9i/GtxRJEOBnPJfcBn1APrnBKQYHrdq+3yt\r\n\tOEW1PhniNc3rEAe1dgPFPpZYfNsIHnaPA/oWn8j8ecd/cueFy9YIQNOPZtrbqj12bFAV3N\r\n\tqJ3kO3dy+N6AP4kh/AOzO1iHsdv9DSQ7kLVxd9qoPjXe9O7qq9gMIaq/QSay7IpD2P3Zps\r\n\t7QYta6CDgPTu/4hvzEhKv31SxtLBjkNXD2CUhrOT6K1IXdH0o1l2YXo0HOkZvw==\r\nFrom: PVESS01 <alerts@suprsolutions.com>\r\nTo: alerts@suprsolutions.com\r\nSubject: vzdump backup status (PVESS01.local): backup successful \r\nMIME-Version: 1.0\r\nDate: Fri, 31 Oct 2025 06:58:19 +0000\r\nAuto-Submitted: auto-generated;\r\nContent-Type: multipart/alternative;\r\n boundary="42KX7GdcfveIao89Plc20vS8rlXFw2cCCqMW2Nek"\r\nX-Last-TLS-Session-Version: TLSv1.3\r\n\r\n--42KX7GdcfveIao89Plc20vS8rlXFw2cCCqMW2Nek\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n\r\nDetails\r\n=3D=3D=3D=3D=3D=3D=3D\r\nVMID    Name                         Status    Time       Size           Fi=\r\nlename                       =20\r\n100     network.suprsolutions.com    ok        21s        2.367 GiB      ct=\r\n/100/2025-10-31T06:30:11Z    =20\r\n101     cloud.suprsolutions.com      ok        1m 7s      4.668 GiB      ct=\r\n/101/2025-10-31T06:30:33Z    =20\r\n102     vaultwarden-server           ok        19s        2.065 GiB      ct=\r\n/102/2025-10-31T06:31:41Z    =20\r\n200     mail-server                  ok        9s         200.001 GiB    vm=\r\n/200/2025-10-31T06:32:00Z    =20\r\n201     tacticalrmm-server           ok        8s         32.001 GiB     vm=\r\n/201/2025-10-31T06:32:09Z    =20\r\n202     itflow-server                ok        4s         48 GiB         vm=\r\n/202/2025-10-31T06:32:18Z    =20\r\n300     home.suprcloud.io            ok        10m 43s    146.529 GiB    ct=\r\n/300/2025-10-31T06:32:23Z    =20\r\n301     intecit.suprcloud.io         ok        6m 8s      80.448 GiB     ct=\r\n/301/2025-10-31T06:43:06Z    =20\r\n302     supr-domain-controller       ok        39s        192.001 GiB    vm=\r\n/302/2025-10-31T06:49:15Z    =20\r\n303     tor-server                   ok        34s        16.001 GiB     vm=\r\n/303/2025-10-31T06:49:54Z    =20\r\n304     valheim-server               ok        3m 11s     55.001 GiB     vm=\r\n/304/2025-10-31T06:50:28Z    =20\r\n305     admin-workstation            ok        45s        64.001 GiB     vm=\r\n/305/2025-10-31T06:53:39Z    =20\r\n306     intec-work-pc                ok        3m 6s      500.004 GiB    vm=\r\n/306/2025-10-31T06:54:24Z    =20\r\n1000    ubuntu24-vm                  ok        49s        16.001 GiB     vm=\r\n/1000/2025-10-31T06:57:30Z   =20\r\n\r\nTotal running time: 28m 8s\r\nTotal size: 1.327 TiB\r\n\r\nLogs\r\n=3D=3D=3D=3D\r\nvzdump --all 1 --notes-template '{{guestname}}' --node PVESS01 --mode snaps=\r\nhot --fleecing 0 --quiet 1 --storage BACKUP-SERVER\r\n\r\n\r\n100: 2025-10-31 02:30:11 INFO: Starting Backup of VM 100 (lxc)\r\n100: 2025-10-31 02:30:11 INFO: status =3D running\r\n100: 2025-10-31 02:30:11 INFO: CT Name: network.suprsolutions.com\r\n100: 2025-10-31 02:30:11 INFO: including mount point rootfs ('/') in backup\r\n100: 2025-10-31 02:30:11 INFO: backup mode: snapshot\r\n100: 2025-10-31 02:30:11 INFO: ionice priority: 7\r\n100: 2025-10-31 02:30:11 INFO: create storage snapshot 'vzdump'\r\n100: 2025-10-31 02:30:12 INFO: creating Proxmox Backup Server archiv	f	\N	\N	\N	\N	2025-11-03 01:47:14.83277+00
7499	alerts	47	alerts@suprsolutions.com	vzdump backup status (PVESS01.local): backup successful	130605	Return-Path: <alerts@suprsolutions.com>\r\nDelivered-To: alerts@suprsolutions.com\r\nReceived: from mail.suprsolutions.com ([172.22.1.253])\r\n\tby 6865e5e1852e with LMTP\r\n\tid yBQiEEh5BWm1YQsAHEHyOw\r\n\t(envelope-from <alerts@suprsolutions.com>)\r\n\tfor <alerts@suprsolutions.com>; Fri, 31 Oct 2025 23:06:48 -0400\r\nX-Original-To: alerts@suprsolutions.com\r\nReceived: from [127.0.0.1] (localhost [127.0.0.1]) by localhost (Mailerdaemon) with ESMTPSA id ED9A1102FC6\r\n\tfor <alerts@suprsolutions.com>; Fri, 31 Oct 2025 23:06:46 -0400 (EDT)\r\nDKIM-Signature: v=1; a=rsa-sha256; c=relaxed/relaxed; d=suprsolutions.com;\r\n\ts=dkim; t=1761966407; h=from:subject:date:to:mime-version:content-type;\r\n\tbh=0Xor2Dtk85lBo+2fvr4hC/BXuwHQIIuOWwKofAbTeNA=;\r\n\tb=WoO3OElnsgHqUZy21Dh799Q2Cf1gQQz96VWqahAms+OA1LXdtN+qSja1ufL/ocankQB++a\r\n\tWkIwMlTlvlpfMV5U6L6wvKaAJv53I+jW3wje8M61hF6xy18wIxmlClNJdSWj8+lGpCQRl2\r\n\t8ENHoDlrTlFUUnJRcyZC5AXvD2wTykAnSNKr1/xY8109mpXUe88vVYJW2jqCyuaHx3HVTf\r\n\tMcCkpl7r61+WwHqkfBVgMVwls1BmeIhi69o6OFv0e1R5aeboKVIsShvROjvZjDlrW9t40P\r\n\tUuKCFWvHqV/KJyrQLAW16N8xuX+TOSRYwtVNMmcPIkMZhc+/Q48j9YxC13b/cQ==\r\nFrom: PVESS01 <alerts@suprsolutions.com>\r\nTo: alerts@suprsolutions.com\r\nSubject: vzdump backup status (PVESS01.local): backup successful \r\nMIME-Version: 1.0\r\nDate: Sat, 01 Nov 2025 03:06:46 +0000\r\nAuto-Submitted: auto-generated;\r\nContent-Type: multipart/alternative;\r\n boundary="yDkdKtI7PZK1pYtyr1Qa5tuXwuf4ZEqzywGD9ApC"\r\nX-Last-TLS-Session-Version: TLSv1.3\r\n\r\n--yDkdKtI7PZK1pYtyr1Qa5tuXwuf4ZEqzywGD9ApC\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n\r\nDetails\r\n=3D=3D=3D=3D=3D=3D=3D\r\nVMID    Name                         Status    Time       Size           Fi=\r\nlename                       =20\r\n100     network.suprsolutions.com    ok        22s        2.376 GiB      ct=\r\n/100/2025-11-01T02:30:03Z    =20\r\n101     cloud.suprsolutions.com      ok        1m 8s      4.677 GiB      ct=\r\n/101/2025-11-01T02:30:25Z    =20\r\n102     vaultwarden-server           ok        20s        2.066 GiB      ct=\r\n/102/2025-11-01T02:31:33Z    =20\r\n200     mail-server                  ok        24s        200.001 GiB    vm=\r\n/200/2025-11-01T02:31:53Z    =20\r\n201     tacticalrmm-server           ok        18s        32.001 GiB     vm=\r\n/201/2025-11-01T02:32:17Z    =20\r\n202     itflow-server                ok        39s        48 GiB         vm=\r\n/202/2025-11-01T02:32:35Z    =20\r\n300     home.suprcloud.io            ok        10m 56s    146.485 GiB    ct=\r\n/300/2025-11-01T02:33:14Z    =20\r\n301     intecit.suprcloud.io         ok        6m 3s      80.417 GiB     ct=\r\n/301/2025-11-01T02:44:11Z    =20\r\n302     supr-domain-controller       ok        1m 12s     192.001 GiB    vm=\r\n/302/2025-11-01T02:50:15Z    =20\r\n303     tor-server                   ok        18s        16.001 GiB     vm=\r\n/303/2025-11-01T02:51:28Z    =20\r\n304     valheim-server               ok        3m 8s      55.001 GiB     vm=\r\n/304/2025-11-01T02:51:47Z    =20\r\n305     admin-workstation            ok        3m 27s     64.001 GiB     vm=\r\n/305/2025-11-01T02:54:55Z    =20\r\n306     intec-work-pc                ok        7m 33s     500.004 GiB    vm=\r\n/306/2025-11-01T02:58:22Z    =20\r\n1000    ubuntu24-vm                  ok        49s        16.001 GiB     vm=\r\n/1000/2025-11-01T03:05:56Z   =20\r\n\r\nTotal running time: 36m 43s\r\nTotal size: 1.327 TiB\r\n\r\nLogs\r\n=3D=3D=3D=3D\r\nvzdump --quiet 1 --storage BACKUP-SERVER --fleecing 0 --notes-template '{{g=\r\nuestname}}' --mode snapshot --node PVESS01 --all 1\r\n\r\n\r\n100: 2025-10-31 22:30:03 INFO: Starting Backup of VM 100 (lxc)\r\n100: 2025-10-31 22:30:03 INFO: status =3D running\r\n100: 2025-10-31 22:30:03 INFO: CT Name: network.suprsolutions.com\r\n100: 2025-10-31 22:30:03 INFO: including mount point rootfs ('/') in backup\r\n100: 2025-10-31 22:30:03 INFO: backup mode: snapshot\r\n100: 2025-10-31 22:30:03 INFO: ionice priority: 7\r\n100: 2025-10-31 22:30:03 INFO: create storage snapshot 'vzdump'\r\n100: 2025-10-31 22:30:04 INFO: creating Proxmox Backup Server archi	f	\N	\N	\N	\N	2025-11-03 01:47:14.986553+00
7500	alerts	48	alerts@suprsolutions.com	vzdump backup status (PVESS01.local): backup successful	103934	Return-Path: <alerts@suprsolutions.com>\r\nDelivered-To: alerts@suprsolutions.com\r\nReceived: from mail.suprsolutions.com ([172.22.1.253])\r\n\tby 6865e5e1852e with LMTP\r\n\tid GL6XGYavBWkzjQsAHEHyOw\r\n\t(envelope-from <alerts@suprsolutions.com>)\r\n\tfor <alerts@suprsolutions.com>; Sat, 01 Nov 2025 02:58:14 -0400\r\nX-Original-To: alerts@suprsolutions.com\r\nReceived: from [127.0.0.1] (localhost [127.0.0.1]) by localhost (Mailerdaemon) with ESMTPSA id 6BDA5102FC1\r\n\tfor <alerts@suprsolutions.com>; Sat,  1 Nov 2025 02:58:13 -0400 (EDT)\r\nDKIM-Signature: v=1; a=rsa-sha256; c=relaxed/relaxed; d=suprsolutions.com;\r\n\ts=dkim; t=1761980294; h=from:subject:date:to:mime-version:content-type;\r\n\tbh=TQE4bYwmHKwE5WBWADTIvehvUTb0UApAj99ULSPpZg0=;\r\n\tb=DeKqVwOngXetxb6SSm7Y5KacUcI9Q+fepiB/zIkiPtMcQR/OP2/6nY4Hji/2rZlAgtFMfs\r\n\tJEbwi8GX6Vn+3RHGT+4lQ3W8rT9oyImvK7IVkClMJ/2Gu0mYk/GIBs84lhX0KOuPMj8mV+\r\n\tIauc0KmzwkSbDufgGLb3aXAZcDOYmzPJfE10CxCrT98AXgkbjZAvb2sgUJU1qsq2YPjyNT\r\n\tbIxAAzzEh8kbWbHut4lxzFbM6xbspqbpniPxF62FFyV9mlab2vW303dGhjnQQa4ZtQoLhJ\r\n\taeyWBZiLOyLEVjsp6a+n8y3sm00uVm2pxkSSNuqdn7IxVPKuzdivJqTEMYRpRQ==\r\nFrom: PVESS01 <alerts@suprsolutions.com>\r\nTo: alerts@suprsolutions.com\r\nSubject: vzdump backup status (PVESS01.local): backup successful \r\nMIME-Version: 1.0\r\nDate: Sat, 01 Nov 2025 06:58:12 +0000\r\nAuto-Submitted: auto-generated;\r\nContent-Type: multipart/alternative;\r\n boundary="xByjx4DKwdGh3BHL1FU8HcqsMYTHNvUXlrXai9cj"\r\nX-Last-TLS-Session-Version: TLSv1.3\r\n\r\n--xByjx4DKwdGh3BHL1FU8HcqsMYTHNvUXlrXai9cj\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n\r\nDetails\r\n=3D=3D=3D=3D=3D=3D=3D\r\nVMID    Name                         Status    Time       Size           Fi=\r\nlename                       =20\r\n100     network.suprsolutions.com    ok        23s        2.362 GiB      ct=\r\n/100/2025-11-01T06:30:05Z    =20\r\n101     cloud.suprsolutions.com      ok        1m 8s      4.685 GiB      ct=\r\n/101/2025-11-01T06:30:28Z    =20\r\n102     vaultwarden-server           ok        19s        2.066 GiB      ct=\r\n/102/2025-11-01T06:31:36Z    =20\r\n200     mail-server                  ok        11s        200.001 GiB    vm=\r\n/200/2025-11-01T06:31:56Z    =20\r\n201     tacticalrmm-server           ok        8s         32.001 GiB     vm=\r\n/201/2025-11-01T06:32:07Z    =20\r\n202     itflow-server                ok        37s        48 GiB         vm=\r\n/202/2025-11-01T06:32:15Z    =20\r\n300     home.suprcloud.io            ok        10m 43s    146.423 GiB    ct=\r\n/300/2025-11-01T06:32:53Z    =20\r\n301     intecit.suprcloud.io         ok        6m 12s     80.351 GiB     ct=\r\n/301/2025-11-01T06:43:36Z    =20\r\n302     supr-domain-controller       ok        27s        192.001 GiB    vm=\r\n/302/2025-11-01T06:49:49Z    =20\r\n303     tor-server                   ok        9s         16.001 GiB     vm=\r\n/303/2025-11-01T06:50:17Z    =20\r\n304     valheim-server               ok        3m 11s     55.001 GiB     vm=\r\n/304/2025-11-01T06:50:27Z    =20\r\n305     admin-workstation            ok        37s        64.001 GiB     vm=\r\n/305/2025-11-01T06:53:38Z    =20\r\n306     intec-work-pc                ok        3m 8s      500.004 GiB    vm=\r\n/306/2025-11-01T06:54:15Z    =20\r\n1000    ubuntu24-vm                  ok        48s        16.001 GiB     vm=\r\n/1000/2025-11-01T06:57:24Z   =20\r\n\r\nTotal running time: 28m 7s\r\nTotal size: 1.327 TiB\r\n\r\nLogs\r\n=3D=3D=3D=3D\r\nvzdump --mode snapshot --node PVESS01 --notes-template '{{guestname}}' --al=\r\nl 1 --quiet 1 --storage BACKUP-SERVER --fleecing 0\r\n\r\n\r\n100: 2025-11-01 02:30:05 INFO: Starting Backup of VM 100 (lxc)\r\n100: 2025-11-01 02:30:05 INFO: status =3D running\r\n100: 2025-11-01 02:30:05 INFO: CT Name: network.suprsolutions.com\r\n100: 2025-11-01 02:30:05 INFO: including mount point rootfs ('/') in backup\r\n100: 2025-11-01 02:30:05 INFO: backup mode: snapshot\r\n100: 2025-11-01 02:30:05 INFO: ionice priority: 7\r\n100: 2025-11-01 02:30:05 INFO: create storage snapshot 'vzdump'\r\n100: 2025-11-01 02:30:06 INFO: creating Proxmox Backup Server archiv	f	\N	\N	\N	\N	2025-11-03 01:47:15.138815+00
7501	alerts	49	alerts@suprsolutions.com	vzdump backup status (PVESS01.local): backup successful	126726	Return-Path: <alerts@suprsolutions.com>\r\nDelivered-To: alerts@suprsolutions.com\r\nReceived: from mail.suprsolutions.com ([172.22.1.253])\r\n\tby 6865e5e1852e with LMTP\r\n\tid APpFMw7KBmlHcAwAHEHyOw\r\n\t(envelope-from <alerts@suprsolutions.com>)\r\n\tfor <alerts@suprsolutions.com>; Sat, 01 Nov 2025 23:03:42 -0400\r\nX-Original-To: alerts@suprsolutions.com\r\nReceived: from [127.0.0.1] (localhost [127.0.0.1]) by localhost (Mailerdaemon) with ESMTPSA id 7931C102FC6\r\n\tfor <alerts@suprsolutions.com>; Sat,  1 Nov 2025 23:03:41 -0400 (EDT)\r\nDKIM-Signature: v=1; a=rsa-sha256; c=relaxed/relaxed; d=suprsolutions.com;\r\n\ts=dkim; t=1762052622; h=from:subject:date:to:mime-version:content-type;\r\n\tbh=Nm8LN+GDBaPaufgizlokg9pOITOJ/8ZdGSJx1KXXFII=;\r\n\tb=B0+6sSiRnEmL43dItOYxxuo1qFD//oUsZSmYGpVeYMf5Ff+1zYCXjLjoLmnhzJoXBWIdiE\r\n\tX7G2Oi0zfIT74gk4YZJkCrP95Q0+hZwNsVuAmV1QVw5SeT6hLLJLAIy0djMpAUaLvuqjj5\r\n\tJPCAtAkFSWGZR0KqRjSP7/PP46NfW2ldBO5p3hiWo35uRJsQq4dkFI+Z3hy8I8wTqq9qK8\r\n\tcW+WzENO8YVmGBC16eDoOSClGUg7w6Cp+Mc6VLg7QFIsGZqJzfIRQkzgtdWaVFZ0zNsC3q\r\n\tLpvjoHSVz4yKEPexydnXqdN7oZ4jswtPyoaI4tw8eoDhjzSZKyvUWSurWYCU8w==\r\nFrom: PVESS01 <alerts@suprsolutions.com>\r\nTo: alerts@suprsolutions.com\r\nSubject: vzdump backup status (PVESS01.local): backup successful \r\nMIME-Version: 1.0\r\nDate: Sun, 02 Nov 2025 03:03:40 +0000\r\nAuto-Submitted: auto-generated;\r\nContent-Type: multipart/alternative;\r\n boundary="EDcVFAnrwgck2Z0JlJEQoB1ZSAWIInYgr7LesxLq"\r\nX-Last-TLS-Session-Version: TLSv1.3\r\n\r\n--EDcVFAnrwgck2Z0JlJEQoB1ZSAWIInYgr7LesxLq\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n\r\nDetails\r\n=3D=3D=3D=3D=3D=3D=3D\r\nVMID    Name                         Status    Time       Size           Fi=\r\nlename                       =20\r\n100     network.suprsolutions.com    ok        21s        2.376 GiB      ct=\r\n/100/2025-11-02T02:30:11Z    =20\r\n101     cloud.suprsolutions.com      ok        1m 8s      4.686 GiB      ct=\r\n/101/2025-11-02T02:30:33Z    =20\r\n102     vaultwarden-server           ok        19s        2.067 GiB      ct=\r\n/102/2025-11-02T02:31:42Z    =20\r\n200     mail-server                  ok        22s        200.001 GiB    vm=\r\n/200/2025-11-02T02:32:01Z    =20\r\n201     tacticalrmm-server           ok        13s        32.001 GiB     vm=\r\n/201/2025-11-02T02:32:23Z    =20\r\n202     itflow-server                ok        13s        48 GiB         vm=\r\n/202/2025-11-02T02:32:36Z    =20\r\n300     home.suprcloud.io            ok        10m 45s    146.524 GiB    ct=\r\n/300/2025-11-02T02:32:49Z    =20\r\n301     intecit.suprcloud.io         ok        6m 6s      80.426 GiB     ct=\r\n/301/2025-11-02T02:43:34Z    =20\r\n302     supr-domain-controller       ok        1m 18s     192.001 GiB    vm=\r\n/302/2025-11-02T02:49:40Z    =20\r\n303     tor-server                   ok        19s        16.001 GiB     vm=\r\n/303/2025-11-02T02:50:58Z    =20\r\n304     valheim-server               ok        3m 6s      55.001 GiB     vm=\r\n/304/2025-11-02T02:51:18Z    =20\r\n305     admin-workstation            ok        3m 21s     64.001 GiB     vm=\r\n/305/2025-11-02T02:54:25Z    =20\r\n306     intec-work-pc                ok        5m 3s      500.004 GiB    vm=\r\n/306/2025-11-02T02:57:47Z    =20\r\n1000    ubuntu24-vm                  ok        50s        16.001 GiB     vm=\r\n/1000/2025-11-02T03:02:50Z   =20\r\n\r\nTotal running time: 33m 29s\r\nTotal size: 1.327 TiB\r\n\r\nLogs\r\n=3D=3D=3D=3D\r\nvzdump --fleecing 0 --quiet 1 --storage BACKUP-SERVER --notes-template '{{g=\r\nuestname}}' --node PVESS01 --mode snapshot --all 1\r\n\r\n\r\n100: 2025-11-01 22:30:11 INFO: Starting Backup of VM 100 (lxc)\r\n100: 2025-11-01 22:30:11 INFO: status =3D running\r\n100: 2025-11-01 22:30:11 INFO: CT Name: network.suprsolutions.com\r\n100: 2025-11-01 22:30:11 INFO: including mount point rootfs ('/') in backup\r\n100: 2025-11-01 22:30:11 INFO: backup mode: snapshot\r\n100: 2025-11-01 22:30:11 INFO: ionice priority: 7\r\n100: 2025-11-01 22:30:11 INFO: create storage snapshot 'vzdump'\r\n100: 2025-11-01 22:30:11 INFO: creating Proxmox Backup Server archi	f	\N	\N	\N	\N	2025-11-03 01:47:15.294273+00
7502	alerts	50	alerts@suprsolutions.com	vzdump backup status (PVESS01.local): backup successful	102479	Return-Path: <alerts@suprsolutions.com>\r\nDelivered-To: alerts@suprsolutions.com\r\nReceived: from mail.suprsolutions.com ([172.22.1.253])\r\n\tby 6865e5e1852e with LMTP\r\n\tid wPQ8GPYOB2kRogwAHEHyOw\r\n\t(envelope-from <alerts@suprsolutions.com>)\r\n\tfor <alerts@suprsolutions.com>; Sun, 02 Nov 2025 02:57:42 -0500\r\nX-Original-To: alerts@suprsolutions.com\r\nReceived: from [127.0.0.1] (localhost [127.0.0.1]) by localhost (Mailerdaemon) with ESMTPSA id 6AC6C102F9F\r\n\tfor <alerts@suprsolutions.com>; Sun,  2 Nov 2025 02:57:41 -0500 (EST)\r\nDKIM-Signature: v=1; a=rsa-sha256; c=relaxed/relaxed; d=suprsolutions.com;\r\n\ts=dkim; t=1762070262; h=from:subject:date:to:mime-version:content-type;\r\n\tbh=dgUoPGEgc+fTdUbQ8yRTdAl+sGvGkAKPIvLTeclfI7U=;\r\n\tb=RBZN5SDd985tM8pUjzPIzwc/nD089iNnRbSsBPQkZ1BohK1GP41LP4qbiBol0QjQjlHYfp\r\n\tAmQQXr/csunLVVSIlkZAR2dxUy6SB4YCuwr4KB3iY5LInrmPtoR1J3rtXTNThfUsfob30h\r\n\taK0tU3SKo+9qMuGIo9EnaSQ5XvodsopHW5DZAA5MmVvOl2a/FiKoUQzyVMbaRVeq7iG1//\r\n\t0LaofisgAq2aBBp+sDmOejM6vFzmtpb4H1kqsvdaDcgO7MAKevXAQch+Da2WiJOLwKiBiE\r\n\tvDv+5+S7rxYH3hufjIWX5Nz3AFABbWh0387cwcN0+aWSD5aInzMklJo6+kM6OQ==\r\nFrom: PVESS01 <alerts@suprsolutions.com>\r\nTo: alerts@suprsolutions.com\r\nSubject: vzdump backup status (PVESS01.local): backup successful \r\nMIME-Version: 1.0\r\nDate: Sun, 02 Nov 2025 07:57:40 +0000\r\nAuto-Submitted: auto-generated;\r\nContent-Type: multipart/alternative;\r\n boundary="LsUmlgc2uNDDNpU5tp51ZWAj5fc8eMM5H5OX9oF5"\r\nX-Last-TLS-Session-Version: TLSv1.3\r\n\r\n--LsUmlgc2uNDDNpU5tp51ZWAj5fc8eMM5H5OX9oF5\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n\r\nDetails\r\n=3D=3D=3D=3D=3D=3D=3D\r\nVMID    Name                         Status    Time       Size           Fi=\r\nlename                       =20\r\n100     network.suprsolutions.com    ok        21s        2.372 GiB      ct=\r\n/100/2025-11-02T07:30:14Z    =20\r\n101     cloud.suprsolutions.com      ok        1m 6s      4.687 GiB      ct=\r\n/101/2025-11-02T07:30:36Z    =20\r\n102     vaultwarden-server           ok        19s        2.065 GiB      ct=\r\n/102/2025-11-02T07:31:42Z    =20\r\n200     mail-server                  ok        12s        200.001 GiB    vm=\r\n/200/2025-11-02T07:32:02Z    =20\r\n201     tacticalrmm-server           ok        10s        32.001 GiB     vm=\r\n/201/2025-11-02T07:32:14Z    =20\r\n202     itflow-server                ok        4s         48 GiB         vm=\r\n/202/2025-11-02T07:32:24Z    =20\r\n300     home.suprcloud.io            ok        10m 43s    146.531 GiB    ct=\r\n/300/2025-11-02T07:32:29Z    =20\r\n301     intecit.suprcloud.io         ok        6m 7s      80.427 GiB     ct=\r\n/301/2025-11-02T07:43:12Z    =20\r\n302     supr-domain-controller       ok        28s        192.001 GiB    vm=\r\n/302/2025-11-02T07:49:20Z    =20\r\n303     tor-server                   ok        12s        16.001 GiB     vm=\r\n/303/2025-11-02T07:49:48Z    =20\r\n304     valheim-server               ok        3m 7s      55.001 GiB     vm=\r\n/304/2025-11-02T07:50:00Z    =20\r\n305     admin-workstation            ok        40s        64.001 GiB     vm=\r\n/305/2025-11-02T07:53:08Z    =20\r\n306     intec-work-pc                ok        3m 4s      500.004 GiB    vm=\r\n/306/2025-11-02T07:53:49Z    =20\r\n1000    ubuntu24-vm                  ok        47s        16.001 GiB     vm=\r\n/1000/2025-11-02T07:56:53Z   =20\r\n\r\nTotal running time: 27m 26s\r\nTotal size: 1.327 TiB\r\n\r\nLogs\r\n=3D=3D=3D=3D\r\nvzdump --fleecing 0 --storage BACKUP-SERVER --quiet 1 --all 1 --node PVESS0=\r\n1 --mode snapshot --notes-template '{{guestname}}'\r\n\r\n\r\n100: 2025-11-02 02:30:14 INFO: Starting Backup of VM 100 (lxc)\r\n100: 2025-11-02 02:30:14 INFO: status =3D running\r\n100: 2025-11-02 02:30:14 INFO: CT Name: network.suprsolutions.com\r\n100: 2025-11-02 02:30:14 INFO: including mount point rootfs ('/') in backup\r\n100: 2025-11-02 02:30:14 INFO: backup mode: snapshot\r\n100: 2025-11-02 02:30:14 INFO: ionice priority: 7\r\n100: 2025-11-02 02:30:14 INFO: create storage snapshot 'vzdump'\r\n100: 2025-11-02 02:30:14 INFO: creating Proxmox Backup Server archi	f	\N	\N	\N	\N	2025-11-03 01:47:15.447152+00
7547	alerts	51	alerts@suprsolutions.com	vzdump backup status (PVESS01.local): backup successful	116934	Return-Path: <alerts@suprsolutions.com>\r\nDelivered-To: alerts@suprsolutions.com\r\nReceived: from mail.suprsolutions.com ([172.22.1.253])\r\n\tby 6865e5e1852e with LMTP\r\n\tid 8NCCGwwpCGmHiA0AHEHyOw\r\n\t(envelope-from <alerts@suprsolutions.com>)\r\n\tfor <alerts@suprsolutions.com>; Sun, 02 Nov 2025 23:01:16 -0500\r\nX-Original-To: alerts@suprsolutions.com\r\nReceived: from [127.0.0.1] (localhost [127.0.0.1]) by localhost (Mailerdaemon) with ESMTPSA id 6A190102F9F\r\n\tfor <alerts@suprsolutions.com>; Sun,  2 Nov 2025 23:01:15 -0500 (EST)\r\nDKIM-Signature: v=1; a=rsa-sha256; c=relaxed/relaxed; d=suprsolutions.com;\r\n\ts=dkim; t=1762142476; h=from:subject:date:to:mime-version:content-type;\r\n\tbh=7JmcGdCFmYZQAychncAmvmW9MjEkhTmytQVgF5PaxfM=;\r\n\tb=hgVP62ejb5rCB2nb5CEOqRYXfma1p7Vafh8oCmqkvb3cTUlG3rUZL3soWgz6jm8DxXDfg2\r\n\ttFDTxXE5IjvRllpqqQMpGYsAuw8gu7fe0ZKz7ujBmVLUihtEiJzXHZDaSBYYQsE0YYoZ92\r\n\tfBEjUJOiodzlaixoVKhjpBgFlOZRbI3949WWpuiDDzNs6HFaIHVpuxbWTGpiCjI5OxFyM4\r\n\tu31KlHdufSFFgJYdrNVitIqmEZXEWcMaejIHkc5FpzuGMEG5qQP9GtSpaTuQqckaxzEOLl\r\n\tFVIBKKLx+YkRAS89p3LBzSp90ylF1ctDZ337KMotvXEsUJOYTiuSgtln6CNy4g==\r\nFrom: PVESS01 <alerts@suprsolutions.com>\r\nTo: alerts@suprsolutions.com\r\nSubject: vzdump backup status (PVESS01.local): backup successful \r\nMIME-Version: 1.0\r\nDate: Mon, 03 Nov 2025 04:01:14 +0000\r\nAuto-Submitted: auto-generated;\r\nContent-Type: multipart/alternative;\r\n boundary="XOKeOC1jW0xD9VUGkGvZG7aWCcftgIEI2q0JpAQi"\r\nX-Last-TLS-Session-Version: TLSv1.3\r\n\r\n--XOKeOC1jW0xD9VUGkGvZG7aWCcftgIEI2q0JpAQi\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n\r\nDetails\r\n=3D=3D=3D=3D=3D=3D=3D\r\nVMID    Name                         Status    Time       Size           Fi=\r\nlename                       =20\r\n100     network.suprsolutions.com    ok        29s        2.376 GiB      ct=\r\n/100/2025-11-03T03:30:02Z    =20\r\n101     cloud.suprsolutions.com      ok        1m 10s     4.696 GiB      ct=\r\n/101/2025-11-03T03:30:31Z    =20\r\n102     vaultwarden-server           ok        20s        2.066 GiB      ct=\r\n/102/2025-11-03T03:31:41Z    =20\r\n200     mail-server                  ok        18s        200.001 GiB    vm=\r\n/200/2025-11-03T03:32:01Z    =20\r\n201     tacticalrmm-server           ok        10s        32.001 GiB     vm=\r\n/201/2025-11-03T03:32:19Z    =20\r\n202     itflow-server                ok        8s         48 GiB         vm=\r\n/202/2025-11-03T03:32:29Z    =20\r\n300     home.suprcloud.io            ok        10m 36s    146.564 GiB    ct=\r\n/300/2025-11-03T03:32:37Z    =20\r\n301     intecit.suprcloud.io         ok        6m 12s     80.428 GiB     ct=\r\n/301/2025-11-03T03:43:14Z    =20\r\n302     supr-domain-controller       ok        1m 15s     192.001 GiB    vm=\r\n/302/2025-11-03T03:49:26Z    =20\r\n303     tor-server                   ok        17s        16.001 GiB     vm=\r\n/303/2025-11-03T03:50:41Z    =20\r\n304     valheim-server               ok        3m 7s      55.001 GiB     vm=\r\n/304/2025-11-03T03:50:59Z    =20\r\n305     admin-workstation            ok        2m 27s     64.001 GiB     vm=\r\n/305/2025-11-03T03:54:07Z    =20\r\n306     intec-work-pc                ok        3m 53s     500.004 GiB    vm=\r\n/306/2025-11-03T03:56:34Z    =20\r\n1000    ubuntu24-vm                  ok        47s        16.001 GiB     vm=\r\n/1000/2025-11-03T04:00:27Z   =20\r\n\r\nTotal running time: 31m 12s\r\nTotal size: 1.327 TiB\r\n\r\nLogs\r\n=3D=3D=3D=3D\r\nvzdump --fleecing 0 --quiet 1 --storage BACKUP-SERVER --all 1 --node PVESS0=\r\n1 --mode snapshot --notes-template '{{guestname}}'\r\n\r\n\r\n100: 2025-11-02 22:30:02 INFO: Starting Backup of VM 100 (lxc)\r\n100: 2025-11-02 22:30:02 INFO: status =3D running\r\n100: 2025-11-02 22:30:02 INFO: CT Name: network.suprsolutions.com\r\n100: 2025-11-02 22:30:02 INFO: including mount point rootfs ('/') in backup\r\n100: 2025-11-02 22:30:02 INFO: backup mode: snapshot\r\n100: 2025-11-02 22:30:02 INFO: ionice priority: 7\r\n100: 2025-11-02 22:30:02 INFO: create storage snapshot 'vzdump'\r\n100: 2025-11-02 22:30:03 INFO: creating Proxmox Backup Server archi	f	\N	\N	\N	\N	2025-11-03 04:03:01.45159+00
7960	alerts	52	alerts@suprsolutions.com	vzdump backup status (PVESS01.local): backup successful	98883	Return-Path: <alerts@suprsolutions.com>\r\nDelivered-To: alerts@suprsolutions.com\r\nReceived: from mail.suprsolutions.com ([172.22.1.253])\r\n\tby 6865e5e1852e with LMTP\r\n\tid aCxhKERgCGmhsQ0AHEHyOw\r\n\t(envelope-from <alerts@suprsolutions.com>)\r\n\tfor <alerts@suprsolutions.com>; Mon, 03 Nov 2025 02:56:52 -0500\r\nX-Original-To: alerts@suprsolutions.com\r\nReceived: from [127.0.0.1] (localhost [127.0.0.1]) by localhost (Mailerdaemon) with ESMTPSA id A08DD102FDD\r\n\tfor <alerts@suprsolutions.com>; Mon,  3 Nov 2025 02:56:51 -0500 (EST)\r\nDKIM-Signature: v=1; a=rsa-sha256; c=relaxed/relaxed; d=suprsolutions.com;\r\n\ts=dkim; t=1762156612; h=from:subject:date:to:mime-version:content-type;\r\n\tbh=0/DqRYpISFnHCqBbn/mJQBoshd7N26MHy33HtPCGHNk=;\r\n\tb=Iruu1EWYAt0mB5c3tRWyaR2EFr/sGJNVeXhhVfN0pmpzmAALVVpcn/6lTA83xhRA9vqrZD\r\n\t5QKSjMRQJ9qSE3OMpd+j257bFD6vRKF58Tx/N7tnIsPeXQ1egLp/+BNp1xsDDvCa6Dk/ZU\r\n\thPuJWH8cf51JchUTz65bxzI72UhCIm0H/vdHxyNEF8ljK+c4t6/BYvv7LvKjGio3zZLTS6\r\n\tOQ+dIltX0aTqDQ1CuDEl7kRUrXByZjr21Zux46Ann6/EwHS1ID5VRryXwSPsXNugNFeRXY\r\n\t0mFjGU+ee0MkeX1Hg46K8yXObNJGPej0xjkrmVI0w+ofk3+lPfo5T4B1gm1b7A==\r\nFrom: PVESS01 <alerts@suprsolutions.com>\r\nTo: alerts@suprsolutions.com\r\nSubject: vzdump backup status (PVESS01.local): backup successful \r\nMIME-Version: 1.0\r\nDate: Mon, 03 Nov 2025 07:56:50 +0000\r\nAuto-Submitted: auto-generated;\r\nContent-Type: multipart/alternative;\r\n boundary="4ZEHTPxkPy9Eye7cizlx1UcJUUjUXvxT0Izaroq8"\r\nX-Last-TLS-Session-Version: TLSv1.3\r\n\r\n--4ZEHTPxkPy9Eye7cizlx1UcJUUjUXvxT0Izaroq8\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n\r\nDetails\r\n=3D=3D=3D=3D=3D=3D=3D\r\nVMID    Name                         Status    Time       Size           Fi=\r\nlename                       =20\r\n100     network.suprsolutions.com    ok        22s        2.371 GiB      ct=\r\n/100/2025-11-03T07:30:04Z    =20\r\n101     cloud.suprsolutions.com      ok        1m 6s      4.696 GiB      ct=\r\n/101/2025-11-03T07:30:27Z    =20\r\n102     vaultwarden-server           ok        19s        2.066 GiB      ct=\r\n/102/2025-11-03T07:31:33Z    =20\r\n200     mail-server                  ok        7s         200.001 GiB    vm=\r\n/200/2025-11-03T07:31:53Z    =20\r\n201     tacticalrmm-server           ok        7s         32.001 GiB     vm=\r\n/201/2025-11-03T07:32:01Z    =20\r\n202     itflow-server                ok        5s         48 GiB         vm=\r\n/202/2025-11-03T07:32:08Z    =20\r\n300     home.suprcloud.io            ok        10m 35s    146.569 GiB    ct=\r\n/300/2025-11-03T07:32:13Z    =20\r\n301     intecit.suprcloud.io         ok        6m 11s     80.429 GiB     ct=\r\n/301/2025-11-03T07:42:49Z    =20\r\n302     supr-domain-controller       ok        22s        192.001 GiB    vm=\r\n/302/2025-11-03T07:49:00Z    =20\r\n303     tor-server                   ok        12s        16.001 GiB     vm=\r\n/303/2025-11-03T07:49:22Z    =20\r\n304     valheim-server               ok        3m 8s      55.001 GiB     vm=\r\n/304/2025-11-03T07:49:34Z    =20\r\n305     admin-workstation            ok        50s        64.001 GiB     vm=\r\n/305/2025-11-03T07:52:43Z    =20\r\n306     intec-work-pc                ok        2m 28s     500.004 GiB    vm=\r\n/306/2025-11-03T07:53:34Z    =20\r\n1000    ubuntu24-vm                  ok        48s        16.001 GiB     vm=\r\n/1000/2025-11-03T07:56:02Z   =20\r\n\r\nTotal running time: 26m 46s\r\nTotal size: 1.327 TiB\r\n\r\nLogs\r\n=3D=3D=3D=3D\r\nvzdump --all 1 --notes-template '{{guestname}}' --node PVESS01 --mode snaps=\r\nhot --fleecing 0 --quiet 1 --storage BACKUP-SERVER\r\n\r\n\r\n100: 2025-11-03 02:30:04 INFO: Starting Backup of VM 100 (lxc)\r\n100: 2025-11-03 02:30:04 INFO: status =3D running\r\n100: 2025-11-03 02:30:04 INFO: CT Name: network.suprsolutions.com\r\n100: 2025-11-03 02:30:04 INFO: including mount point rootfs ('/') in backup\r\n100: 2025-11-03 02:30:04 INFO: backup mode: snapshot\r\n100: 2025-11-03 02:30:04 INFO: ionice priority: 7\r\n100: 2025-11-03 02:30:04 INFO: create storage snapshot 'vzdump'\r\n100: 2025-11-03 02:30:05 INFO: creating Proxmox Backup Server archi	f	\N	\N	\N	\N	2025-11-03 07:57:01.64121+00
10089	alerts	53	alerts@suprsolutions.com	vzdump backup status (PVESS01.local): backup successful	129615	Return-Path: <alerts@suprsolutions.com>\r\nDelivered-To: alerts@suprsolutions.com\r\nReceived: from mail.suprsolutions.com ([172.22.1.253])\r\n\tby 6865e5e1852e with LMTP\r\n\tid OI38JBZ7CWl3mg4AHEHyOw\r\n\t(envelope-from <alerts@suprsolutions.com>)\r\n\tfor <alerts@suprsolutions.com>; Mon, 03 Nov 2025 23:03:34 -0500\r\nX-Original-To: alerts@suprsolutions.com\r\nReceived: from [127.0.0.1] (localhost [127.0.0.1]) by localhost (Mailerdaemon) with ESMTPSA id 7C478102FCE\r\n\tfor <alerts@suprsolutions.com>; Mon,  3 Nov 2025 23:03:33 -0500 (EST)\r\nDKIM-Signature: v=1; a=rsa-sha256; c=relaxed/relaxed; d=suprsolutions.com;\r\n\ts=dkim; t=1762229014; h=from:subject:date:to:mime-version:content-type;\r\n\tbh=7GgsuPOfJRZOTU7ZFUyG66COlOpU0Lj+lAU34NEu0eM=;\r\n\tb=Mm1mkTy9aYSs7jD51ZzAPGmNc2vxTHLt/QSZh5b0FnjoWu4QKdy+4qtSBYuTgKFFlBPlFf\r\n\tJfdWB/ie8F6Jr+DszRfxc/0rj1pINawh+jpYiv1H6HEq65HR/yolJHUW3ECAGw46UYV1xV\r\n\ttzxa+VQMzz5sI5sCSZuNzRUagoUv3BR/RshE/SL2iBbyBISQdAlT5YgTNwHRZgGiWrla++\r\n\tKlteOPkoVdtUaVDRBpVF2rC+GPq5SYRokk4jzCbaFxn7itsF4fD1IZoEWqaGdEDs04q8Ei\r\n\tbRVRfQ2YkcXMgwc8k2YTfX0BNmEyw2TxtnSLH3I6lfc89iiakA3YSwE7lLz9Ow==\r\nFrom: PVESS01 <alerts@suprsolutions.com>\r\nTo: alerts@suprsolutions.com\r\nSubject: vzdump backup status (PVESS01.local): backup successful \r\nMIME-Version: 1.0\r\nDate: Tue, 04 Nov 2025 04:03:32 +0000\r\nAuto-Submitted: auto-generated;\r\nContent-Type: multipart/alternative;\r\n boundary="YYfjXNiQD7qLAh9SOF05zjZbDUsK9IZB9sHXEwig"\r\nX-Last-TLS-Session-Version: TLSv1.3\r\n\r\n--YYfjXNiQD7qLAh9SOF05zjZbDUsK9IZB9sHXEwig\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n\r\nDetails\r\n=3D=3D=3D=3D=3D=3D=3D\r\nVMID    Name                         Status    Time       Size           Fi=\r\nlename                       =20\r\n100     network.suprsolutions.com    ok        22s        2.366 GiB      ct=\r\n/100/2025-11-04T03:30:08Z    =20\r\n101     cloud.suprsolutions.com      ok        1m 8s      4.704 GiB      ct=\r\n/101/2025-11-04T03:30:30Z    =20\r\n102     vaultwarden-server           ok        20s        2.066 GiB      ct=\r\n/102/2025-11-04T03:31:39Z    =20\r\n200     mail-server                  ok        26s        200.001 GiB    vm=\r\n/200/2025-11-04T03:31:59Z    =20\r\n201     tacticalrmm-server           ok        15s        32.001 GiB     vm=\r\n/201/2025-11-04T03:32:25Z    =20\r\n202     itflow-server                ok        7s         48 GiB         vm=\r\n/202/2025-11-04T03:32:41Z    =20\r\n300     home.suprcloud.io            ok        10m 39s    146.495 GiB    ct=\r\n/300/2025-11-04T03:32:49Z    =20\r\n301     intecit.suprcloud.io         ok        6m 15s     80.438 GiB     ct=\r\n/301/2025-11-04T03:43:29Z    =20\r\n302     supr-domain-controller       ok        1m 15s     192.001 GiB    vm=\r\n/302/2025-11-04T03:49:44Z    =20\r\n303     tor-server                   ok        28s        16.001 GiB     vm=\r\n/303/2025-11-04T03:50:59Z    =20\r\n304     valheim-server               ok        3m 8s      55.001 GiB     vm=\r\n/304/2025-11-04T03:51:27Z    =20\r\n305     admin-workstation            ok        2m 32s     64.001 GiB     vm=\r\n/305/2025-11-04T03:54:35Z    =20\r\n306     intec-work-pc                ok        5m 21s     500.004 GiB    vm=\r\n/306/2025-11-04T03:57:08Z    =20\r\n400     riq-web                      ok        14s        802.873 MiB    ct=\r\n/400/2025-11-04T04:02:30Z    =20\r\n1000    ubuntu24-vm                  ok        48s        16.001 GiB     vm=\r\n/1000/2025-11-04T04:02:44Z   =20\r\n\r\nTotal running time: 33m 24s\r\nTotal size: 1.328 TiB\r\n\r\nLogs\r\n=3D=3D=3D=3D\r\nvzdump --fleecing 0 --quiet 1 --storage BACKUP-SERVER --node PVESS01 --mode=\r\n snapshot --notes-template '{{guestname}}' --all 1\r\n\r\n\r\n100: 2025-11-03 22:30:08 INFO: Starting Backup of VM 100 (lxc)\r\n100: 2025-11-03 22:30:08 INFO: status =3D running\r\n100: 2025-11-03 22:30:08 INFO: CT Name: network.suprsolutions.com\r\n100: 2025-11-03 22:30:08 INFO: including mount point rootfs ('/') in backup\r\n100: 2025-11-03 22:30:08 INFO: backup mode: snapshot\r\n100: 2025-11-03 22:30:08 INFO: ionice priority: 7\r\n100: 2025-11-03 22:3	f	\N	\N	\N	\N	2025-11-04 04:06:01.446108+00
10498	alerts	54	alerts@suprsolutions.com	vzdump backup status (PVESS01.local): backup successful	108243	Return-Path: <alerts@suprsolutions.com>\r\nDelivered-To: alerts@suprsolutions.com\r\nReceived: from mail.suprsolutions.com ([172.22.1.253])\r\n\tby 6865e5e1852e with LMTP\r\n\tid ONdyMgeyCWkmyg4AHEHyOw\r\n\t(envelope-from <alerts@suprsolutions.com>)\r\n\tfor <alerts@suprsolutions.com>; Tue, 04 Nov 2025 02:57:59 -0500\r\nX-Original-To: alerts@suprsolutions.com\r\nReceived: from [127.0.0.1] (localhost [127.0.0.1]) by localhost (Mailerdaemon) with ESMTPSA id B1551102FC5\r\n\tfor <alerts@suprsolutions.com>; Tue,  4 Nov 2025 02:57:58 -0500 (EST)\r\nDKIM-Signature: v=1; a=rsa-sha256; c=relaxed/relaxed; d=suprsolutions.com;\r\n\ts=dkim; t=1762243079; h=from:subject:date:to:mime-version:content-type;\r\n\tbh=uhc51saIANo2DBoKgswGhPeCEr5OGD778LgVh4Xmsy0=;\r\n\tb=MycdYAsHiyHs2Oz17v5SY3zunjPRfk1nPdo0urkcDkaCQErMSSRI0TmDgmSuaZb01KYKmQ\r\n\tavhIxfHK3Y3V71ahHshoJ9y+yqlPrURtzSoROabvAepbnw9yYJKRAzo8COkrb69XiQlvCa\r\n\tNQC4aet/pXwwQCDPi2Kh88hB70OTDEU4L8cN9rE81vEfFPoHoMSJF4xmFjSHWJFgZvNAQH\r\n\tZV+oaoQOoxe2nzybIOQFUROUcjP5yLe92PdiMCy1bZFrpX68KErQMpcLV0Zk3EB61t+mNj\r\n\tZ+qbHD02w8AXTNNMO8a/+v8Jw2z4cCE+L421ikUIbYFzyR5totCe+Z3Ak2sBuw==\r\nFrom: PVESS01 <alerts@suprsolutions.com>\r\nTo: alerts@suprsolutions.com\r\nSubject: vzdump backup status (PVESS01.local): backup successful \r\nMIME-Version: 1.0\r\nDate: Tue, 04 Nov 2025 07:57:57 +0000\r\nAuto-Submitted: auto-generated;\r\nContent-Type: multipart/alternative;\r\n boundary="wwoW47Y6ByybmAjJiIpgoyLhhbNOdsBWNjwCfwgM"\r\nX-Last-TLS-Session-Version: TLSv1.3\r\n\r\n--wwoW47Y6ByybmAjJiIpgoyLhhbNOdsBWNjwCfwgM\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n\r\nDetails\r\n=3D=3D=3D=3D=3D=3D=3D\r\nVMID    Name                         Status    Time       Size           Fi=\r\nlename                       =20\r\n100     network.suprsolutions.com    ok        23s        2.371 GiB      ct=\r\n/100/2025-11-04T07:30:10Z    =20\r\n101     cloud.suprsolutions.com      ok        1m 6s      4.712 GiB      ct=\r\n/101/2025-11-04T07:30:33Z    =20\r\n102     vaultwarden-server           ok        19s        2.066 GiB      ct=\r\n/102/2025-11-04T07:31:40Z    =20\r\n200     mail-server                  ok        8s         200.001 GiB    vm=\r\n/200/2025-11-04T07:31:59Z    =20\r\n201     tacticalrmm-server           ok        13s        32.001 GiB     vm=\r\n/201/2025-11-04T07:32:07Z    =20\r\n202     itflow-server                ok        5s         48 GiB         vm=\r\n/202/2025-11-04T07:32:21Z    =20\r\n300     home.suprcloud.io            ok        10m 48s    146.509 GiB    ct=\r\n/300/2025-11-04T07:32:26Z    =20\r\n301     intecit.suprcloud.io         ok        6m 3s      80.439 GiB     ct=\r\n/301/2025-11-04T07:43:15Z    =20\r\n302     supr-domain-controller       ok        27s        192.001 GiB    vm=\r\n/302/2025-11-04T07:49:18Z    =20\r\n303     tor-server                   ok        31s        16.001 GiB     vm=\r\n/303/2025-11-04T07:49:45Z    =20\r\n304     valheim-server               ok        3m 9s      55.001 GiB     vm=\r\n/304/2025-11-04T07:50:16Z    =20\r\n305     admin-workstation            ok        33s        64.001 GiB     vm=\r\n/305/2025-11-04T07:53:25Z    =20\r\n306     intec-work-pc                ok        2m 59s     500.004 GiB    vm=\r\n/306/2025-11-04T07:53:59Z    =20\r\n400     riq-web                      ok        12s        803.089 MiB    ct=\r\n/400/2025-11-04T07:56:58Z    =20\r\n1000    ubuntu24-vm                  ok        47s        16.001 GiB     vm=\r\n/1000/2025-11-04T07:57:10Z   =20\r\n\r\nTotal running time: 27m 47s\r\nTotal size: 1.328 TiB\r\n\r\nLogs\r\n=3D=3D=3D=3D\r\nvzdump --all 1 --mode snapshot --node PVESS01 --notes-template '{{guestname=\r\n}}' --quiet 1 --storage BACKUP-SERVER --fleecing 0\r\n\r\n\r\n100: 2025-11-04 02:30:10 INFO: Starting Backup of VM 100 (lxc)\r\n100: 2025-11-04 02:30:10 INFO: status =3D running\r\n100: 2025-11-04 02:30:10 INFO: CT Name: network.suprsolutions.com\r\n100: 2025-11-04 02:30:10 INFO: including mount point rootfs ('/') in backup\r\n100: 2025-11-04 02:30:10 INFO: backup mode: snapshot\r\n100: 2025-11-04 02:30:10 INFO: ionice priority: 7\r\n100: 2025-11-04 02:3	f	\N	\N	\N	\N	2025-11-04 07:58:31.446701+00
12663	alerts	55	alerts@suprsolutions.com	vzdump backup status (PVESS01.local): backup successful	135009	Return-Path: <alerts@suprsolutions.com>\r\nDelivered-To: alerts@suprsolutions.com\r\nReceived: from mail.suprsolutions.com ([172.22.1.253])\r\n\tby 6865e5e1852e with LMTP\r\n\tid IFrqLCvRCmlPtA8AHEHyOw\r\n\t(envelope-from <alerts@suprsolutions.com>)\r\n\tfor <alerts@suprsolutions.com>; Tue, 04 Nov 2025 23:23:07 -0500\r\nX-Original-To: alerts@suprsolutions.com\r\nReceived: from [127.0.0.1] (localhost [127.0.0.1]) by localhost (Mailerdaemon) with ESMTPSA id 630DF102FD6\r\n\tfor <alerts@suprsolutions.com>; Tue,  4 Nov 2025 23:23:06 -0500 (EST)\r\nDKIM-Signature: v=1; a=rsa-sha256; c=relaxed/relaxed; d=suprsolutions.com;\r\n\ts=dkim; t=1762316586; h=from:subject:date:to:mime-version:content-type;\r\n\tbh=yPHTtTqzfIMVCelVeMcE8pwrXhBKQqQn47mzICx6wJ8=;\r\n\tb=UnNfhzeP0QeF+GYiLzHWoSgdFPzBBYYueg1SfqktXNdO1ndagJuIEBi6eBIrhGUgEHbFLu\r\n\tJ8wrJEn/0hhU30RDikzSvaIqnuiqMJHP3R71Iw/FUlQkpbswR1/6j+GOY4q8OadgnraQYA\r\n\tvluZVzPkFW9M9+N4SbkCkpROs4qWFS4F6PQbKi4phio59UDt2WZfWqe20tBAZ5EAXN/oQK\r\n\tFqGAYej4YnwfW+cRdSWwmm/xI3GvodKhDsfTHV5bU5FNJXsHbVso91ji6B5FxTUKPp5K68\r\n\tBRp6UjDXbYQxly/qbwV0es3Lr90aknwYB5acbctxmn4IFxa1EcstxV/RDXCwVQ==\r\nFrom: PVESS01 <alerts@suprsolutions.com>\r\nTo: alerts@suprsolutions.com\r\nSubject: vzdump backup status (PVESS01.local): backup successful \r\nMIME-Version: 1.0\r\nDate: Wed, 05 Nov 2025 04:23:05 +0000\r\nAuto-Submitted: auto-generated;\r\nContent-Type: multipart/alternative;\r\n boundary="h4OWyzVOuCPtVC7nBVXa5UPTyVuTYvzffpWVvKYW"\r\nX-Last-TLS-Session-Version: TLSv1.3\r\n\r\n--h4OWyzVOuCPtVC7nBVXa5UPTyVuTYvzffpWVvKYW\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n\r\nDetails\r\n=3D=3D=3D=3D=3D=3D=3D\r\nVMID    Name                         Status    Time       Size           Fi=\r\nlename                       =20\r\n100     network.suprsolutions.com    ok        23s        2.376 GiB      ct=\r\n/100/2025-11-05T03:30:01Z    =20\r\n101     cloud.suprsolutions.com      ok        1m 9s      4.714 GiB      ct=\r\n/101/2025-11-05T03:30:24Z    =20\r\n102     vaultwarden-server           ok        20s        2.067 GiB      ct=\r\n/102/2025-11-05T03:31:33Z    =20\r\n200     mail-server                  ok        38s        200.001 GiB    vm=\r\n/200/2025-11-05T03:31:54Z    =20\r\n201     tacticalrmm-server           ok        40s        32.001 GiB     vm=\r\n/201/2025-11-05T03:32:32Z    =20\r\n202     itflow-server                ok        12s        48 GiB         vm=\r\n/202/2025-11-05T03:33:13Z    =20\r\n300     home.suprcloud.io            ok        10m 56s    146.633 GiB    ct=\r\n/300/2025-11-05T03:33:26Z    =20\r\n301     intecit.suprcloud.io         ok        6m 15s     80.447 GiB     ct=\r\n/301/2025-11-05T03:44:22Z    =20\r\n302     supr-domain-controller       ok        1m 14s     192.001 GiB    vm=\r\n/302/2025-11-05T03:50:37Z    =20\r\n303     tor-server                   ok        43s        16.001 GiB     vm=\r\n/303/2025-11-05T03:51:52Z    =20\r\n304     valheim-server               ok        3m 9s      55.001 GiB     vm=\r\n/304/2025-11-05T03:52:35Z    =20\r\n305     admin-workstation            ok        2m 47s     64.001 GiB     vm=\r\n/305/2025-11-05T03:55:44Z    =20\r\n306     intec-work-pc                ok        23m 35s    500.004 GiB    vm=\r\n/306/2025-11-05T03:58:31Z    =20\r\n400     riq-web                      ok        12s        805.462 MiB    ct=\r\n/400/2025-11-05T04:22:07Z    =20\r\n1000    ubuntu24-vm                  ok        46s        16.001 GiB     vm=\r\n/1000/2025-11-05T04:22:19Z   =20\r\n\r\nTotal running time: 53m 4s\r\nTotal size: 1.328 TiB\r\n\r\nLogs\r\n=3D=3D=3D=3D\r\nvzdump --fleecing 0 --quiet 1 --storage BACKUP-SERVER --all 1 --notes-templ=\r\nate '{{guestname}}' --node PVESS01 --mode snapshot\r\n\r\n\r\n100: 2025-11-04 22:30:01 INFO: Starting Backup of VM 100 (lxc)\r\n100: 2025-11-04 22:30:01 INFO: status =3D running\r\n100: 2025-11-04 22:30:01 INFO: CT Name: network.suprsolutions.com\r\n100: 2025-11-04 22:30:01 INFO: including mount point rootfs ('/') in backup\r\n100: 2025-11-04 22:30:01 INFO: backup mode: snapshot\r\n100: 2025-11-04 22:30:01 INFO: ionice priority: 7\r\n100: 2025-11-04 22:30	f	\N	\N	\N	\N	2025-11-05 04:25:01.641823+00
12756	alerts	56	alerts@suprsolutions.com	vzdump backup status (PVESS01.local): backup successful	105181	Return-Path: <alerts@suprsolutions.com>\r\nDelivered-To: alerts@suprsolutions.com\r\nReceived: from mail.suprsolutions.com ([172.22.1.253])\r\n\tby 6865e5e1852e with LMTP\r\n\tid YJNYE3kDC2mv1w8AHEHyOw\r\n\t(envelope-from <alerts@suprsolutions.com>)\r\n\tfor <alerts@suprsolutions.com>; Wed, 05 Nov 2025 02:57:45 -0500\r\nX-Original-To: alerts@suprsolutions.com\r\nReceived: from [127.0.0.1] (localhost [127.0.0.1]) by localhost (Mailerdaemon) with ESMTPSA id 5B82E102F9F\r\n\tfor <alerts@suprsolutions.com>; Wed,  5 Nov 2025 02:57:44 -0500 (EST)\r\nDKIM-Signature: v=1; a=rsa-sha256; c=relaxed/relaxed; d=suprsolutions.com;\r\n\ts=dkim; t=1762329464; h=from:subject:date:to:mime-version:content-type;\r\n\tbh=T8kgKiT8/YBoAR6JXMT2l/HChnyEUyAZNGForp1K6sU=;\r\n\tb=bYJ4GUWRhpb775ekq/RkhJ4PlMARMYLb7SeDOvyUs2L8e4LqonUD4stWnX91j6QfkE6eyu\r\n\tkmQrPBh8mhYElsW6+9kEjfHgmADFQGPdHBMS5tSHlJr8RwhIKIu8euzTPr0lC6ohjWXs5v\r\n\t9OaKaKp0O0nM/LYRAJigpk24LnXuGCNOQ2ESnFJgh5jmWuGAVMe11sg41lwDU93mPuLNm/\r\n\t1k7jPAhl0ElL7EhoPtkWXEEjCBpVgghNtid2Gz75r9oOZWffxPliUamiy0m4AxSSuSxX0U\r\n\tnsdrzqPAXh0sGUy0XUBC/HOV2lb9/hrdfDGD4pczT2e5yPRzOohEAsdPjggtXw==\r\nFrom: PVESS01 <alerts@suprsolutions.com>\r\nTo: alerts@suprsolutions.com\r\nSubject: vzdump backup status (PVESS01.local): backup successful \r\nMIME-Version: 1.0\r\nDate: Wed, 05 Nov 2025 07:57:43 +0000\r\nAuto-Submitted: auto-generated;\r\nContent-Type: multipart/alternative;\r\n boundary="ze4ay7BY67fxu59v76ykSwzSur4bzXBQEbprIlYj"\r\nX-Last-TLS-Session-Version: TLSv1.3\r\n\r\n--ze4ay7BY67fxu59v76ykSwzSur4bzXBQEbprIlYj\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n\r\nDetails\r\n=3D=3D=3D=3D=3D=3D=3D\r\nVMID    Name                         Status    Time       Size           Fi=\r\nlename                       =20\r\n100     network.suprsolutions.com    ok        22s        2.371 GiB      ct=\r\n/100/2025-11-05T07:30:06Z    =20\r\n101     cloud.suprsolutions.com      ok        1m 10s     4.722 GiB      ct=\r\n/101/2025-11-05T07:30:28Z    =20\r\n102     vaultwarden-server           ok        20s        2.066 GiB      ct=\r\n/102/2025-11-05T07:31:38Z    =20\r\n200     mail-server                  ok        9s         200.001 GiB    vm=\r\n/200/2025-11-05T07:31:58Z    =20\r\n201     tacticalrmm-server           ok        8s         32.001 GiB     vm=\r\n/201/2025-11-05T07:32:07Z    =20\r\n202     itflow-server                ok        6s         48 GiB         vm=\r\n/202/2025-11-05T07:32:15Z    =20\r\n300     home.suprcloud.io            ok        10m 43s    146.639 GiB    ct=\r\n/300/2025-11-05T07:32:21Z    =20\r\n301     intecit.suprcloud.io         ok        6m 2s      80.448 GiB     ct=\r\n/301/2025-11-05T07:43:05Z    =20\r\n302     supr-domain-controller       ok        28s        192.001 GiB    vm=\r\n/302/2025-11-05T07:49:07Z    =20\r\n303     tor-server                   ok        24s        16.001 GiB     vm=\r\n/303/2025-11-05T07:49:35Z    =20\r\n304     valheim-server               ok        3m 8s      55.001 GiB     vm=\r\n/304/2025-11-05T07:50:00Z    =20\r\n305     admin-workstation            ok        40s        64.001 GiB     vm=\r\n/305/2025-11-05T07:53:08Z    =20\r\n306     intec-work-pc                ok        2m 18s     500.004 GiB    vm=\r\n/306/2025-11-05T07:53:48Z    =20\r\n400     riq-web                      ok        48s        4.209 GiB      ct=\r\n/400/2025-11-05T07:56:07Z    =20\r\n1000    ubuntu24-vm                  ok        47s        16.001 GiB     vm=\r\n/1000/2025-11-05T07:56:56Z   =20\r\n\r\nTotal running time: 27m 37s\r\nTotal size: 1.332 TiB\r\n\r\nLogs\r\n=3D=3D=3D=3D\r\nvzdump --all 1 --mode snapshot --node PVESS01 --notes-template '{{guestname=\r\n}}' --quiet 1 --storage BACKUP-SERVER --fleecing 0\r\n\r\n\r\n100: 2025-11-05 02:30:06 INFO: Starting Backup of VM 100 (lxc)\r\n100: 2025-11-05 02:30:06 INFO: status =3D running\r\n100: 2025-11-05 02:30:06 INFO: CT Name: network.suprsolutions.com\r\n100: 2025-11-05 02:30:06 INFO: including mount point rootfs ('/') in backup\r\n100: 2025-11-05 02:30:06 INFO: backup mode: snapshot\r\n100: 2025-11-05 02:30:06 INFO: ionice priority: 7\r\n100: 2025-11-05 02:3	f	\N	\N	\N	\N	2025-11-05 17:15:38.202353+00
12989	alerts	57	alerts@suprsolutions.com	vzdump backup status (PVESS01.local): backup successful	128828	Return-Path: <alerts@suprsolutions.com>\r\nDelivered-To: alerts@suprsolutions.com\r\nReceived: from mail.suprsolutions.com ([172.22.1.253])\r\n\tby 6865e5e1852e with LMTP\r\n\tid WGtdEfQdDGmMwBAAHEHyOw\r\n\t(envelope-from <alerts@suprsolutions.com>)\r\n\tfor <alerts@suprsolutions.com>; Wed, 05 Nov 2025 23:03:00 -0500\r\nX-Original-To: alerts@suprsolutions.com\r\nReceived: from [127.0.0.1] (localhost [127.0.0.1]) by localhost (Mailerdaemon) with ESMTPSA id 477E9102FDA\r\n\tfor <alerts@suprsolutions.com>; Wed,  5 Nov 2025 23:02:59 -0500 (EST)\r\nDKIM-Signature: v=1; a=rsa-sha256; c=relaxed/relaxed; d=suprsolutions.com;\r\n\ts=dkim; t=1762401779; h=from:subject:date:to:mime-version:content-type;\r\n\tbh=BV18YApze5J65N+Qld7v7FSREYqaEBZPU7BjP2JnaSM=;\r\n\tb=CUqdBQB5Uk4q1HPgCmjK85TZEFi1x7NaO06Msr0HhPCreftQ429WxHDkgDebVdfgXrsRAj\r\n\t8NZO8o6e9hr2MrkShuRDrQpx/8wGmsevC6nRnr30cBihfGdduD10la1yugF/FIXPWiu1V1\r\n\t6rCerEaTF5KIQjIWbLJhwn1wXzxpCjVYAx5U8TUKF1KTr3UwYrf7/qwqsENnZNG3T2cELE\r\n\tyONft6YNLIswKLDlZC0tteUKYBQLF0YIBT3RhBRd5e5f2TmO2CuQfwe3M81RHaav32VAgo\r\n\t75VvkYXWPdTi4M7PIXfoabFRjMfeUSQtIs8JRJVSjoC5M6NoLpmdKtJbl/OTRw==\r\nFrom: PVESS01 <alerts@suprsolutions.com>\r\nTo: alerts@suprsolutions.com\r\nSubject: vzdump backup status (PVESS01.local): backup successful \r\nMIME-Version: 1.0\r\nDate: Thu, 06 Nov 2025 04:02:58 +0000\r\nAuto-Submitted: auto-generated;\r\nContent-Type: multipart/alternative;\r\n boundary="DbFhGRrZa6siq2Kg9JYiXr5G6LuYSwauIewNnA9D"\r\nX-Last-TLS-Session-Version: TLSv1.3\r\n\r\n--DbFhGRrZa6siq2Kg9JYiXr5G6LuYSwauIewNnA9D\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n\r\nDetails\r\n=3D=3D=3D=3D=3D=3D=3D\r\nVMID    Name                         Status    Time       Size           Fi=\r\nlename                       =20\r\n100     network.suprsolutions.com    ok        22s        2.375 GiB      ct=\r\n/100/2025-11-06T03:30:05Z    =20\r\n101     cloud.suprsolutions.com      ok        1m 9s      4.807 GiB      ct=\r\n/101/2025-11-06T03:30:27Z    =20\r\n102     vaultwarden-server           ok        20s        2.067 GiB      ct=\r\n/102/2025-11-06T03:31:37Z    =20\r\n200     mail-server                  ok        24s        200.001 GiB    vm=\r\n/200/2025-11-06T03:31:57Z    =20\r\n201     tacticalrmm-server           ok        13s        32.001 GiB     vm=\r\n/201/2025-11-06T03:32:22Z    =20\r\n202     itflow-server                ok        11s        48 GiB         vm=\r\n/202/2025-11-06T03:32:35Z    =20\r\n300     home.suprcloud.io            ok        10m 18s    146.671 GiB    ct=\r\n/300/2025-11-06T03:32:46Z    =20\r\n301     intecit.suprcloud.io         ok        5m 51s     80.457 GiB     ct=\r\n/301/2025-11-06T03:43:04Z    =20\r\n302     supr-domain-controller       ok        1m 25s     192.001 GiB    vm=\r\n/302/2025-11-06T03:48:56Z    =20\r\n303     tor-server                   ok        29s        16.001 GiB     vm=\r\n/303/2025-11-06T03:50:21Z    =20\r\n304     valheim-server               ok        3m 8s      55.001 GiB     vm=\r\n/304/2025-11-06T03:50:51Z    =20\r\n305     admin-workstation            ok        2m 34s     64.001 GiB     vm=\r\n/305/2025-11-06T03:53:59Z    =20\r\n306     intec-work-pc                ok        4m 37s     500.004 GiB    vm=\r\n/306/2025-11-06T03:56:34Z    =20\r\n400     riq-web                      ok        58s        4.874 GiB      ct=\r\n/400/2025-11-06T04:01:11Z    =20\r\n1000    ubuntu24-vm                  ok        47s        16.001 GiB     vm=\r\n/1000/2025-11-06T04:02:10Z   =20\r\n\r\nTotal running time: 32m 53s\r\nTotal size: 1.332 TiB\r\n\r\nLogs\r\n=3D=3D=3D=3D\r\nvzdump --fleecing 0 --quiet 1 --storage BACKUP-SERVER --all 1 --node PVESS0=\r\n1 --mode snapshot --notes-template '{{guestname}}'\r\n\r\n\r\n100: 2025-11-05 22:30:05 INFO: Starting Backup of VM 100 (lxc)\r\n100: 2025-11-05 22:30:05 INFO: status =3D running\r\n100: 2025-11-05 22:30:05 INFO: CT Name: network.suprsolutions.com\r\n100: 2025-11-05 22:30:05 INFO: including mount point rootfs ('/') in backup\r\n100: 2025-11-05 22:30:05 INFO: backup mode: snapshot\r\n100: 2025-11-05 22:30:05 INFO: ionice priority: 7\r\n100: 2025-11-05 22:3	f	\N	\N	\N	\N	2025-11-06 04:05:00.846339+00
13099	alerts	58	alerts@suprsolutions.com	vzdump backup status (PVESS01.local): backup successful	106712	Return-Path: <alerts@suprsolutions.com>\r\nDelivered-To: alerts@suprsolutions.com\r\nReceived: from mail.suprsolutions.com ([172.22.1.253])\r\n\tby 6865e5e1852e with LMTP\r\n\tid ENddOC9VDGlG9BAAHEHyOw\r\n\t(envelope-from <alerts@suprsolutions.com>)\r\n\tfor <alerts@suprsolutions.com>; Thu, 06 Nov 2025 02:58:39 -0500\r\nX-Original-To: alerts@suprsolutions.com\r\nReceived: from [127.0.0.1] (localhost [127.0.0.1]) by localhost (Mailerdaemon) with ESMTPSA id DA5A9102FC6\r\n\tfor <alerts@suprsolutions.com>; Thu,  6 Nov 2025 02:58:38 -0500 (EST)\r\nDKIM-Signature: v=1; a=rsa-sha256; c=relaxed/relaxed; d=suprsolutions.com;\r\n\ts=dkim; t=1762415919; h=from:subject:date:to:mime-version:content-type;\r\n\tbh=VGfbmscyd9Y5NHmto9FkgVCJS8st71lu5fH5q8Y1CbI=;\r\n\tb=VavRrv+C7JAGriWqEkoC/+8O/eQ2ucj5Ku8LPaCxDsC80ozSzykUTV0bDOqr8MVXAgxklZ\r\n\t1OGb9OU/f+weKvb1rBOa/+SVfibAfUelTHZ3Ti69Kuj84woiFALliqv8MP2NSzTs+jmCTa\r\n\t/DfcAQfvvJCAVQpzAAroOGY1sapPeTK3b1y96wdqhKY/YAPo/C/0ocL3QQhIpTSAhnwCwN\r\n\tG42Ju5fBA3vqn66LXOkMN1G33WzTOciR4YQzu7Olg2yfQ/yuiP9ZX/iTU/OE7EY2i6/O0r\r\n\tH4KiPnWx3sK0FHPFR7CqyTYfJecN8u8A+ldHlHFnd5jxIOtb9r0B0MEC7/M9uw==\r\nFrom: PVESS01 <alerts@suprsolutions.com>\r\nTo: alerts@suprsolutions.com\r\nSubject: vzdump backup status (PVESS01.local): backup successful \r\nMIME-Version: 1.0\r\nDate: Thu, 06 Nov 2025 07:58:37 +0000\r\nAuto-Submitted: auto-generated;\r\nContent-Type: multipart/alternative;\r\n boundary="qDvt7b6iCQBi4xRxgyXLAKvyMzkhoptezrsQPm2D"\r\nX-Last-TLS-Session-Version: TLSv1.3\r\n\r\n--qDvt7b6iCQBi4xRxgyXLAKvyMzkhoptezrsQPm2D\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n\r\nDetails\r\n=3D=3D=3D=3D=3D=3D=3D\r\nVMID    Name                         Status    Time       Size           Fi=\r\nlename                       =20\r\n100     network.suprsolutions.com    ok        25s        2.332 GiB      ct=\r\n/100/2025-11-06T07:30:08Z    =20\r\n101     cloud.suprsolutions.com      ok        1m 8s      4.807 GiB      ct=\r\n/101/2025-11-06T07:30:33Z    =20\r\n102     vaultwarden-server           ok        20s        2.066 GiB      ct=\r\n/102/2025-11-06T07:31:41Z    =20\r\n200     mail-server                  ok        9s         200.001 GiB    vm=\r\n/200/2025-11-06T07:32:01Z    =20\r\n201     tacticalrmm-server           ok        11s        32.001 GiB     vm=\r\n/201/2025-11-06T07:32:11Z    =20\r\n202     itflow-server                ok        7s         48 GiB         vm=\r\n/202/2025-11-06T07:32:23Z    =20\r\n300     home.suprcloud.io            ok        10m 54s    146.677 GiB    ct=\r\n/300/2025-11-06T07:32:31Z    =20\r\n301     intecit.suprcloud.io         ok        6m 2s      80.458 GiB     ct=\r\n/301/2025-11-06T07:43:25Z    =20\r\n302     supr-domain-controller       ok        29s        192.001 GiB    vm=\r\n/302/2025-11-06T07:49:27Z    =20\r\n303     tor-server                   ok        24s        16.001 GiB     vm=\r\n/303/2025-11-06T07:49:56Z    =20\r\n304     valheim-server               ok        3m 15s     55.001 GiB     vm=\r\n/304/2025-11-06T07:50:20Z    =20\r\n305     admin-workstation            ok        1m 16s     64.001 GiB     vm=\r\n/305/2025-11-06T07:53:35Z    =20\r\n306     intec-work-pc                ok        2m 2s      500.004 GiB    vm=\r\n/306/2025-11-06T07:54:51Z    =20\r\n400     riq-web                      ok        57s        4.874 GiB      ct=\r\n/400/2025-11-06T07:56:53Z    =20\r\n1000    ubuntu24-vm                  ok        47s        16.001 GiB     vm=\r\n/1000/2025-11-06T07:57:50Z   =20\r\n\r\nTotal running time: 28m 29s\r\nTotal size: 1.332 TiB\r\n\r\nLogs\r\n=3D=3D=3D=3D\r\nvzdump --fleecing 0 --storage BACKUP-SERVER --quiet 1 --notes-template '{{g=\r\nuestname}}' --node PVESS01 --mode snapshot --all 1\r\n\r\n\r\n100: 2025-11-06 02:30:08 INFO: Starting Backup of VM 100 (lxc)\r\n100: 2025-11-06 02:30:08 INFO: status =3D running\r\n100: 2025-11-06 02:30:08 INFO: CT Name: network.suprsolutions.com\r\n100: 2025-11-06 02:30:08 INFO: including mount point rootfs ('/') in backup\r\n100: 2025-11-06 02:30:08 INFO: backup mode: snapshot\r\n100: 2025-11-06 02:30:08 INFO: ionice priority: 7\r\n100: 2025-11-06 02:3	f	\N	\N	\N	\N	2025-11-06 07:59:00.957237+00
\.


--
-- Data for Name: imap_state; Type: TABLE DATA; Schema: public; Owner: remoteiq
--

COPY public.imap_state (purpose, last_uid, updated_at) FROM stdin;
alerts	0	2025-10-20 23:02:29.962912+00
\.


--
-- Data for Name: job_results; Type: TABLE DATA; Schema: public; Owner: remoteiq
--

COPY public.job_results (job_id, exit_code, stdout, stderr, duration_ms) FROM stdin;
b011b61d-f203-446b-be7c-4e7bbd1232cf	0	Uninstalling 'AnyDesk' (wanted version 'ad 9.0.9')\r\n		649
\.


--
-- Data for Name: jobs; Type: TABLE DATA; Schema: public; Owner: remoteiq
--

COPY public.jobs (id, agent_id, type, payload, status, created_at, dispatched_at, started_at, finished_at, agent_uuid) FROM stdin;
b011b61d-f203-446b-be7c-4e7bbd1232cf	4	RUN_SCRIPT	{"env": {}, "args": [], "language": "powershell", "scriptText": "$ErrorActionPreference = \\"Stop\\"\\n\\nfunction Try-Winget {\\n  param([string]$Pkg, [string]$Ver)\\n  try {\\n    if ($Ver) {\\n      winget.exe uninstall --silent --exact --accept-source-agreements --accept-package-agreements --id \\"$Pkg\\" --version \\"$Ver\\" 2>$null\\n      if ($LASTEXITCODE -eq 0) { return $true }\\n      winget.exe uninstall --silent --accept-source-agreements --accept-package-agreements --name \\"$Pkg\\" --version \\"$Ver\\" 2>$null\\n      if ($LASTEXITCODE -eq 0) { return $true }\\n    } else {\\n      winget.exe uninstall --silent --exact --accept-source-agreements --accept-package-agreements --id \\"$Pkg\\" 2>$null\\n      if ($LASTEXITCODE -eq 0) { return $true }\\n      winget.exe uninstall --silent --accept-source-agreements --accept-package-agreements --name \\"$Pkg\\" 2>$null\\n      if ($LASTEXITCODE -eq 0) { return $true }\\n    }\\n  } catch {}\\n  return $false\\n}\\n\\nfunction Try-MSI {\\n  param([string]$DisplayName)\\n  $roots = @(\\n    'HKLM:\\\\Software\\\\Microsoft\\\\Windows\\\\CurrentVersion\\\\Uninstall\\\\*',\\n    'HKLM:\\\\Software\\\\WOW6432Node\\\\Microsoft\\\\Windows\\\\CurrentVersion\\\\Uninstall\\\\*',\\n    'HKCU:\\\\Software\\\\Microsoft\\\\Windows\\\\CurrentVersion\\\\Uninstall\\\\*'\\n  )\\n  $apps = Get-ItemProperty $roots | Where-Object { $_.DisplayName -and $_.DisplayName -like \\"*$DisplayName*\\" }\\n  foreach ($a in $apps) {\\n    if ($a.UninstallString) {\\n      $cmd = $a.UninstallString\\n      if ($cmd -match \\"msiexec\\\\.exe\\" -or $cmd -match \\"MsiExec\\\\.exe\\") {\\n        # Normalize to silent MSI removal using ProductCode (PSChildName)\\n        $cmd = \\"msiexec.exe /x \\" + ($a.PSChildName) + \\" /qn /norestart\\"\\n      }\\n      Start-Process -FilePath \\"cmd.exe\\" -ArgumentList \\"/c\\", $cmd -Wait\\n      if ($LASTEXITCODE -eq 0) { return $true }\\n    }\\n  }\\n  return $false\\n}\\n\\n$target = \\"AnyDesk\\"\\n$wantedVersion = \\"ad 9.0.9\\"\\n\\nWrite-Output \\"Uninstalling '$target' (wanted version '$wantedVersion')\\"\\n\\nif (Try-Winget $target $wantedVersion) { exit 0 }\\nif (Try-MSI $target) { exit 0 }\\n\\nWrite-Error \\"Failed to uninstall AnyDesk\\"\\nexit 1", "timeoutSec": 900}	succeeded	2025-10-30 19:50:29.592909+00	2025-10-30 19:50:29.596873+00	\N	2025-10-30 19:50:30.25629+00	\N
\.


--
-- Data for Name: localization_settings; Type: TABLE DATA; Schema: public; Owner: remoteiq
--

COPY public.localization_settings (id, language, date_format, time_format, number_format, time_zone, first_day_of_week, currency) FROM stdin;
1	en-US	MM/DD/YYYY	12h	1,234.56	America/New_York	sunday	USD
\.


--
-- Data for Name: login_challenges; Type: TABLE DATA; Schema: public; Owner: remoteiq
--

COPY public.login_challenges (id, user_id, created_at) FROM stdin;
f8df0b98-5645-4e31-9fb4-837b8429c8b5	8eed6cd1-388e-44a0-8d7f-f54f2b93f8f7	2025-10-21 18:18:00.543159+00
b5887bec-5dd6-44ad-b083-8386d56db343	8eed6cd1-388e-44a0-8d7f-f54f2b93f8f7	2025-10-21 18:21:17.979598+00
2b20c670-51f6-429d-bb1b-3b21b2ba4b2e	8eed6cd1-388e-44a0-8d7f-f54f2b93f8f7	2025-10-21 18:25:25.058739+00
16ed30a0-e27e-43da-ad5e-630f0aaa82e9	8eed6cd1-388e-44a0-8d7f-f54f2b93f8f7	2025-10-21 19:06:10.600715+00
8efaedc1-028c-4d2b-8da9-1f3e11e70992	8eed6cd1-388e-44a0-8d7f-f54f2b93f8f7	2025-10-21 19:06:33.830727+00
217d238d-391a-4cf3-8627-4a0ff2f354fc	8eed6cd1-388e-44a0-8d7f-f54f2b93f8f7	2025-10-21 19:13:10.450456+00
c0691edd-76e4-4c35-b97f-28ec9e7393fd	8eed6cd1-388e-44a0-8d7f-f54f2b93f8f7	2025-10-21 19:16:11.291434+00
001b4849-bfb8-4f8c-86f6-2beb95675e74	8eed6cd1-388e-44a0-8d7f-f54f2b93f8f7	2025-10-21 19:39:49.41636+00
1006635e-83bc-4731-8e2c-9c4a323f26a7	8eed6cd1-388e-44a0-8d7f-f54f2b93f8f7	2025-10-21 19:40:36.838394+00
78cafb57-c88a-4d00-b0b3-2737c8d4685a	8eed6cd1-388e-44a0-8d7f-f54f2b93f8f7	2025-10-23 00:21:29.554638+00
1bc5da67-2ec4-4cc5-b0d4-28924e0196a6	8eed6cd1-388e-44a0-8d7f-f54f2b93f8f7	2025-10-23 02:58:24.086373+00
5caf5b24-dfa1-4b60-b835-29359f001baa	8eed6cd1-388e-44a0-8d7f-f54f2b93f8f7	2025-10-27 02:14:19.574308+00
151b7082-14e0-4e57-82fc-00b893f69553	8eed6cd1-388e-44a0-8d7f-f54f2b93f8f7	2025-10-28 02:57:39.814746+00
4ac3d9fa-ea31-4909-b2e4-83076aa76a82	8eed6cd1-388e-44a0-8d7f-f54f2b93f8f7	2025-10-28 02:58:31.797191+00
d5d694f6-0432-4eeb-aba2-844faad4c58e	8eed6cd1-388e-44a0-8d7f-f54f2b93f8f7	2025-10-28 03:00:47.858299+00
1362be4b-aea4-4197-8e50-5339ff18c20e	8eed6cd1-388e-44a0-8d7f-f54f2b93f8f7	2025-10-28 03:00:50.35511+00
4448cc45-3026-4143-94f5-a6724af05b9c	8eed6cd1-388e-44a0-8d7f-f54f2b93f8f7	2025-11-03 01:47:26.586489+00
\.


--
-- Data for Name: permissions; Type: TABLE DATA; Schema: public; Owner: remoteiq
--

COPY public.permissions (id, key, label, group_key, group_label, created_at) FROM stdin;
d65c66ac-1064-4898-bd70-7666d7ba7c01	users.read	View users	users	Users	2025-11-06 05:10:27.459084+00
c81993e6-713c-44a3-8d48-adff9c72d47d	users.write	Create/edit users	users	Users	2025-11-06 05:10:27.459084+00
7ec8d819-0e10-4932-b9bf-f60489013edf	users.delete	Remove users	users	Users	2025-11-06 05:10:27.459084+00
68bfc1b7-b087-4e35-8630-4f5258c00bbe	users.2fa.reset	Reset 2FA	users	Users	2025-11-06 05:10:27.459084+00
297fa5d9-b815-4ad6-a844-96c9db4139de	roles.read	roles.read	roles	Roles	2025-11-06 05:10:27.459084+00
47db195b-0cb3-4d4f-ae4f-0064e13bb01b	roles.write	roles.write	roles	Roles	2025-11-06 05:10:27.459084+00
ad57ae03-6d34-403e-b276-2bf31af72f26	roles.delete	roles.delete	roles	Roles	2025-11-06 05:10:27.459084+00
fc3da057-f475-4cdd-b847-dee451fdf97b	teams.read	teams.read	teams	Teams	2025-11-06 05:10:27.459084+00
af055f8b-b601-4511-abe6-47dcc96e0081	teams.write	teams.write	teams	Teams	2025-11-06 05:10:27.459084+00
9e348619-5e50-4afb-a4c6-36e3fa281f35	teams.delete	teams.delete	teams	Teams	2025-11-06 05:10:27.459084+00
4c646bc7-1438-4e8b-b688-9678e7049812	billing.read	billing.read	billing	Billing	2025-11-06 05:10:27.459084+00
66f47c1f-41ea-4b82-b8dd-696de852ea06	billing.write	billing.write	billing	Billing	2025-11-06 05:10:27.459084+00
731edf0d-a57d-4233-b90a-25d47cf2c148	settings.read	settings.read	settings	Settings	2025-11-06 05:10:27.459084+00
8f3dc769-dad6-4710-b3d8-ddeb14e80c57	settings.write	settings.write	settings	Settings	2025-11-06 05:10:27.459084+00
2291b2d5-94c8-40ee-b081-2e59fe44c71c	backups.manage	backups.manage	backups	Backups	2025-11-06 05:10:27.459084+00
70b71f5c-3ce9-4e35-9d59-e7411335cde6	backups.restore	backups.restore	backups	Backups	2025-11-06 05:10:27.459084+00
51f75ded-1b12-477a-a03f-b3c44664c3dc	backups.download	backups.download	backups	Backups	2025-11-06 05:10:27.459084+00
\.


--
-- Data for Name: personal_tokens; Type: TABLE DATA; Schema: public; Owner: remoteiq
--

COPY public.personal_tokens (id, user_id, name, token_hash, created_at, last_used_at, revoked_at) FROM stdin;
4ee3e029-ec76-4d2b-98f3-281700b1cb11	8eed6cd1-388e-44a0-8d7f-f54f2b93f8f7	test token	$2b$12$hy72LINUKbbMDyWvBb2PxeVoMnkxScaIEhnr/6sWIAoGB0jb.k3Vm	2025-10-21 05:40:51.646678+00	\N	2025-10-21 05:41:15.854419+00
\.


--
-- Data for Name: role_meta; Type: TABLE DATA; Schema: public; Owner: remoteiq
--

COPY public.role_meta (role_name, description, permissions, updated_at) FROM stdin;
User	Standard access	{users.read,roles.read,teams.read,settings.read}	2025-10-20 00:20:06.974984+00
Admin	Administrative access	{backups.download,backups.manage,backups.restore,billing.read,billing.write,roles.delete,roles.read,roles.write,settings.read,settings.write,teams.delete,teams.read,teams.write,users.2fa.reset,users.delete,users.read,users.write}	2025-11-06 04:48:30.051104+00
Owner	Full system access	{users.read,users.write,users.delete,users.2fa.reset,roles.read,roles.write,roles.delete,teams.read,teams.write,teams.delete,billing.read,billing.write,settings.read,settings.write,backups.manage,backups.download,backups.restore}	2025-11-06 06:30:35.212971+00
UI Check	Created to verify persistence	{users.read,roles.read}	2025-10-20 03:32:40.607708+00
\.


--
-- Data for Name: role_permissions; Type: TABLE DATA; Schema: public; Owner: remoteiq
--

COPY public.role_permissions (role_id, permission_id) FROM stdin;
46359675-248c-4f3c-98d2-706c71ea186b	8f3dc769-dad6-4710-b3d8-ddeb14e80c57
46359675-248c-4f3c-98d2-706c71ea186b	ad57ae03-6d34-403e-b276-2bf31af72f26
46359675-248c-4f3c-98d2-706c71ea186b	51f75ded-1b12-477a-a03f-b3c44664c3dc
46359675-248c-4f3c-98d2-706c71ea186b	2291b2d5-94c8-40ee-b081-2e59fe44c71c
46359675-248c-4f3c-98d2-706c71ea186b	70b71f5c-3ce9-4e35-9d59-e7411335cde6
46359675-248c-4f3c-98d2-706c71ea186b	c81993e6-713c-44a3-8d48-adff9c72d47d
46359675-248c-4f3c-98d2-706c71ea186b	7ec8d819-0e10-4932-b9bf-f60489013edf
46359675-248c-4f3c-98d2-706c71ea186b	9e348619-5e50-4afb-a4c6-36e3fa281f35
46359675-248c-4f3c-98d2-706c71ea186b	68bfc1b7-b087-4e35-8630-4f5258c00bbe
46359675-248c-4f3c-98d2-706c71ea186b	d65c66ac-1064-4898-bd70-7666d7ba7c01
46359675-248c-4f3c-98d2-706c71ea186b	4c646bc7-1438-4e8b-b688-9678e7049812
46359675-248c-4f3c-98d2-706c71ea186b	297fa5d9-b815-4ad6-a844-96c9db4139de
46359675-248c-4f3c-98d2-706c71ea186b	af055f8b-b601-4511-abe6-47dcc96e0081
46359675-248c-4f3c-98d2-706c71ea186b	66f47c1f-41ea-4b82-b8dd-696de852ea06
46359675-248c-4f3c-98d2-706c71ea186b	47db195b-0cb3-4d4f-ae4f-0064e13bb01b
46359675-248c-4f3c-98d2-706c71ea186b	fc3da057-f475-4cdd-b847-dee451fdf97b
46359675-248c-4f3c-98d2-706c71ea186b	731edf0d-a57d-4233-b90a-25d47cf2c148
63f225b8-d18c-4525-9ea4-c1c15f8e576b	8f3dc769-dad6-4710-b3d8-ddeb14e80c57
63f225b8-d18c-4525-9ea4-c1c15f8e576b	ad57ae03-6d34-403e-b276-2bf31af72f26
63f225b8-d18c-4525-9ea4-c1c15f8e576b	51f75ded-1b12-477a-a03f-b3c44664c3dc
63f225b8-d18c-4525-9ea4-c1c15f8e576b	2291b2d5-94c8-40ee-b081-2e59fe44c71c
63f225b8-d18c-4525-9ea4-c1c15f8e576b	70b71f5c-3ce9-4e35-9d59-e7411335cde6
63f225b8-d18c-4525-9ea4-c1c15f8e576b	c81993e6-713c-44a3-8d48-adff9c72d47d
63f225b8-d18c-4525-9ea4-c1c15f8e576b	7ec8d819-0e10-4932-b9bf-f60489013edf
63f225b8-d18c-4525-9ea4-c1c15f8e576b	9e348619-5e50-4afb-a4c6-36e3fa281f35
63f225b8-d18c-4525-9ea4-c1c15f8e576b	68bfc1b7-b087-4e35-8630-4f5258c00bbe
63f225b8-d18c-4525-9ea4-c1c15f8e576b	d65c66ac-1064-4898-bd70-7666d7ba7c01
63f225b8-d18c-4525-9ea4-c1c15f8e576b	4c646bc7-1438-4e8b-b688-9678e7049812
63f225b8-d18c-4525-9ea4-c1c15f8e576b	297fa5d9-b815-4ad6-a844-96c9db4139de
63f225b8-d18c-4525-9ea4-c1c15f8e576b	af055f8b-b601-4511-abe6-47dcc96e0081
63f225b8-d18c-4525-9ea4-c1c15f8e576b	66f47c1f-41ea-4b82-b8dd-696de852ea06
63f225b8-d18c-4525-9ea4-c1c15f8e576b	47db195b-0cb3-4d4f-ae4f-0064e13bb01b
63f225b8-d18c-4525-9ea4-c1c15f8e576b	fc3da057-f475-4cdd-b847-dee451fdf97b
63f225b8-d18c-4525-9ea4-c1c15f8e576b	731edf0d-a57d-4233-b90a-25d47cf2c148
\.


--
-- Data for Name: roles; Type: TABLE DATA; Schema: public; Owner: remoteiq
--

COPY public.roles (id, name, created_at, description) FROM stdin;
46359675-248c-4f3c-98d2-706c71ea186b	Owner	2025-10-19 06:21:19.645179+00	\N
63f225b8-d18c-4525-9ea4-c1c15f8e576b	Admin	2025-10-19 06:21:19.645179+00	\N
3e5a01f2-c480-47ed-b9e6-f5d9790766c2	User	2025-10-19 06:21:19.645179+00	\N
a265426e-a13d-48e4-af58-f420ce26c35f	UI Check	2025-10-20 03:32:40.60658+00	\N
\.


--
-- Data for Name: sessions; Type: TABLE DATA; Schema: public; Owner: remoteiq
--

COPY public.sessions (id, user_id, jti, user_agent, ip, created_at, last_seen, revoked_at, last_seen_at, trusted) FROM stdin;
afb34fcc-e94d-4d67-98a8-e070a4cfea4e	8eed6cd1-388e-44a0-8d7f-f54f2b93f8f7	ebd2275c-d421-4d57-b994-3f44d81d82e9	Mozilla/5.0 (Windows NT 10.0; Microsoft Windows 10.0.26200; en-US) PowerShell/7.5.3	::1	2025-10-21 05:20:41.411633+00	2025-10-21 05:20:41.411633+00	2025-10-21 15:43:11.581586+00	2025-10-21 05:20:41.411633+00	f
efc04d1d-bd0c-4771-8873-9a6a7df1f214	8eed6cd1-388e-44a0-8d7f-f54f2b93f8f7	0cde9ad5-33ba-441f-8ea0-786c398d9e1f	Mozilla/5.0 (Windows NT 10.0; Microsoft Windows 10.0.26200; en-US) PowerShell/7.5.3	::1	2025-10-21 05:15:28.231767+00	2025-10-21 05:15:28.231767+00	2025-10-21 15:43:12.048188+00	2025-10-21 05:15:28.231767+00	f
ad01b440-2b4a-469f-9dae-8361c9a11671	8eed6cd1-388e-44a0-8d7f-f54f2b93f8f7	a4be7cc6-e9e5-4c46-94e9-58854df56492	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36	::1	2025-10-21 15:48:55.900604+00	2025-10-21 15:48:55.900604+00	2025-10-21 15:53:01.021419+00	2025-10-21 15:48:55.900604+00	f
cbc3817a-b723-4eaf-a46d-af8dd2c26cdf	8eed6cd1-388e-44a0-8d7f-f54f2b93f8f7	50e99006-b72c-4d79-a071-c8bec37620ae	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36	::1	2025-10-21 14:46:05.129046+00	2025-10-21 14:46:05.129046+00	2025-10-21 15:43:09.505246+00	2025-10-21 14:46:05.129046+00	f
9dc9c8e6-5f99-4a81-ac26-06d7c4da7618	8eed6cd1-388e-44a0-8d7f-f54f2b93f8f7	1cc926c4-09a1-467b-9ab8-f516911bd75d	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36	::1	2025-10-21 13:57:31.714778+00	2025-10-21 13:57:31.714778+00	2025-10-21 15:43:10.539029+00	2025-10-21 13:57:31.714778+00	f
34628f2d-af71-4220-8803-afaca5b90f6e	8eed6cd1-388e-44a0-8d7f-f54f2b93f8f7	4c0e4a3f-6b03-4d9d-bd9c-3000c95b085b	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36	::1	2025-10-21 13:55:39.930027+00	2025-10-21 13:55:39.930027+00	2025-10-21 15:43:10.739364+00	2025-10-21 13:55:39.930027+00	f
331b2359-38c6-4b94-8965-80bc3621fa88	8eed6cd1-388e-44a0-8d7f-f54f2b93f8f7	95543bd4-f72d-45d2-a985-6fb6628bfc41	Mozilla/5.0 (Windows NT 10.0; Microsoft Windows 10.0.26200; en-US) PowerShell/7.5.3	::1	2025-10-21 05:38:25.932653+00	2025-10-21 05:38:25.932653+00	2025-10-21 15:43:10.966983+00	2025-10-21 05:38:25.932653+00	f
16e15d07-ac42-4a5e-9e81-54c6c79e5d29	8eed6cd1-388e-44a0-8d7f-f54f2b93f8f7	822b5637-b704-4409-9a83-9b5fec67e006	Mozilla/5.0 (Windows NT 10.0; Microsoft Windows 10.0.26200; en-US) PowerShell/7.5.3	::1	2025-10-21 05:35:23.159192+00	2025-10-21 05:35:23.159192+00	2025-10-21 15:43:11.167215+00	2025-10-21 05:35:23.159192+00	f
5862e71a-b4cc-48f4-9158-41b7c29357bc	8eed6cd1-388e-44a0-8d7f-f54f2b93f8f7	485b7add-3ddd-435a-9b5a-67b5b1331c30	Mozilla/5.0 (Windows NT 10.0; Microsoft Windows 10.0.26200; en-US) PowerShell/7.5.3	::1	2025-10-21 05:33:29.431796+00	2025-10-21 05:33:29.431796+00	2025-10-21 15:43:11.376424+00	2025-10-21 05:33:29.431796+00	f
52f6da36-1f41-4db2-ad07-4759b94e6ecd	8eed6cd1-388e-44a0-8d7f-f54f2b93f8f7	c6b67732-d134-4ccb-b936-7d02e5fe07dc	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36	::1	2025-10-21 15:53:11.991584+00	2025-10-21 15:53:11.991584+00	2025-10-21 18:14:30.812504+00	2025-10-21 17:42:18.125452+00	t
4b54852a-45fd-48cb-9a55-b2e767af12be	8eed6cd1-388e-44a0-8d7f-f54f2b93f8f7	4c0cc739-3800-4b44-8cc3-6a1e8b00c009	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36	::1	2025-10-21 18:13:45.043735+00	2025-10-21 18:13:45.043735+00	2025-10-21 20:25:08.537211+00	2025-10-21 18:16:34.758559+00	t
d2f727ce-edd6-4e51-bddb-b42f501d5439	8eed6cd1-388e-44a0-8d7f-f54f2b93f8f7	2c256efe-45fc-4d83-a880-4eaed61c6628	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36	::1	2025-10-21 19:38:11.015506+00	2025-10-21 19:38:11.015506+00	2025-10-21 20:25:08.537211+00	2025-10-21 19:39:38.095375+00	f
89647074-210f-41cd-9d02-9a2aaad83b5a	8eed6cd1-388e-44a0-8d7f-f54f2b93f8f7	5701bc63-6a59-495d-9361-f4a12f92c6ed	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36	::1	2025-10-21 19:39:52.640656+00	2025-10-21 19:39:52.640656+00	2025-10-21 20:25:08.537211+00	2025-10-21 19:39:52.640656+00	f
d1a6bade-a65c-4f69-81c2-cda9fbee165c	8eed6cd1-388e-44a0-8d7f-f54f2b93f8f7	b8197d35-4c7c-4080-b754-9f0e394a14fe	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36	::1	2025-10-21 19:04:47.553425+00	2025-10-21 19:04:47.553425+00	2025-10-21 20:25:08.537211+00	2025-10-21 19:05:27.256883+00	f
ca08997e-49cb-4432-88f7-814357c9bfd6	8eed6cd1-388e-44a0-8d7f-f54f2b93f8f7	38edfe66-d51f-442f-bc98-47fc8cd11f04	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36	::1	2025-10-21 19:18:53.03543+00	2025-10-21 19:18:53.03543+00	2025-10-21 20:25:08.537211+00	2025-10-21 19:19:14.406895+00	f
5c4e8615-30f4-4bfd-8202-11c905735275	8eed6cd1-388e-44a0-8d7f-f54f2b93f8f7	ed551030-061c-4250-b97c-0e372dd99b88	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36	::1	2025-10-21 19:19:27.838862+00	2025-10-21 19:19:27.838862+00	2025-10-21 20:25:08.537211+00	2025-10-21 19:19:27.838862+00	f
e0f614f7-34f5-4be8-a71e-1e726694a3d7	8eed6cd1-388e-44a0-8d7f-f54f2b93f8f7	b849be36-316c-45c0-9b18-e2254cc04772	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36	::1	2025-10-23 00:21:49.727303+00	2025-10-23 00:21:49.727303+00	2025-10-26 19:54:09.576446+00	2025-10-23 02:57:33.354974+00	t
bd03bcd7-8298-451f-83a0-d254b677d143	8eed6cd1-388e-44a0-8d7f-f54f2b93f8f7	57dbae10-8e0d-40c1-a396-c05aeae69777	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36	::1	2025-10-23 02:58:32.665601+00	2025-10-23 02:58:32.665601+00	2025-10-27 02:15:31.211122+00	2025-10-26 19:54:10.747186+00	t
daf0f0e9-8a49-45b2-aa51-da9c4c99c8c0	8eed6cd1-388e-44a0-8d7f-f54f2b93f8f7	3074d6de-758d-41cc-8b3b-a9d25955bb1c	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36	::1	2025-10-27 02:14:29.620747+00	2025-10-27 02:14:29.620747+00	2025-11-03 02:57:52.523652+00	2025-10-31 02:18:22.057588+00	t
8e3509c0-4920-45a9-a46f-492d3ea5c175	8eed6cd1-388e-44a0-8d7f-f54f2b93f8f7	98fa4761-3c48-433b-9310-3a7bfd1e7905	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36	::1	2025-10-21 19:40:41.945944+00	2025-10-21 19:40:41.945944+00	2025-10-23 00:22:49.18497+00	2025-10-21 20:25:32.689467+00	t
90221e17-7806-4996-834f-ff0563f49806	8eed6cd1-388e-44a0-8d7f-f54f2b93f8f7	5fc15edb-6d2a-4583-8c59-d70da9eeb70a	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36	::1	2025-11-03 01:47:39.24548+00	2025-11-03 01:47:39.24548+00	\N	2025-11-06 07:10:21.916683+00	t
\.


--
-- Data for Name: support_legal; Type: TABLE DATA; Schema: public; Owner: remoteiq
--

COPY public.support_legal (id, support_email, support_phone, knowledge_base_url, status_page_url, privacy_policy_url, terms_url, gdpr_contact_email, legal_address, ticket_portal_url, phone_hours, notes_html) FROM stdin;
1	help@remoteiq.com	\N	https://help.remoteiq.com	https://help.remoteiq.com	https://help.remoteiq.com	https://remoteiq.com/terms	admin@remoteiq.com	\N	https://help.remoteiq.com	\N	\N
\.


--
-- Data for Name: support_legal_settings; Type: TABLE DATA; Schema: public; Owner: remoteiq
--

COPY public.support_legal_settings (id, support_email, support_phone, support_url, status_page_url, kb_url, terms_url, privacy_url, gdpr_contact, dmca_contact, show_chat_widget, chat_widget_code, updated_at) FROM stdin;
1	\N	\N	\N	\N	\N	\N	\N	\N	\N	f	\N	2025-10-19 05:28:23.162728+00
\.


--
-- Data for Name: tickets; Type: TABLE DATA; Schema: public; Owner: remoteiq
--

COPY public.tickets (id, number, title, description, status, priority, requester_name, requester_email, assignee_id, client, site, device_id, created_at, updated_at, customer_id, customer_uuid, assignee_user_id) FROM stdin;
4f7c5dba-68b4-4f3e-8406-57c36f05470e	1	Sample: Onboard laptop	Join domain, install agent, set policies.	open	normal	Alice Example	alice@example.com	\N	Acme Co	HQ	\N	2025-11-03 03:54:59.728956+00	2025-11-03 05:57:48.09708+00	Acme Co	\N	\N
e30b4200-7f2f-44bc-ad8f-0ebff78d88a1	3	test	test	open	medium	\N	\N	\N	\N	\N	\N	2025-11-03 07:23:15.26961+00	2025-11-03 07:23:15.26961+00	\N	\N	\N
1ec322ff-e3ea-4d8c-b133-e780dba15e13	2	Sample: Printer offline	Intermittent connectivity on 3rd floor.	closed	high	Bob Example	bob@example.com	\N	Acme Co	3F	\N	2025-11-03 03:54:59.728956+00	2025-11-03 21:35:12.283775+00	Acme Co	\N	\N
482b3bdd-d027-411e-886b-93696f701563	4	aerfbsaedfrbaerbaerb	aqerbaserbaewrbaerb	open	medium	\N	\N	\N	\N	\N	\N	2025-11-03 21:36:36.530028+00	2025-11-03 21:36:36.530028+00	\N	\N	\N
\.


--
-- Data for Name: trusted_devices; Type: TABLE DATA; Schema: public; Owner: remoteiq
--

COPY public.trusted_devices (id, user_id, device_fingerprint, created_at, expires_at) FROM stdin;
dcf1acf5-cd0c-4906-9f17-2df884912ad5	8eed6cd1-388e-44a0-8d7f-f54f2b93f8f7	001b4849-bfb8-4f8c-86f6-2beb95675e74	2025-10-21 19:39:52.642752+00	2026-01-19 19:39:52.642752+00
4f96c7b3-c1ce-4452-ae8d-6bd146e14e0b	8eed6cd1-388e-44a0-8d7f-f54f2b93f8f7	1006635e-83bc-4731-8e2c-9c4a323f26a7	2025-10-21 19:40:41.947804+00	2026-01-19 19:40:41.947804+00
1c585e35-4645-46f6-8a8e-8d7e7a21969f	8eed6cd1-388e-44a0-8d7f-f54f2b93f8f7	78cafb57-c88a-4d00-b0b3-2737c8d4685a	2025-10-23 00:21:49.730237+00	2026-01-21 00:21:49.730237+00
0b41370e-13fc-438c-a47b-c43d553a48a0	8eed6cd1-388e-44a0-8d7f-f54f2b93f8f7	1bc5da67-2ec4-4cc5-b0d4-28924e0196a6	2025-10-23 02:58:32.667543+00	2026-01-21 02:58:32.667543+00
7f269330-f704-4f32-b2b0-20f5c3c74ea6	8eed6cd1-388e-44a0-8d7f-f54f2b93f8f7	5caf5b24-dfa1-4b60-b835-29359f001baa	2025-10-27 02:14:29.622798+00	2026-01-25 02:14:29.622798+00
84d76a6e-d0f1-43d1-8635-9542bf58343a	8eed6cd1-388e-44a0-8d7f-f54f2b93f8f7	4448cc45-3026-4143-94f5-a6724af05b9c	2025-11-03 01:47:39.248357+00	2026-02-01 01:47:39.248357+00
\.


--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: remoteiq
--

COPY public.users (id, name, email, role, two_factor_enabled, suspended, status, last_seen, created_at, updated_at, password_hash, password_updated_at, phone, address1, address2, city, state, postal, country, timezone, locale, avatar_url, avatar_thumb_url, totp_secret, two_factor_recovery_codes, two_factor_secret) FROM stdin;
8eed6cd1-388e-44a0-8d7f-f54f2b93f8f7	Joseph Gibbs	jgibbs.online@gmail.com	Owner	t	f	active	\N	2025-10-19 08:31:12.984517+00	2025-11-06 07:10:20.425841+00	$2b$12$rl3Nx03rkHRKNeTVmkU4gOJgGJeYr/dl3.2cDzc8EwKt0OBLyDBxW	2025-10-28 02:58:20.923668+00	5555555555	123 RemoteIQ Lane	\N	Dayton	OH	45424	United States	America/New_York	en-US	http://localhost:3001/static/uploads/1761078255262_avatar.png?t=1761078255280	http://localhost:3001/static/uploads/1761078255262_avatar.png?t=1761078255280	LQVECBLVEBHROKDF	{55V9-CE2C-54C3,SY8H-M9LL-ULMQ,4XX8-GM9V-RBR3,RUE3-HBL4-Y86C,VVL6-KM8H-F9AP,EZRD-C25S-PGKU,88VJ-9RCC-PJ2K,UFWM-VVZB-4GGB}	FNDC4RZXPNRC4HRG
\.


--
-- Name: agent_jobs_id_seq; Type: SEQUENCE SET; Schema: public; Owner: remoteiq
--

SELECT pg_catalog.setval('public.agent_jobs_id_seq', 1, false);


--
-- Name: agent_software_id_seq; Type: SEQUENCE SET; Schema: public; Owner: remoteiq
--

SELECT pg_catalog.setval('public.agent_software_id_seq', 36528, true);


--
-- Name: agents_id_seq; Type: SEQUENCE SET; Schema: public; Owner: remoteiq
--

SELECT pg_catalog.setval('public.agents_id_seq', 4, true);


--
-- Name: dkim_keys_id_seq; Type: SEQUENCE SET; Schema: public; Owner: remoteiq
--

SELECT pg_catalog.setval('public.dkim_keys_id_seq', 1, false);


--
-- Name: email_inbound_events_id_seq; Type: SEQUENCE SET; Schema: public; Owner: remoteiq
--

SELECT pg_catalog.setval('public.email_inbound_events_id_seq', 1, false);


--
-- Name: imap_ingested_id_seq; Type: SEQUENCE SET; Schema: public; Owner: remoteiq
--

SELECT pg_catalog.setval('public.imap_ingested_id_seq', 13589, true);


--
-- Name: tickets_number_seq; Type: SEQUENCE SET; Schema: public; Owner: remoteiq
--

SELECT pg_catalog.setval('public.tickets_number_seq', 4, true);


--
-- Name: agent_jobs agent_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: remoteiq
--

ALTER TABLE ONLY public.agent_jobs
    ADD CONSTRAINT agent_jobs_pkey PRIMARY KEY (id);


--
-- Name: agent_software agent_software_pkey; Type: CONSTRAINT; Schema: public; Owner: remoteiq
--

ALTER TABLE ONLY public.agent_software
    ADD CONSTRAINT agent_software_pkey PRIMARY KEY (id);


--
-- Name: agents agents_agent_uuid_uk; Type: CONSTRAINT; Schema: public; Owner: remoteiq
--

ALTER TABLE ONLY public.agents
    ADD CONSTRAINT agents_agent_uuid_uk UNIQUE (agent_uuid);


--
-- Name: agents agents_pkey; Type: CONSTRAINT; Schema: public; Owner: remoteiq
--

ALTER TABLE ONLY public.agents
    ADD CONSTRAINT agents_pkey PRIMARY KEY (id);


--
-- Name: backup_job_logs backup_job_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: remoteiq
--

ALTER TABLE ONLY public.backup_job_logs
    ADD CONSTRAINT backup_job_logs_pkey PRIMARY KEY (job_id);


--
-- Name: backup_job_manifests backup_job_manifests_pkey; Type: CONSTRAINT; Schema: public; Owner: remoteiq
--

ALTER TABLE ONLY public.backup_job_manifests
    ADD CONSTRAINT backup_job_manifests_pkey PRIMARY KEY (job_id);


--
-- Name: backup_jobs backup_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: remoteiq
--

ALTER TABLE ONLY public.backup_jobs
    ADD CONSTRAINT backup_jobs_pkey PRIMARY KEY (id);


--
-- Name: backup_restores backup_restores_pkey; Type: CONSTRAINT; Schema: public; Owner: remoteiq
--

ALTER TABLE ONLY public.backup_restores
    ADD CONSTRAINT backup_restores_pkey PRIMARY KEY (id);


--
-- Name: backups_config backups_config_pkey; Type: CONSTRAINT; Schema: public; Owner: remoteiq
--

ALTER TABLE ONLY public.backups_config
    ADD CONSTRAINT backups_config_pkey PRIMARY KEY (id);


--
-- Name: branding_settings branding_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: remoteiq
--

ALTER TABLE ONLY public.branding_settings
    ADD CONSTRAINT branding_settings_pkey PRIMARY KEY (id);


--
-- Name: check_assignments check_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: remoteiq
--

ALTER TABLE ONLY public.check_assignments
    ADD CONSTRAINT check_assignments_pkey PRIMARY KEY (id);


--
-- Name: check_runs check_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: remoteiq
--

ALTER TABLE ONLY public.check_runs
    ADD CONSTRAINT check_runs_pkey PRIMARY KEY (id);


--
-- Name: checks checks_pkey; Type: CONSTRAINT; Schema: public; Owner: remoteiq
--

ALTER TABLE ONLY public.checks
    ADD CONSTRAINT checks_pkey PRIMARY KEY (id);


--
-- Name: checks checks_type_name_unique; Type: CONSTRAINT; Schema: public; Owner: remoteiq
--

ALTER TABLE ONLY public.checks
    ADD CONSTRAINT checks_type_name_unique UNIQUE (type, name);


--
-- Name: company_profile company_profile_pkey; Type: CONSTRAINT; Schema: public; Owner: remoteiq
--

ALTER TABLE ONLY public.company_profile
    ADD CONSTRAINT company_profile_pkey PRIMARY KEY (id);


--
-- Name: devices devices_pkey; Type: CONSTRAINT; Schema: public; Owner: remoteiq
--

ALTER TABLE ONLY public.devices
    ADD CONSTRAINT devices_pkey PRIMARY KEY (id);


--
-- Name: dkim_keys dkim_keys_domain_selector_key; Type: CONSTRAINT; Schema: public; Owner: remoteiq
--

ALTER TABLE ONLY public.dkim_keys
    ADD CONSTRAINT dkim_keys_domain_selector_key UNIQUE (domain, selector);


--
-- Name: dkim_keys dkim_keys_pkey; Type: CONSTRAINT; Schema: public; Owner: remoteiq
--

ALTER TABLE ONLY public.dkim_keys
    ADD CONSTRAINT dkim_keys_pkey PRIMARY KEY (id);


--
-- Name: dkim_settings dkim_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: remoteiq
--

ALTER TABLE ONLY public.dkim_settings
    ADD CONSTRAINT dkim_settings_pkey PRIMARY KEY (id);


--
-- Name: email_inbound_events email_inbound_events_pkey; Type: CONSTRAINT; Schema: public; Owner: remoteiq
--

ALTER TABLE ONLY public.email_inbound_events
    ADD CONSTRAINT email_inbound_events_pkey PRIMARY KEY (id);


--
-- Name: email_settings email_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: remoteiq
--

ALTER TABLE ONLY public.email_settings
    ADD CONSTRAINT email_settings_pkey PRIMARY KEY (purpose);


--
-- Name: imap_ingested imap_ingested_pkey; Type: CONSTRAINT; Schema: public; Owner: remoteiq
--

ALTER TABLE ONLY public.imap_ingested
    ADD CONSTRAINT imap_ingested_pkey PRIMARY KEY (id);


--
-- Name: imap_ingested imap_ingested_purpose_uid_key; Type: CONSTRAINT; Schema: public; Owner: remoteiq
--

ALTER TABLE ONLY public.imap_ingested
    ADD CONSTRAINT imap_ingested_purpose_uid_key UNIQUE (purpose, uid);


--
-- Name: imap_state imap_state_pkey; Type: CONSTRAINT; Schema: public; Owner: remoteiq
--

ALTER TABLE ONLY public.imap_state
    ADD CONSTRAINT imap_state_pkey PRIMARY KEY (purpose);


--
-- Name: job_results job_results_pkey; Type: CONSTRAINT; Schema: public; Owner: remoteiq
--

ALTER TABLE ONLY public.job_results
    ADD CONSTRAINT job_results_pkey PRIMARY KEY (job_id);


--
-- Name: jobs jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: remoteiq
--

ALTER TABLE ONLY public.jobs
    ADD CONSTRAINT jobs_pkey PRIMARY KEY (id);


--
-- Name: localization_settings localization_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: remoteiq
--

ALTER TABLE ONLY public.localization_settings
    ADD CONSTRAINT localization_settings_pkey PRIMARY KEY (id);


--
-- Name: login_challenges login_challenges_pkey; Type: CONSTRAINT; Schema: public; Owner: remoteiq
--

ALTER TABLE ONLY public.login_challenges
    ADD CONSTRAINT login_challenges_pkey PRIMARY KEY (id);


--
-- Name: permissions permissions_key_key; Type: CONSTRAINT; Schema: public; Owner: remoteiq
--

ALTER TABLE ONLY public.permissions
    ADD CONSTRAINT permissions_key_key UNIQUE (key);


--
-- Name: permissions permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: remoteiq
--

ALTER TABLE ONLY public.permissions
    ADD CONSTRAINT permissions_pkey PRIMARY KEY (id);


--
-- Name: personal_tokens personal_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: remoteiq
--

ALTER TABLE ONLY public.personal_tokens
    ADD CONSTRAINT personal_tokens_pkey PRIMARY KEY (id);


--
-- Name: role_meta role_meta_pkey; Type: CONSTRAINT; Schema: public; Owner: remoteiq
--

ALTER TABLE ONLY public.role_meta
    ADD CONSTRAINT role_meta_pkey PRIMARY KEY (role_name);


--
-- Name: role_permissions role_permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: remoteiq
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_pkey PRIMARY KEY (role_id, permission_id);


--
-- Name: roles roles_name_key; Type: CONSTRAINT; Schema: public; Owner: remoteiq
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_name_key UNIQUE (name);


--
-- Name: roles roles_pkey; Type: CONSTRAINT; Schema: public; Owner: remoteiq
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_pkey PRIMARY KEY (id);


--
-- Name: sessions sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: remoteiq
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (id);


--
-- Name: support_legal support_legal_pkey; Type: CONSTRAINT; Schema: public; Owner: remoteiq
--

ALTER TABLE ONLY public.support_legal
    ADD CONSTRAINT support_legal_pkey PRIMARY KEY (id);


--
-- Name: support_legal_settings support_legal_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: remoteiq
--

ALTER TABLE ONLY public.support_legal_settings
    ADD CONSTRAINT support_legal_settings_pkey PRIMARY KEY (id);


--
-- Name: tickets tickets_pkey; Type: CONSTRAINT; Schema: public; Owner: remoteiq
--

ALTER TABLE ONLY public.tickets
    ADD CONSTRAINT tickets_pkey PRIMARY KEY (id);


--
-- Name: trusted_devices trusted_devices_pkey; Type: CONSTRAINT; Schema: public; Owner: remoteiq
--

ALTER TABLE ONLY public.trusted_devices
    ADD CONSTRAINT trusted_devices_pkey PRIMARY KEY (id);


--
-- Name: trusted_devices trusted_devices_user_id_device_fingerprint_key; Type: CONSTRAINT; Schema: public; Owner: remoteiq
--

ALTER TABLE ONLY public.trusted_devices
    ADD CONSTRAINT trusted_devices_user_id_device_fingerprint_key UNIQUE (user_id, device_fingerprint);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: remoteiq
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: remoteiq
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: agent_software_agent_id_idx; Type: INDEX; Schema: public; Owner: remoteiq
--

CREATE INDEX agent_software_agent_id_idx ON public.agent_software USING btree (agent_id);


--
-- Name: agent_software_dedupe; Type: INDEX; Schema: public; Owner: remoteiq
--

CREATE UNIQUE INDEX agent_software_dedupe ON public.agent_software USING btree (agent_id, lower(name), COALESCE(version, ''::text), COALESCE(publisher, ''::text), COALESCE(install_date, ''::text));


--
-- Name: agent_software_name_ci_idx; Type: INDEX; Schema: public; Owner: remoteiq
--

CREATE INDEX agent_software_name_ci_idx ON public.agent_software USING btree (lower(name));


--
-- Name: agents_agent_uuid_key; Type: INDEX; Schema: public; Owner: remoteiq
--

CREATE UNIQUE INDEX agents_agent_uuid_key ON public.agents USING btree (agent_uuid);


--
-- Name: agents_device_id_key; Type: INDEX; Schema: public; Owner: remoteiq
--

CREATE UNIQUE INDEX agents_device_id_key ON public.agents USING btree (device_id);


--
-- Name: agents_device_id_uk; Type: INDEX; Schema: public; Owner: remoteiq
--

CREATE UNIQUE INDEX agents_device_id_uk ON public.agents USING btree (device_id);


--
-- Name: agents_last_seen_idx; Type: INDEX; Schema: public; Owner: remoteiq
--

CREATE INDEX agents_last_seen_idx ON public.agents USING btree (last_seen_at DESC);


--
-- Name: agents_token_hash_idx; Type: INDEX; Schema: public; Owner: remoteiq
--

CREATE INDEX agents_token_hash_idx ON public.agents USING btree (token_hash);


--
-- Name: backup_jobs_started_at_desc; Type: INDEX; Schema: public; Owner: remoteiq
--

CREATE INDEX backup_jobs_started_at_desc ON public.backup_jobs USING btree (started_at DESC);


--
-- Name: backup_jobs_status_idx; Type: INDEX; Schema: public; Owner: remoteiq
--

CREATE INDEX backup_jobs_status_idx ON public.backup_jobs USING btree (status);


--
-- Name: check_assignments_device_id_idx; Type: INDEX; Schema: public; Owner: remoteiq
--

CREATE INDEX check_assignments_device_id_idx ON public.check_assignments USING btree (device_id);


--
-- Name: check_assignments_uk; Type: INDEX; Schema: public; Owner: remoteiq
--

CREATE UNIQUE INDEX check_assignments_uk ON public.check_assignments USING btree (device_id, COALESCE(NULLIF(dedupe_key, ''::text), ((lower(COALESCE(check_type, ''::text)) || '|'::text) || lower(COALESCE(check_name, ''::text)))));


--
-- Name: check_runs_assignment_id_idx; Type: INDEX; Schema: public; Owner: remoteiq
--

CREATE INDEX check_runs_assignment_id_idx ON public.check_runs USING btree (assignment_id);


--
-- Name: check_runs_created_at_idx; Type: INDEX; Schema: public; Owner: remoteiq
--

CREATE INDEX check_runs_created_at_idx ON public.check_runs USING btree (created_at);


--
-- Name: check_runs_device_id_idx; Type: INDEX; Schema: public; Owner: remoteiq
--

CREATE INDEX check_runs_device_id_idx ON public.check_runs USING btree (device_id);


--
-- Name: checks_type_name_uk; Type: INDEX; Schema: public; Owner: remoteiq
--

CREATE UNIQUE INDEX checks_type_name_uk ON public.checks USING btree (lower(type), lower(name));


--
-- Name: devices_client_idx; Type: INDEX; Schema: public; Owner: remoteiq
--

CREATE INDEX devices_client_idx ON public.devices USING btree (client);


--
-- Name: devices_site_idx; Type: INDEX; Schema: public; Owner: remoteiq
--

CREATE INDEX devices_site_idx ON public.devices USING btree (site);


--
-- Name: idx_agent_jobs_agent_status; Type: INDEX; Schema: public; Owner: remoteiq
--

CREATE INDEX idx_agent_jobs_agent_status ON public.agent_jobs USING btree (agent_id, status);


--
-- Name: idx_agent_software_agent; Type: INDEX; Schema: public; Owner: remoteiq
--

CREATE INDEX idx_agent_software_agent ON public.agent_software USING btree (agent_id);


--
-- Name: idx_agents_client; Type: INDEX; Schema: public; Owner: remoteiq
--

CREATE INDEX idx_agents_client ON public.agents USING btree (client);


--
-- Name: idx_agents_site; Type: INDEX; Schema: public; Owner: remoteiq
--

CREATE INDEX idx_agents_site ON public.agents USING btree (site);


--
-- Name: idx_backup_jobs_started_at; Type: INDEX; Schema: public; Owner: remoteiq
--

CREATE INDEX idx_backup_jobs_started_at ON public.backup_jobs USING btree (started_at DESC);


--
-- Name: idx_backup_jobs_status; Type: INDEX; Schema: public; Owner: remoteiq
--

CREATE INDEX idx_backup_jobs_status ON public.backup_jobs USING btree (status);


--
-- Name: idx_checks_enabled; Type: INDEX; Schema: public; Owner: remoteiq
--

CREATE INDEX idx_checks_enabled ON public.checks USING btree (enabled);


--
-- Name: idx_checks_type; Type: INDEX; Schema: public; Owner: remoteiq
--

CREATE INDEX idx_checks_type ON public.checks USING btree (type);


--
-- Name: idx_checks_type_name; Type: INDEX; Schema: public; Owner: remoteiq
--

CREATE INDEX idx_checks_type_name ON public.checks USING btree (type, name);


--
-- Name: idx_pat_user; Type: INDEX; Schema: public; Owner: remoteiq
--

CREATE INDEX idx_pat_user ON public.personal_tokens USING btree (user_id);


--
-- Name: idx_role_meta_lower_name; Type: INDEX; Schema: public; Owner: remoteiq
--

CREATE INDEX idx_role_meta_lower_name ON public.role_meta USING btree (lower(role_name));


--
-- Name: idx_sessions_user; Type: INDEX; Schema: public; Owner: remoteiq
--

CREATE INDEX idx_sessions_user ON public.sessions USING btree (user_id);


--
-- Name: idx_sessions_user_active; Type: INDEX; Schema: public; Owner: remoteiq
--

CREATE INDEX idx_sessions_user_active ON public.sessions USING btree (user_id) WHERE (revoked_at IS NULL);


--
-- Name: idx_sessions_user_lastseen; Type: INDEX; Schema: public; Owner: remoteiq
--

CREATE INDEX idx_sessions_user_lastseen ON public.sessions USING btree (user_id, last_seen_at DESC);


--
-- Name: idx_sessions_user_revoked; Type: INDEX; Schema: public; Owner: remoteiq
--

CREATE INDEX idx_sessions_user_revoked ON public.sessions USING btree (user_id, revoked_at);


--
-- Name: idx_tickets_assignee; Type: INDEX; Schema: public; Owner: remoteiq
--

CREATE INDEX idx_tickets_assignee ON public.tickets USING btree (assignee_id);


--
-- Name: idx_tickets_assignee_user; Type: INDEX; Schema: public; Owner: remoteiq
--

CREATE INDEX idx_tickets_assignee_user ON public.tickets USING btree (assignee_user_id);


--
-- Name: idx_tickets_created_at; Type: INDEX; Schema: public; Owner: remoteiq
--

CREATE INDEX idx_tickets_created_at ON public.tickets USING btree (created_at DESC);


--
-- Name: idx_tickets_customer_id; Type: INDEX; Schema: public; Owner: remoteiq
--

CREATE INDEX idx_tickets_customer_id ON public.tickets USING btree (customer_id);


--
-- Name: idx_tickets_device_id; Type: INDEX; Schema: public; Owner: remoteiq
--

CREATE INDEX idx_tickets_device_id ON public.tickets USING btree (device_id);


--
-- Name: idx_tickets_priority; Type: INDEX; Schema: public; Owner: remoteiq
--

CREATE INDEX idx_tickets_priority ON public.tickets USING btree (priority);


--
-- Name: idx_tickets_requester; Type: INDEX; Schema: public; Owner: remoteiq
--

CREATE INDEX idx_tickets_requester ON public.tickets USING btree (COALESCE(requester_email, requester_name));


--
-- Name: idx_tickets_status; Type: INDEX; Schema: public; Owner: remoteiq
--

CREATE INDEX idx_tickets_status ON public.tickets USING btree (status);


--
-- Name: idx_users_email; Type: INDEX; Schema: public; Owner: remoteiq
--

CREATE INDEX idx_users_email ON public.users USING btree (email);


--
-- Name: idx_users_lower_email; Type: INDEX; Schema: public; Owner: remoteiq
--

CREATE INDEX idx_users_lower_email ON public.users USING btree (lower(email));


--
-- Name: idx_users_lower_name; Type: INDEX; Schema: public; Owner: remoteiq
--

CREATE INDEX idx_users_lower_name ON public.users USING btree (lower(name));


--
-- Name: idx_users_role; Type: INDEX; Schema: public; Owner: remoteiq
--

CREATE INDEX idx_users_role ON public.users USING btree (role);


--
-- Name: idx_users_status; Type: INDEX; Schema: public; Owner: remoteiq
--

CREATE INDEX idx_users_status ON public.users USING btree (status);


--
-- Name: jobs_agent_uuid_idx; Type: INDEX; Schema: public; Owner: remoteiq
--

CREATE INDEX jobs_agent_uuid_idx ON public.jobs USING btree (agent_uuid);


--
-- Name: sessions_jti_unique; Type: INDEX; Schema: public; Owner: remoteiq
--

CREATE UNIQUE INDEX sessions_jti_unique ON public.sessions USING btree (jti);


--
-- Name: ux_agent_software_agent_name_ver; Type: INDEX; Schema: public; Owner: remoteiq
--

CREATE UNIQUE INDEX ux_agent_software_agent_name_ver ON public.agent_software USING btree (agent_id, lower(name), COALESCE(version, ''::text));


--
-- Name: ux_agents_device_id; Type: INDEX; Schema: public; Owner: remoteiq
--

CREATE UNIQUE INDEX ux_agents_device_id ON public.agents USING btree (device_id);


--
-- Name: agent_jobs agent_jobs_set_updated_at; Type: TRIGGER; Schema: public; Owner: remoteiq
--

CREATE TRIGGER agent_jobs_set_updated_at BEFORE UPDATE ON public.agent_jobs FOR EACH ROW EXECUTE FUNCTION public.agent_jobs_touch_updated_at();


--
-- Name: tickets tickets_touch_updated_at; Type: TRIGGER; Schema: public; Owner: remoteiq
--

CREATE TRIGGER tickets_touch_updated_at BEFORE UPDATE ON public.tickets FOR EACH ROW EXECUTE FUNCTION public._touch_updated_at();


--
-- Name: agents trg_agents_updated_at; Type: TRIGGER; Schema: public; Owner: remoteiq
--

CREATE TRIGGER trg_agents_updated_at BEFORE UPDATE ON public.agents FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: branding_settings trg_branding_settings_updated_at; Type: TRIGGER; Schema: public; Owner: remoteiq
--

CREATE TRIGGER trg_branding_settings_updated_at BEFORE UPDATE ON public.branding_settings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: role_meta trg_role_meta_touch_updated_at; Type: TRIGGER; Schema: public; Owner: remoteiq
--

CREATE TRIGGER trg_role_meta_touch_updated_at BEFORE UPDATE ON public.role_meta FOR EACH ROW EXECUTE FUNCTION public.role_meta_touch_updated_at();


--
-- Name: users trg_users_updated_at; Type: TRIGGER; Schema: public; Owner: remoteiq
--

CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.set_users_updated_at();


--
-- Name: users users_set_updated_at; Type: TRIGGER; Schema: public; Owner: remoteiq
--

CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: agent_jobs agent_jobs_agent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: remoteiq
--

ALTER TABLE ONLY public.agent_jobs
    ADD CONSTRAINT agent_jobs_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES public.agents(id) ON DELETE CASCADE;


--
-- Name: agent_software agent_software_agent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: remoteiq
--

ALTER TABLE ONLY public.agent_software
    ADD CONSTRAINT agent_software_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES public.agents(id) ON DELETE CASCADE;


--
-- Name: backup_job_logs backup_job_logs_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: remoteiq
--

ALTER TABLE ONLY public.backup_job_logs
    ADD CONSTRAINT backup_job_logs_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.backup_jobs(id) ON DELETE CASCADE;


--
-- Name: backup_job_manifests backup_job_manifests_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: remoteiq
--

ALTER TABLE ONLY public.backup_job_manifests
    ADD CONSTRAINT backup_job_manifests_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.backup_jobs(id) ON DELETE CASCADE;


--
-- Name: backup_restores backup_restores_backup_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: remoteiq
--

ALTER TABLE ONLY public.backup_restores
    ADD CONSTRAINT backup_restores_backup_id_fkey FOREIGN KEY (backup_id) REFERENCES public.backup_jobs(id) ON DELETE CASCADE;


--
-- Name: role_meta fk_role_meta_role; Type: FK CONSTRAINT; Schema: public; Owner: remoteiq
--

ALTER TABLE ONLY public.role_meta
    ADD CONSTRAINT fk_role_meta_role FOREIGN KEY (role_name) REFERENCES public.roles(name) ON DELETE CASCADE;


--
-- Name: tickets fk_tickets_assignee_user; Type: FK CONSTRAINT; Schema: public; Owner: remoteiq
--

ALTER TABLE ONLY public.tickets
    ADD CONSTRAINT fk_tickets_assignee_user FOREIGN KEY (assignee_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: job_results job_results_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: remoteiq
--

ALTER TABLE ONLY public.job_results
    ADD CONSTRAINT job_results_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.jobs(id) ON DELETE CASCADE;


--
-- Name: jobs jobs_agent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: remoteiq
--

ALTER TABLE ONLY public.jobs
    ADD CONSTRAINT jobs_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES public.agents(id) ON DELETE CASCADE;


--
-- Name: login_challenges login_challenges_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: remoteiq
--

ALTER TABLE ONLY public.login_challenges
    ADD CONSTRAINT login_challenges_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: personal_tokens personal_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: remoteiq
--

ALTER TABLE ONLY public.personal_tokens
    ADD CONSTRAINT personal_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: role_permissions role_permissions_permission_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: remoteiq
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_permission_id_fkey FOREIGN KEY (permission_id) REFERENCES public.permissions(id) ON DELETE CASCADE;


--
-- Name: role_permissions role_permissions_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: remoteiq
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id) ON DELETE CASCADE;


--
-- Name: sessions sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: remoteiq
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: trusted_devices trusted_devices_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: remoteiq
--

ALTER TABLE ONLY public.trusted_devices
    ADD CONSTRAINT trusted_devices_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict 3ZT0j3en4OS9PgAkZxRZi7j20QAg6f5fxaED2TciIhKV485bPYJhUgZrep1tDwS

