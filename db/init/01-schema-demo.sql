--
-- PostgreSQL database dump
--

\restrict xLxPb3pWrVXcaNRy99aTOXa2rOecOUlQsUAors6W2nR3fgxjpb1woDjboS9oaQH

-- Dumped from database version 16.14
-- Dumped by pg_dump version 16.14

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

--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
-- Name: uuid-ossp; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;


--
-- Name: EXTENSION "uuid-ossp"; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION "uuid-ossp" IS 'generate universally unique identifiers (UUIDs)';


--
-- Name: update_updated_at(); Type: FUNCTION; Schema: public; Owner: biggshots_demo
--

CREATE FUNCTION public.update_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


ALTER FUNCTION public.update_updated_at() OWNER TO biggshots_demo;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: admin_users; Type: TABLE; Schema: public; Owner: biggshots_demo
--

CREATE TABLE public.admin_users (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    email character varying(255) NOT NULL,
    password_hash character varying(255) NOT NULL,
    name character varying(255) DEFAULT 'Studio Owner'::character varying NOT NULL,
    role character varying(50) DEFAULT 'owner'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_login timestamp with time zone
);


ALTER TABLE public.admin_users OWNER TO biggshots_demo;

--
-- Name: blocked_dates; Type: TABLE; Schema: public; Owner: biggshots_demo
--

CREATE TABLE public.blocked_dates (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    date date NOT NULL,
    reason character varying(255),
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.blocked_dates OWNER TO biggshots_demo;

--
-- Name: bookings; Type: TABLE; Schema: public; Owner: biggshots_demo
--

CREATE TABLE public.bookings (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    client_id uuid,
    first_name character varying(100) NOT NULL,
    last_name character varying(100) NOT NULL,
    email character varying(255) NOT NULL,
    phone character varying(30),
    session_type character varying(100) NOT NULL,
    session_date date NOT NULL,
    session_time time without time zone,
    duration_hours numeric(4,1),
    location text,
    notes text,
    package_id uuid,
    status character varying(30) DEFAULT 'pending'::character varying NOT NULL,
    payment_status character varying(30) DEFAULT 'unpaid'::character varying NOT NULL,
    amount_total numeric(10,2),
    amount_paid numeric(10,2) DEFAULT 0,
    contract_signed boolean DEFAULT false NOT NULL,
    contract_signed_at timestamp with time zone,
    internal_notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    calendar_event_id character varying(255),
    enquiry_source character varying(100),
    enquiry_source_detail text
);


ALTER TABLE public.bookings OWNER TO biggshots_demo;

--
-- Name: client_loyalty; Type: TABLE; Schema: public; Owner: biggshots_demo
--

CREATE TABLE public.client_loyalty (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    client_id uuid NOT NULL,
    total_sessions integer DEFAULT 0 NOT NULL,
    current_cycle integer DEFAULT 0 NOT NULL,
    threshold integer DEFAULT 3 NOT NULL,
    discount_pct integer DEFAULT 10 NOT NULL,
    award_count integer DEFAULT 0 NOT NULL,
    last_award_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.client_loyalty OWNER TO biggshots_demo;

--
-- Name: clients; Type: TABLE; Schema: public; Owner: biggshots_demo
--

CREATE TABLE public.clients (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    email character varying(255) NOT NULL,
    password_hash character varying(255),
    first_name character varying(100) NOT NULL,
    last_name character varying(100) NOT NULL,
    phone character varying(30),
    address text,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_login timestamp with time zone,
    is_active boolean DEFAULT true NOT NULL,
    portal_enabled boolean DEFAULT false NOT NULL,
    welcome_sent_at timestamp with time zone,
    birthday date,
    session_anniversary date,
    anniversary_date date,
    marketing_consent boolean DEFAULT true,
    tags text[],
    loyalty_threshold integer DEFAULT 3,
    loyalty_discount integer DEFAULT 10,
    status character varying(20) DEFAULT 'active'::character varying,
    CONSTRAINT clients_status_check CHECK (((status)::text = ANY (ARRAY[('lead'::character varying)::text, ('prospect'::character varying)::text, ('active'::character varying)::text, ('delivered'::character varying)::text, ('archived'::character varying)::text])))
);


ALTER TABLE public.clients OWNER TO biggshots_demo;

--
-- Name: contract_templates; Type: TABLE; Schema: public; Owner: biggshots_demo
--

CREATE TABLE public.contract_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    contract_type text DEFAULT 'general'::text NOT NULL,
    body text NOT NULL,
    is_default boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.contract_templates OWNER TO biggshots_demo;

--
-- Name: contracts; Type: TABLE; Schema: public; Owner: biggshots_demo
--

CREATE TABLE public.contracts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid,
    client_id uuid NOT NULL,
    template_id uuid,
    contract_type text DEFAULT 'general'::text NOT NULL,
    title text NOT NULL,
    body text NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    client_name_signed text,
    client_signature text,
    signed_at timestamp with time zone,
    sent_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT contracts_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'sent'::text, 'signed'::text, 'declined'::text])))
);


ALTER TABLE public.contracts OWNER TO biggshots_demo;

--
-- Name: delivery_timeframes; Type: TABLE; Schema: public; Owner: biggshots_demo
--

CREATE TABLE public.delivery_timeframes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_type text NOT NULL,
    delivery_days integer NOT NULL,
    gallery_expiry_days integer DEFAULT 30 NOT NULL,
    label text NOT NULL
);


ALTER TABLE public.delivery_timeframes OWNER TO biggshots_demo;

--
-- Name: doc_counters; Type: TABLE; Schema: public; Owner: biggshots_demo
--

CREATE TABLE public.doc_counters (
    doc_type text NOT NULL,
    last_num integer DEFAULT 1000 NOT NULL
);


ALTER TABLE public.doc_counters OWNER TO biggshots_demo;

--
-- Name: email_log; Type: TABLE; Schema: public; Owner: biggshots_demo
--

CREATE TABLE public.email_log (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    to_email character varying(255) NOT NULL,
    subject character varying(500) NOT NULL,
    template character varying(100),
    status character varying(30) DEFAULT 'sent'::character varying NOT NULL,
    error text,
    sent_at timestamp with time zone DEFAULT now() NOT NULL,
    client_id uuid,
    body text,
    from_email text,
    created_at timestamp with time zone DEFAULT now(),
    project_id uuid,
    direction text DEFAULT 'outbound'::text,
    email_type text
);


ALTER TABLE public.email_log OWNER TO biggshots_demo;

--
-- Name: galleries; Type: TABLE; Schema: public; Owner: biggshots_demo
--

CREATE TABLE public.galleries (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    client_id uuid,
    booking_id uuid,
    title character varying(255) NOT NULL,
    slug character varying(255) NOT NULL,
    access_token character varying(255) DEFAULT encode(public.gen_random_bytes(32), 'hex'::text) NOT NULL,
    password_hash character varying(255),
    cover_image_id uuid,
    description text,
    session_date date,
    is_published boolean DEFAULT false NOT NULL,
    allow_downloads boolean DEFAULT true NOT NULL,
    allow_sharing boolean DEFAULT false NOT NULL,
    show_watermark boolean DEFAULT false NOT NULL,
    expires_at timestamp with time zone,
    download_count integer DEFAULT 0 NOT NULL,
    view_count integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    cover_photo_url text,
    display_style text DEFAULT 'standard'::text,
    delivered_at timestamp with time zone
);


ALTER TABLE public.galleries OWNER TO biggshots_demo;

--
-- Name: invoices; Type: TABLE; Schema: public; Owner: biggshots_demo
--

CREATE TABLE public.invoices (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    invoice_number character varying(50) NOT NULL,
    booking_id uuid,
    client_id uuid,
    client_name character varying(255),
    client_email character varying(255) NOT NULL,
    line_items jsonb DEFAULT '[]'::jsonb NOT NULL,
    subtotal numeric(10,2) NOT NULL,
    tax_rate numeric(5,2) DEFAULT 0 NOT NULL,
    tax_amount numeric(10,2) DEFAULT 0 NOT NULL,
    total numeric(10,2) NOT NULL,
    amount_paid numeric(10,2) DEFAULT 0 NOT NULL,
    status character varying(30) DEFAULT 'draft'::character varying NOT NULL,
    due_date date,
    paid_at timestamp with time zone,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    project_id uuid,
    quote_id uuid,
    deposit_pct numeric(5,2) DEFAULT 25,
    bank_name text DEFAULT 'Monzo'::text,
    monzo_link text,
    invoice_type text DEFAULT 'deposit'::text NOT NULL,
    bank_sort_code text,
    deposit_amt numeric(10,2) DEFAULT 0,
    sent_at timestamp with time zone,
    bank_account text,
    payment_ref text,
    client_message text,
    payment_method text
);


ALTER TABLE public.invoices OWNER TO biggshots_demo;

--
-- Name: packages; Type: TABLE; Schema: public; Owner: biggshots_demo
--

CREATE TABLE public.packages (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    name character varying(100) NOT NULL,
    slug character varying(100) NOT NULL,
    price numeric(10,2) NOT NULL,
    duration_text character varying(100),
    description text,
    features jsonb DEFAULT '[]'::jsonb NOT NULL,
    is_featured boolean DEFAULT false NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.packages OWNER TO biggshots_demo;

--
-- Name: password_reset_tokens; Type: TABLE; Schema: public; Owner: biggshots_demo
--

CREATE TABLE public.password_reset_tokens (
    id integer NOT NULL,
    client_id uuid,
    token character varying(255) NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.password_reset_tokens OWNER TO biggshots_demo;

--
-- Name: password_reset_tokens_id_seq; Type: SEQUENCE; Schema: public; Owner: biggshots_demo
--

CREATE SEQUENCE public.password_reset_tokens_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.password_reset_tokens_id_seq OWNER TO biggshots_demo;

--
-- Name: password_reset_tokens_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: biggshots_demo
--

ALTER SEQUENCE public.password_reset_tokens_id_seq OWNED BY public.password_reset_tokens.id;


--
-- Name: payment_installments; Type: TABLE; Schema: public; Owner: biggshots_demo
--

CREATE TABLE public.payment_installments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    plan_id uuid NOT NULL,
    project_id uuid NOT NULL,
    client_id uuid NOT NULL,
    installment_num integer NOT NULL,
    label text NOT NULL,
    amount numeric(10,2) NOT NULL,
    due_date date NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    is_deposit boolean DEFAULT false NOT NULL,
    is_non_refundable boolean DEFAULT false NOT NULL,
    paid_at timestamp with time zone,
    paid_amount numeric(10,2),
    payment_method text,
    payment_ref text,
    reminder_sent_7d boolean DEFAULT false,
    reminder_sent_1d boolean DEFAULT false,
    reminder_sent_overdue boolean DEFAULT false,
    invoice_id uuid,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    arrangement_agreed boolean DEFAULT false,
    arrangement_note text,
    CONSTRAINT payment_installments_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'sent'::text, 'paid'::text, 'overdue'::text, 'waived'::text])))
);


ALTER TABLE public.payment_installments OWNER TO biggshots_demo;

--
-- Name: payment_methods; Type: TABLE; Schema: public; Owner: biggshots_demo
--

CREATE TABLE public.payment_methods (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    method_type text DEFAULT 'bank_transfer'::text NOT NULL,
    bank_name text,
    sort_code text,
    account_no text,
    account_name text,
    payment_link text,
    notes text,
    is_default boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT payment_methods_method_type_check CHECK ((method_type = ANY (ARRAY['bank_transfer'::text, 'payment_link'::text, 'cash'::text, 'other'::text])))
);


ALTER TABLE public.payment_methods OWNER TO biggshots_demo;

--
-- Name: payment_plans; Type: TABLE; Schema: public; Owner: biggshots_demo
--

CREATE TABLE public.payment_plans (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    client_id uuid NOT NULL,
    total_amount numeric(10,2) NOT NULL,
    amount_paid numeric(10,2) DEFAULT 0 NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT payment_plans_status_check CHECK ((status = ANY (ARRAY['active'::text, 'completed'::text, 'cancelled'::text])))
);


ALTER TABLE public.payment_plans OWNER TO biggshots_demo;

--
-- Name: payments; Type: TABLE; Schema: public; Owner: biggshots_demo
--

CREATE TABLE public.payments (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    invoice_id uuid,
    booking_id uuid,
    order_id uuid,
    amount numeric(10,2) NOT NULL,
    currency character varying(3) DEFAULT 'GBP'::character varying NOT NULL,
    method character varying(30) NOT NULL,
    status character varying(30) DEFAULT 'pending'::character varying NOT NULL,
    provider_ref character varying(255),
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.payments OWNER TO biggshots_demo;

--
-- Name: photo_selections; Type: TABLE; Schema: public; Owner: biggshots_demo
--

CREATE TABLE public.photo_selections (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    gallery_id uuid NOT NULL,
    photo_id uuid NOT NULL,
    client_id uuid,
    list_type character varying(30) DEFAULT 'favourites'::character varying NOT NULL,
    selected_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.photo_selections OWNER TO biggshots_demo;

--
-- Name: photos; Type: TABLE; Schema: public; Owner: biggshots_demo
--

CREATE TABLE public.photos (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    gallery_id uuid NOT NULL,
    filename character varying(500) NOT NULL,
    original_name character varying(500),
    file_path text NOT NULL,
    thumb_path text,
    web_path text,
    file_size bigint,
    width integer,
    height integer,
    mime_type character varying(100),
    exif_data jsonb,
    face_data jsonb,
    ai_tags jsonb,
    sort_order integer DEFAULT 0 NOT NULL,
    is_cover boolean DEFAULT false NOT NULL,
    upload_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.photos OWNER TO biggshots_demo;

--
-- Name: portal_activity_log; Type: TABLE; Schema: public; Owner: biggshots_demo
--

CREATE TABLE public.portal_activity_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    client_id uuid,
    activity_type character varying(50) NOT NULL,
    reference_id uuid,
    meta jsonb,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.portal_activity_log OWNER TO biggshots_demo;

--
-- Name: print_orders; Type: TABLE; Schema: public; Owner: biggshots_demo
--

CREATE TABLE public.print_orders (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    client_id uuid,
    gallery_id uuid,
    prodigi_order_id character varying(255),
    status character varying(30) DEFAULT 'pending'::character varying NOT NULL,
    line_items jsonb DEFAULT '[]'::jsonb NOT NULL,
    shipping_name character varying(255),
    shipping_address jsonb,
    subtotal numeric(10,2),
    shipping_cost numeric(10,2),
    commission numeric(10,2),
    total numeric(10,2),
    tracking_number character varying(255),
    carrier character varying(100),
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.print_orders OWNER TO biggshots_demo;

--
-- Name: project_stage_log; Type: TABLE; Schema: public; Owner: biggshots_demo
--

CREATE TABLE public.project_stage_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    from_stage text,
    to_stage text NOT NULL,
    triggered_doc text,
    email_sent boolean DEFAULT false,
    override_used boolean DEFAULT false,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.project_stage_log OWNER TO biggshots_demo;

--
-- Name: projects; Type: TABLE; Schema: public; Owner: biggshots_demo
--

CREATE TABLE public.projects (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    booking_id uuid,
    client_id uuid NOT NULL,
    title text NOT NULL,
    stage text DEFAULT 'lead'::text NOT NULL,
    session_type text,
    session_date date,
    session_location text,
    notes text,
    internal_notes text,
    amount_quoted numeric(10,2),
    amount_invoiced numeric(10,2),
    deposit_paid numeric(10,2) DEFAULT 0,
    balance_paid numeric(10,2) DEFAULT 0,
    cover_photo text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    delivery_due_date date,
    gallery_expiry_date date,
    delivery_days integer,
    balance_due_date date,
    archived_reason text,
    follow_up_flag boolean DEFAULT false,
    follow_up_date date,
    follow_up_note text,
    CONSTRAINT projects_stage_check CHECK ((stage = ANY (ARRAY['lead'::text, 'quote_sent'::text, 'booked'::text, 'covered'::text, 'delivered'::text, 'completed'::text, 'archived'::text])))
);


ALTER TABLE public.projects OWNER TO biggshots_demo;

--
-- Name: promotions; Type: TABLE; Schema: public; Owner: biggshots_demo
--

CREATE TABLE public.promotions (
    id integer NOT NULL,
    type character varying(20) DEFAULT 'banner'::character varying,
    message text NOT NULL,
    eyebrow character varying(100),
    cta_label character varying(100),
    cta_link character varying(255),
    bg_colour character varying(20) DEFAULT 'gold'::character varying,
    show_countdown boolean DEFAULT false,
    active boolean DEFAULT false,
    starts_at timestamp with time zone,
    ends_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    last_broadcast_at timestamp with time zone,
    reminder_sent boolean DEFAULT false
);


ALTER TABLE public.promotions OWNER TO biggshots_demo;

--
-- Name: promotions_id_seq; Type: SEQUENCE; Schema: public; Owner: biggshots_demo
--

CREATE SEQUENCE public.promotions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.promotions_id_seq OWNER TO biggshots_demo;

--
-- Name: promotions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: biggshots_demo
--

ALTER SEQUENCE public.promotions_id_seq OWNED BY public.promotions.id;


--
-- Name: questionnaire_templates; Type: TABLE; Schema: public; Owner: biggshots_demo
--

CREATE TABLE public.questionnaire_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    session_type text,
    questions jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.questionnaire_templates OWNER TO biggshots_demo;

--
-- Name: questionnaires; Type: TABLE; Schema: public; Owner: biggshots_demo
--

CREATE TABLE public.questionnaires (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid,
    client_id uuid NOT NULL,
    template_id uuid,
    title text NOT NULL,
    questions jsonb DEFAULT '[]'::jsonb NOT NULL,
    answers jsonb DEFAULT '{}'::jsonb,
    status text DEFAULT 'draft'::text NOT NULL,
    sent_at timestamp with time zone,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    admin_notes text,
    CONSTRAINT questionnaires_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'sent'::text, 'completed'::text])))
);


ALTER TABLE public.questionnaires OWNER TO biggshots_demo;

--
-- Name: quote_addons; Type: TABLE; Schema: public; Owner: biggshots_demo
--

CREATE TABLE public.quote_addons (
    id integer NOT NULL,
    category character varying(50) NOT NULL,
    name character varying(200) NOT NULL,
    description text,
    price numeric(10,2) NOT NULL,
    unit character varying(50) DEFAULT 'fixed'::character varying,
    is_base boolean DEFAULT false,
    is_active boolean DEFAULT true,
    sort_order integer DEFAULT 0,
    created_at timestamp without time zone DEFAULT now()
);


ALTER TABLE public.quote_addons OWNER TO biggshots_demo;

--
-- Name: quote_addons_id_seq; Type: SEQUENCE; Schema: public; Owner: biggshots_demo
--

CREATE SEQUENCE public.quote_addons_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.quote_addons_id_seq OWNER TO biggshots_demo;

--
-- Name: quote_addons_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: biggshots_demo
--

ALTER SEQUENCE public.quote_addons_id_seq OWNED BY public.quote_addons.id;


--
-- Name: quotes; Type: TABLE; Schema: public; Owner: biggshots_demo
--

CREATE TABLE public.quotes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid,
    client_id uuid NOT NULL,
    quote_number text NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    line_items jsonb DEFAULT '[]'::jsonb NOT NULL,
    subtotal numeric(10,2) DEFAULT 0 NOT NULL,
    discount_pct numeric(5,2) DEFAULT 0,
    discount_amt numeric(10,2) DEFAULT 0,
    total numeric(10,2) DEFAULT 0 NOT NULL,
    valid_until date,
    notes text,
    client_message text,
    accepted_at timestamp with time zone,
    sent_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    archived_at timestamp with time zone,
    archive_reason text,
    CONSTRAINT quotes_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'sent'::text, 'accepted'::text, 'declined'::text, 'expired'::text])))
);


ALTER TABLE public.quotes OWNER TO biggshots_demo;

--
-- Name: scheduled_emails; Type: TABLE; Schema: public; Owner: biggshots_demo
--

CREATE TABLE public.scheduled_emails (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    client_id uuid,
    email_type text NOT NULL,
    scheduled_for timestamp with time zone NOT NULL,
    subject text NOT NULL,
    body text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    sent_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT scheduled_emails_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'sent'::text, 'failed'::text, 'cancelled'::text])))
);


ALTER TABLE public.scheduled_emails OWNER TO biggshots_demo;

--
-- Name: site_settings; Type: TABLE; Schema: public; Owner: biggshots_demo
--

CREATE TABLE public.site_settings (
    key character varying(100) NOT NULL,
    value text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.site_settings OWNER TO biggshots_demo;

--
-- Name: tasks; Type: TABLE; Schema: public; Owner: biggshots_demo
--

CREATE TABLE public.tasks (
    id integer NOT NULL,
    type character varying(50) NOT NULL,
    title text NOT NULL,
    description text,
    priority character varying(10) DEFAULT 'medium'::character varying,
    status character varying(20) DEFAULT 'open'::character varying,
    client_id uuid,
    booking_id uuid,
    project_id uuid,
    due_date date,
    dismissed_at timestamp with time zone,
    auto_resolve_on character varying(50),
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.tasks OWNER TO biggshots_demo;

--
-- Name: tasks_id_seq; Type: SEQUENCE; Schema: public; Owner: biggshots_demo
--

CREATE SEQUENCE public.tasks_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.tasks_id_seq OWNER TO biggshots_demo;

--
-- Name: tasks_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: biggshots_demo
--

ALTER SEQUENCE public.tasks_id_seq OWNED BY public.tasks.id;


--
-- Name: password_reset_tokens id; Type: DEFAULT; Schema: public; Owner: biggshots_demo
--

ALTER TABLE ONLY public.password_reset_tokens ALTER COLUMN id SET DEFAULT nextval('public.password_reset_tokens_id_seq'::regclass);


--
-- Name: promotions id; Type: DEFAULT; Schema: public; Owner: biggshots_demo
--

ALTER TABLE ONLY public.promotions ALTER COLUMN id SET DEFAULT nextval('public.promotions_id_seq'::regclass);


--
-- Name: quote_addons id; Type: DEFAULT; Schema: public; Owner: biggshots_demo
--

ALTER TABLE ONLY public.quote_addons ALTER COLUMN id SET DEFAULT nextval('public.quote_addons_id_seq'::regclass);


--
-- Name: tasks id; Type: DEFAULT; Schema: public; Owner: biggshots_demo
--

ALTER TABLE ONLY public.tasks ALTER COLUMN id SET DEFAULT nextval('public.tasks_id_seq'::regclass);


--
-- Name: admin_users admin_users_email_key; Type: CONSTRAINT; Schema: public; Owner: biggshots_demo
--

ALTER TABLE ONLY public.admin_users
    ADD CONSTRAINT admin_users_email_key UNIQUE (email);


--
-- Name: admin_users admin_users_pkey; Type: CONSTRAINT; Schema: public; Owner: biggshots_demo
--

ALTER TABLE ONLY public.admin_users
    ADD CONSTRAINT admin_users_pkey PRIMARY KEY (id);


--
-- Name: blocked_dates blocked_dates_date_key; Type: CONSTRAINT; Schema: public; Owner: biggshots_demo
--

ALTER TABLE ONLY public.blocked_dates
    ADD CONSTRAINT blocked_dates_date_key UNIQUE (date);


--
-- Name: blocked_dates blocked_dates_pkey; Type: CONSTRAINT; Schema: public; Owner: biggshots_demo
--

ALTER TABLE ONLY public.blocked_dates
    ADD CONSTRAINT blocked_dates_pkey PRIMARY KEY (id);


--
-- Name: bookings bookings_pkey; Type: CONSTRAINT; Schema: public; Owner: biggshots_demo
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_pkey PRIMARY KEY (id);


--
-- Name: client_loyalty client_loyalty_client_id_key; Type: CONSTRAINT; Schema: public; Owner: biggshots_demo
--

ALTER TABLE ONLY public.client_loyalty
    ADD CONSTRAINT client_loyalty_client_id_key UNIQUE (client_id);


--
-- Name: client_loyalty client_loyalty_pkey; Type: CONSTRAINT; Schema: public; Owner: biggshots_demo
--

ALTER TABLE ONLY public.client_loyalty
    ADD CONSTRAINT client_loyalty_pkey PRIMARY KEY (id);


--
-- Name: clients clients_email_key; Type: CONSTRAINT; Schema: public; Owner: biggshots_demo
--

ALTER TABLE ONLY public.clients
    ADD CONSTRAINT clients_email_key UNIQUE (email);


--
-- Name: clients clients_pkey; Type: CONSTRAINT; Schema: public; Owner: biggshots_demo
--

ALTER TABLE ONLY public.clients
    ADD CONSTRAINT clients_pkey PRIMARY KEY (id);


--
-- Name: contract_templates contract_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: biggshots_demo
--

ALTER TABLE ONLY public.contract_templates
    ADD CONSTRAINT contract_templates_pkey PRIMARY KEY (id);


--
-- Name: contracts contracts_pkey; Type: CONSTRAINT; Schema: public; Owner: biggshots_demo
--

ALTER TABLE ONLY public.contracts
    ADD CONSTRAINT contracts_pkey PRIMARY KEY (id);


--
-- Name: delivery_timeframes delivery_timeframes_pkey; Type: CONSTRAINT; Schema: public; Owner: biggshots_demo
--

ALTER TABLE ONLY public.delivery_timeframes
    ADD CONSTRAINT delivery_timeframes_pkey PRIMARY KEY (id);


--
-- Name: delivery_timeframes delivery_timeframes_session_type_key; Type: CONSTRAINT; Schema: public; Owner: biggshots_demo
--

ALTER TABLE ONLY public.delivery_timeframes
    ADD CONSTRAINT delivery_timeframes_session_type_key UNIQUE (session_type);


--
-- Name: doc_counters doc_counters_pkey; Type: CONSTRAINT; Schema: public; Owner: biggshots_demo
--

ALTER TABLE ONLY public.doc_counters
    ADD CONSTRAINT doc_counters_pkey PRIMARY KEY (doc_type);


--
-- Name: email_log email_log_pkey; Type: CONSTRAINT; Schema: public; Owner: biggshots_demo
--

ALTER TABLE ONLY public.email_log
    ADD CONSTRAINT email_log_pkey PRIMARY KEY (id);


--
-- Name: galleries galleries_access_token_key; Type: CONSTRAINT; Schema: public; Owner: biggshots_demo
--

ALTER TABLE ONLY public.galleries
    ADD CONSTRAINT galleries_access_token_key UNIQUE (access_token);


--
-- Name: galleries galleries_pkey; Type: CONSTRAINT; Schema: public; Owner: biggshots_demo
--

ALTER TABLE ONLY public.galleries
    ADD CONSTRAINT galleries_pkey PRIMARY KEY (id);


--
-- Name: galleries galleries_slug_key; Type: CONSTRAINT; Schema: public; Owner: biggshots_demo
--

ALTER TABLE ONLY public.galleries
    ADD CONSTRAINT galleries_slug_key UNIQUE (slug);


--
-- Name: invoices invoices_invoice_number_key; Type: CONSTRAINT; Schema: public; Owner: biggshots_demo
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_invoice_number_key UNIQUE (invoice_number);


--
-- Name: invoices invoices_pkey; Type: CONSTRAINT; Schema: public; Owner: biggshots_demo
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_pkey PRIMARY KEY (id);


--
-- Name: packages packages_pkey; Type: CONSTRAINT; Schema: public; Owner: biggshots_demo
--

ALTER TABLE ONLY public.packages
    ADD CONSTRAINT packages_pkey PRIMARY KEY (id);


--
-- Name: packages packages_slug_key; Type: CONSTRAINT; Schema: public; Owner: biggshots_demo
--

ALTER TABLE ONLY public.packages
    ADD CONSTRAINT packages_slug_key UNIQUE (slug);


--
-- Name: password_reset_tokens password_reset_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: biggshots_demo
--

ALTER TABLE ONLY public.password_reset_tokens
    ADD CONSTRAINT password_reset_tokens_pkey PRIMARY KEY (id);


--
-- Name: password_reset_tokens password_reset_tokens_token_key; Type: CONSTRAINT; Schema: public; Owner: biggshots_demo
--

ALTER TABLE ONLY public.password_reset_tokens
    ADD CONSTRAINT password_reset_tokens_token_key UNIQUE (token);


--
-- Name: payment_installments payment_installments_pkey; Type: CONSTRAINT; Schema: public; Owner: biggshots_demo
--

ALTER TABLE ONLY public.payment_installments
    ADD CONSTRAINT payment_installments_pkey PRIMARY KEY (id);


--
-- Name: payment_methods payment_methods_pkey; Type: CONSTRAINT; Schema: public; Owner: biggshots_demo
--

ALTER TABLE ONLY public.payment_methods
    ADD CONSTRAINT payment_methods_pkey PRIMARY KEY (id);


--
-- Name: payment_plans payment_plans_pkey; Type: CONSTRAINT; Schema: public; Owner: biggshots_demo
--

ALTER TABLE ONLY public.payment_plans
    ADD CONSTRAINT payment_plans_pkey PRIMARY KEY (id);


--
-- Name: payments payments_pkey; Type: CONSTRAINT; Schema: public; Owner: biggshots_demo
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_pkey PRIMARY KEY (id);


--
-- Name: photo_selections photo_selections_gallery_id_photo_id_client_id_list_type_key; Type: CONSTRAINT; Schema: public; Owner: biggshots_demo
--

ALTER TABLE ONLY public.photo_selections
    ADD CONSTRAINT photo_selections_gallery_id_photo_id_client_id_list_type_key UNIQUE (gallery_id, photo_id, client_id, list_type);


--
-- Name: photo_selections photo_selections_pkey; Type: CONSTRAINT; Schema: public; Owner: biggshots_demo
--

ALTER TABLE ONLY public.photo_selections
    ADD CONSTRAINT photo_selections_pkey PRIMARY KEY (id);


--
-- Name: photos photos_pkey; Type: CONSTRAINT; Schema: public; Owner: biggshots_demo
--

ALTER TABLE ONLY public.photos
    ADD CONSTRAINT photos_pkey PRIMARY KEY (id);


--
-- Name: portal_activity_log portal_activity_log_pkey; Type: CONSTRAINT; Schema: public; Owner: biggshots_demo
--

ALTER TABLE ONLY public.portal_activity_log
    ADD CONSTRAINT portal_activity_log_pkey PRIMARY KEY (id);


--
-- Name: print_orders print_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: biggshots_demo
--

ALTER TABLE ONLY public.print_orders
    ADD CONSTRAINT print_orders_pkey PRIMARY KEY (id);


--
-- Name: project_stage_log project_stage_log_pkey; Type: CONSTRAINT; Schema: public; Owner: biggshots_demo
--

ALTER TABLE ONLY public.project_stage_log
    ADD CONSTRAINT project_stage_log_pkey PRIMARY KEY (id);


--
-- Name: projects projects_pkey; Type: CONSTRAINT; Schema: public; Owner: biggshots_demo
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_pkey PRIMARY KEY (id);


--
-- Name: promotions promotions_pkey; Type: CONSTRAINT; Schema: public; Owner: biggshots_demo
--

ALTER TABLE ONLY public.promotions
    ADD CONSTRAINT promotions_pkey PRIMARY KEY (id);


--
-- Name: questionnaire_templates questionnaire_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: biggshots_demo
--

ALTER TABLE ONLY public.questionnaire_templates
    ADD CONSTRAINT questionnaire_templates_pkey PRIMARY KEY (id);


--
-- Name: questionnaires questionnaires_pkey; Type: CONSTRAINT; Schema: public; Owner: biggshots_demo
--

ALTER TABLE ONLY public.questionnaires
    ADD CONSTRAINT questionnaires_pkey PRIMARY KEY (id);


--
-- Name: quote_addons quote_addons_pkey; Type: CONSTRAINT; Schema: public; Owner: biggshots_demo
--

ALTER TABLE ONLY public.quote_addons
    ADD CONSTRAINT quote_addons_pkey PRIMARY KEY (id);


--
-- Name: quotes quotes_pkey; Type: CONSTRAINT; Schema: public; Owner: biggshots_demo
--

ALTER TABLE ONLY public.quotes
    ADD CONSTRAINT quotes_pkey PRIMARY KEY (id);


--
-- Name: quotes quotes_quote_number_key; Type: CONSTRAINT; Schema: public; Owner: biggshots_demo
--

ALTER TABLE ONLY public.quotes
    ADD CONSTRAINT quotes_quote_number_key UNIQUE (quote_number);


--
-- Name: scheduled_emails scheduled_emails_pkey; Type: CONSTRAINT; Schema: public; Owner: biggshots_demo
--

ALTER TABLE ONLY public.scheduled_emails
    ADD CONSTRAINT scheduled_emails_pkey PRIMARY KEY (id);


--
-- Name: site_settings site_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: biggshots_demo
--

ALTER TABLE ONLY public.site_settings
    ADD CONSTRAINT site_settings_pkey PRIMARY KEY (key);


--
-- Name: tasks tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: biggshots_demo
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_pkey PRIMARY KEY (id);


--
-- Name: idx_bookings_date; Type: INDEX; Schema: public; Owner: biggshots_demo
--

CREATE INDEX idx_bookings_date ON public.bookings USING btree (session_date);


--
-- Name: idx_bookings_email; Type: INDEX; Schema: public; Owner: biggshots_demo
--

CREATE INDEX idx_bookings_email ON public.bookings USING btree (email);


--
-- Name: idx_bookings_status; Type: INDEX; Schema: public; Owner: biggshots_demo
--

CREATE INDEX idx_bookings_status ON public.bookings USING btree (status);


--
-- Name: idx_pal_client; Type: INDEX; Schema: public; Owner: biggshots_demo
--

CREATE INDEX idx_pal_client ON public.portal_activity_log USING btree (client_id);


--
-- Name: idx_pal_created; Type: INDEX; Schema: public; Owner: biggshots_demo
--

CREATE INDEX idx_pal_created ON public.portal_activity_log USING btree (created_at);


--
-- Name: idx_pal_type; Type: INDEX; Schema: public; Owner: biggshots_demo
--

CREATE INDEX idx_pal_type ON public.portal_activity_log USING btree (activity_type);


--
-- Name: idx_photos_gallery; Type: INDEX; Schema: public; Owner: biggshots_demo
--

CREATE INDEX idx_photos_gallery ON public.photos USING btree (gallery_id);


--
-- Name: idx_photos_sort; Type: INDEX; Schema: public; Owner: biggshots_demo
--

CREATE INDEX idx_photos_sort ON public.photos USING btree (gallery_id, sort_order);


--
-- Name: idx_reset_tokens_token; Type: INDEX; Schema: public; Owner: biggshots_demo
--

CREATE INDEX idx_reset_tokens_token ON public.password_reset_tokens USING btree (token);


--
-- Name: idx_tasks_due_date; Type: INDEX; Schema: public; Owner: biggshots_demo
--

CREATE INDEX idx_tasks_due_date ON public.tasks USING btree (due_date);


--
-- Name: idx_tasks_status; Type: INDEX; Schema: public; Owner: biggshots_demo
--

CREATE INDEX idx_tasks_status ON public.tasks USING btree (status);


--
-- Name: idx_tasks_type; Type: INDEX; Schema: public; Owner: biggshots_demo
--

CREATE INDEX idx_tasks_type ON public.tasks USING btree (type);


--
-- Name: bookings trg_bookings_updated_at; Type: TRIGGER; Schema: public; Owner: biggshots_demo
--

CREATE TRIGGER trg_bookings_updated_at BEFORE UPDATE ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: galleries trg_galleries_updated_at; Type: TRIGGER; Schema: public; Owner: biggshots_demo
--

CREATE TRIGGER trg_galleries_updated_at BEFORE UPDATE ON public.galleries FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: invoices trg_invoices_updated_at; Type: TRIGGER; Schema: public; Owner: biggshots_demo
--

CREATE TRIGGER trg_invoices_updated_at BEFORE UPDATE ON public.invoices FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: bookings bookings_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: biggshots_demo
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE SET NULL;


--
-- Name: client_loyalty client_loyalty_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: biggshots_demo
--

ALTER TABLE ONLY public.client_loyalty
    ADD CONSTRAINT client_loyalty_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;


--
-- Name: contracts contracts_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: biggshots_demo
--

ALTER TABLE ONLY public.contracts
    ADD CONSTRAINT contracts_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;


--
-- Name: contracts contracts_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: biggshots_demo
--

ALTER TABLE ONLY public.contracts
    ADD CONSTRAINT contracts_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE SET NULL;


--
-- Name: email_log email_log_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: biggshots_demo
--

ALTER TABLE ONLY public.email_log
    ADD CONSTRAINT email_log_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;


--
-- Name: galleries galleries_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: biggshots_demo
--

ALTER TABLE ONLY public.galleries
    ADD CONSTRAINT galleries_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE SET NULL;


--
-- Name: galleries galleries_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: biggshots_demo
--

ALTER TABLE ONLY public.galleries
    ADD CONSTRAINT galleries_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE SET NULL;


--
-- Name: invoices invoices_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: biggshots_demo
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE SET NULL;


--
-- Name: invoices invoices_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: biggshots_demo
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE SET NULL;


--
-- Name: invoices invoices_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: biggshots_demo
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE SET NULL;


--
-- Name: invoices invoices_quote_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: biggshots_demo
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_quote_id_fkey FOREIGN KEY (quote_id) REFERENCES public.quotes(id) ON DELETE SET NULL;


--
-- Name: password_reset_tokens password_reset_tokens_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: biggshots_demo
--

ALTER TABLE ONLY public.password_reset_tokens
    ADD CONSTRAINT password_reset_tokens_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;


--
-- Name: payment_installments payment_installments_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: biggshots_demo
--

ALTER TABLE ONLY public.payment_installments
    ADD CONSTRAINT payment_installments_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;


--
-- Name: payment_installments payment_installments_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: biggshots_demo
--

ALTER TABLE ONLY public.payment_installments
    ADD CONSTRAINT payment_installments_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.invoices(id) ON DELETE SET NULL;


--
-- Name: payment_installments payment_installments_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: biggshots_demo
--

ALTER TABLE ONLY public.payment_installments
    ADD CONSTRAINT payment_installments_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES public.payment_plans(id) ON DELETE CASCADE;


--
-- Name: payment_installments payment_installments_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: biggshots_demo
--

ALTER TABLE ONLY public.payment_installments
    ADD CONSTRAINT payment_installments_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: payment_plans payment_plans_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: biggshots_demo
--

ALTER TABLE ONLY public.payment_plans
    ADD CONSTRAINT payment_plans_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;


--
-- Name: payment_plans payment_plans_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: biggshots_demo
--

ALTER TABLE ONLY public.payment_plans
    ADD CONSTRAINT payment_plans_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: payments payments_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: biggshots_demo
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE SET NULL;


--
-- Name: payments payments_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: biggshots_demo
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.invoices(id) ON DELETE SET NULL;


--
-- Name: photo_selections photo_selections_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: biggshots_demo
--

ALTER TABLE ONLY public.photo_selections
    ADD CONSTRAINT photo_selections_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE SET NULL;


--
-- Name: photo_selections photo_selections_gallery_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: biggshots_demo
--

ALTER TABLE ONLY public.photo_selections
    ADD CONSTRAINT photo_selections_gallery_id_fkey FOREIGN KEY (gallery_id) REFERENCES public.galleries(id) ON DELETE CASCADE;


--
-- Name: photo_selections photo_selections_photo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: biggshots_demo
--

ALTER TABLE ONLY public.photo_selections
    ADD CONSTRAINT photo_selections_photo_id_fkey FOREIGN KEY (photo_id) REFERENCES public.photos(id) ON DELETE CASCADE;


--
-- Name: photos photos_gallery_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: biggshots_demo
--

ALTER TABLE ONLY public.photos
    ADD CONSTRAINT photos_gallery_id_fkey FOREIGN KEY (gallery_id) REFERENCES public.galleries(id) ON DELETE CASCADE;


--
-- Name: portal_activity_log portal_activity_log_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: biggshots_demo
--

ALTER TABLE ONLY public.portal_activity_log
    ADD CONSTRAINT portal_activity_log_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;


--
-- Name: print_orders print_orders_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: biggshots_demo
--

ALTER TABLE ONLY public.print_orders
    ADD CONSTRAINT print_orders_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE SET NULL;


--
-- Name: print_orders print_orders_gallery_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: biggshots_demo
--

ALTER TABLE ONLY public.print_orders
    ADD CONSTRAINT print_orders_gallery_id_fkey FOREIGN KEY (gallery_id) REFERENCES public.galleries(id) ON DELETE SET NULL;


--
-- Name: project_stage_log project_stage_log_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: biggshots_demo
--

ALTER TABLE ONLY public.project_stage_log
    ADD CONSTRAINT project_stage_log_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: projects projects_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: biggshots_demo
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE SET NULL;


--
-- Name: projects projects_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: biggshots_demo
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;


--
-- Name: questionnaires questionnaires_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: biggshots_demo
--

ALTER TABLE ONLY public.questionnaires
    ADD CONSTRAINT questionnaires_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;


--
-- Name: questionnaires questionnaires_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: biggshots_demo
--

ALTER TABLE ONLY public.questionnaires
    ADD CONSTRAINT questionnaires_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE SET NULL;


--
-- Name: quotes quotes_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: biggshots_demo
--

ALTER TABLE ONLY public.quotes
    ADD CONSTRAINT quotes_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;


--
-- Name: quotes quotes_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: biggshots_demo
--

ALTER TABLE ONLY public.quotes
    ADD CONSTRAINT quotes_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE SET NULL;


--
-- Name: scheduled_emails scheduled_emails_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: biggshots_demo
--

ALTER TABLE ONLY public.scheduled_emails
    ADD CONSTRAINT scheduled_emails_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;


--
-- Name: tasks tasks_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: biggshots_demo
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE CASCADE;


--
-- Name: tasks tasks_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: biggshots_demo
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;


--
-- Name: tasks tasks_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: biggshots_demo
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict xLxPb3pWrVXcaNRy99aTOXa2rOecOUlQsUAors6W2nR3fgxjpb1woDjboS9oaQH

