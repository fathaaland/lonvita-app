import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_users_role" AS ENUM('admin', 'user');
  CREATE TYPE "public"."enum_profiles_gender" AS ENUM('zena', 'muz', 'jine', 'neuvedeno');
  CREATE TYPE "public"."enum_user_roles_role" AS ENUM('participant', 'municipality_admin', 'prescriber');
  CREATE TYPE "public"."enum_events_status" AS ENUM('active', 'full', 'finished', 'cancelled');
  CREATE TYPE "public"."enum_events_cancellation_policy" AS ENUM('none', 'cancel_24h', 'cancel_48h', 'cancel_7d');
  CREATE TYPE "public"."enum_registrations_status" AS ENUM('pending_payment', 'pending', 'approved', 'rejected', 'cancelled');
  CREATE TYPE "public"."enum_registrations_attendance_status" AS ENUM('not_marked', 'attended', 'no_show', 'excused');
  CREATE TYPE "public"."enum_registrations_payment_status" AS ENUM('none', 'paid', 'refunded', 'failed');
  CREATE TYPE "public"."enum_event_media_visibility" AS ENUM('private', 'municipality', 'public');
  CREATE TYPE "public"."enum_consents_type" AS ENUM('platform_terms', 'marketing');
  CREATE TABLE "users_tenants" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"tenant_id" integer NOT NULL
  );
  
  CREATE TABLE "users_sessions" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"created_at" timestamp(3) with time zone,
  	"expires_at" timestamp(3) with time zone NOT NULL
  );
  
  CREATE TABLE "users" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"role" "enum_users_role" DEFAULT 'user' NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"email" varchar NOT NULL,
  	"reset_password_token" varchar,
  	"reset_password_expiration" timestamp(3) with time zone,
  	"salt" varchar,
  	"hash" varchar,
  	"login_attempts" numeric DEFAULT 0,
  	"lock_until" timestamp(3) with time zone
  );
  
  CREATE TABLE "media" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"alt" varchar NOT NULL,
  	"prefix" varchar DEFAULT 'media',
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"url" varchar,
  	"thumbnail_u_r_l" varchar,
  	"filename" varchar,
  	"mime_type" varchar,
  	"filesize" numeric,
  	"width" numeric,
  	"height" numeric,
  	"focal_x" numeric,
  	"focal_y" numeric
  );
  
  CREATE TABLE "municipalities" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"name" varchar NOT NULL,
  	"description" varchar,
  	"admin_user_id" integer,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "event_categories" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"name" varchar NOT NULL,
  	"icon" varchar,
  	"color" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "profiles" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"user_id" integer NOT NULL,
  	"full_name" varchar NOT NULL,
  	"municipality_id" integer NOT NULL,
  	"payout_iban" varchar,
  	"phone" varchar,
  	"date_of_birth" timestamp(3) with time zone,
  	"gender" "enum_profiles_gender",
  	"home_area_id" integer,
  	"onboarding_completed" boolean DEFAULT false,
  	"is_volunteer" boolean DEFAULT false,
  	"volunteer_note" varchar,
  	"volunteer_since" timestamp(3) with time zone,
  	"deleted_at" timestamp(3) with time zone,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "profiles_texts" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer NOT NULL,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"text" varchar
  );
  
  CREATE TABLE "profiles_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"event_categories_id" integer
  );
  
  CREATE TABLE "user_roles" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"user_id" integer NOT NULL,
  	"municipality_id" integer NOT NULL,
  	"role" "enum_user_roles_role" NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "events" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"title" varchar NOT NULL,
  	"description" varchar,
  	"municipality_id" integer NOT NULL,
  	"date_time" timestamp(3) with time zone NOT NULL,
  	"location_text" varchar NOT NULL,
  	"lat" numeric,
  	"lng" numeric,
  	"capacity" numeric NOT NULL,
  	"organizer_id" integer NOT NULL,
  	"status" "enum_events_status" DEFAULT 'active' NOT NULL,
  	"category_id" integer NOT NULL,
  	"image_id" integer,
  	"is_volunteering" boolean DEFAULT false,
  	"is_paid" boolean DEFAULT false,
  	"price_cents" numeric,
  	"cancellation_policy" "enum_events_cancellation_policy" DEFAULT 'cancel_48h' NOT NULL,
  	"deleted_at" timestamp(3) with time zone,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "registrations" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"event_id" integer NOT NULL,
  	"user_id" integer NOT NULL,
  	"status" "enum_registrations_status" DEFAULT 'pending' NOT NULL,
  	"attendance_status" "enum_registrations_attendance_status" DEFAULT 'not_marked',
  	"attendance_marked_at" timestamp(3) with time zone,
  	"attendance_marked_by_id" integer,
  	"attendance_note" varchar,
  	"payment_status" "enum_registrations_payment_status" DEFAULT 'none' NOT NULL,
  	"stripe_session_id" varchar,
  	"stripe_payment_intent_id" varchar,
  	"amount_paid_cents" numeric,
  	"refunded_at" timestamp(3) with time zone,
  	"deleted_at" timestamp(3) with time zone,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "event_media" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"event_id" integer NOT NULL,
  	"media_id" integer NOT NULL,
  	"uploaded_by_id" integer NOT NULL,
  	"visibility" "enum_event_media_visibility" DEFAULT 'municipality' NOT NULL,
  	"deleted_at" timestamp(3) with time zone,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "event_feedback" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"registration_id" integer NOT NULL,
  	"satisfaction_rating" numeric NOT NULL,
  	"felt_welcome_rating" numeric,
  	"met_someone_new" boolean,
  	"came_alone" boolean,
  	"comment" varchar,
  	"deleted_at" timestamp(3) with time zone,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "auth_identities" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"user_id" integer NOT NULL,
  	"provider_subject" varchar NOT NULL,
  	"provider" varchar NOT NULL,
  	"connection" varchar,
  	"provider_type" varchar,
  	"email" varchar,
  	"email_verified" boolean DEFAULT false,
  	"last_login_at" timestamp(3) with time zone,
  	"last_synced_at" timestamp(3) with time zone,
  	"profile" jsonb,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "municipality_areas" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"municipality_id" integer NOT NULL,
  	"name" varchar NOT NULL,
  	"code" varchar NOT NULL,
  	"center_lat" numeric NOT NULL,
  	"center_lng" numeric NOT NULL,
  	"radius_m" numeric DEFAULT 400 NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "consents" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"user_id" integer NOT NULL,
  	"type" "enum_consents_type" NOT NULL,
  	"version" varchar NOT NULL,
  	"granted_at" timestamp(3) with time zone NOT NULL,
  	"revoked_at" timestamp(3) with time zone,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "audit_log" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"action" varchar NOT NULL,
  	"actor_id" integer,
  	"target_collection" varchar NOT NULL,
  	"target_id" varchar NOT NULL,
  	"municipality_id" integer,
  	"metadata" jsonb,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "notifications" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"user_id" integer NOT NULL,
  	"title" varchar NOT NULL,
  	"message" varchar NOT NULL,
  	"read_at" timestamp(3) with time zone,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "payload_kv" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"key" varchar NOT NULL,
  	"data" jsonb NOT NULL
  );
  
  CREATE TABLE "payload_locked_documents" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"global_slug" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "payload_locked_documents_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"users_id" integer,
  	"media_id" integer,
  	"municipalities_id" integer,
  	"event_categories_id" integer,
  	"profiles_id" integer,
  	"user_roles_id" integer,
  	"events_id" integer,
  	"registrations_id" integer,
  	"event_media_id" integer,
  	"event_feedback_id" integer,
  	"auth_identities_id" integer,
  	"municipality_areas_id" integer,
  	"consents_id" integer,
  	"audit_log_id" integer,
  	"notifications_id" integer
  );
  
  CREATE TABLE "payload_preferences" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"key" varchar,
  	"value" jsonb,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "payload_preferences_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"users_id" integer
  );
  
  CREATE TABLE "payload_migrations" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"name" varchar,
  	"batch" numeric,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "users_tenants" ADD CONSTRAINT "users_tenants_tenant_id_municipalities_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."municipalities"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "users_tenants" ADD CONSTRAINT "users_tenants_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "users_sessions" ADD CONSTRAINT "users_sessions_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "municipalities" ADD CONSTRAINT "municipalities_admin_user_id_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "profiles" ADD CONSTRAINT "profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "profiles" ADD CONSTRAINT "profiles_municipality_id_municipalities_id_fk" FOREIGN KEY ("municipality_id") REFERENCES "public"."municipalities"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "profiles" ADD CONSTRAINT "profiles_home_area_id_municipality_areas_id_fk" FOREIGN KEY ("home_area_id") REFERENCES "public"."municipality_areas"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "profiles_texts" ADD CONSTRAINT "profiles_texts_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "profiles_rels" ADD CONSTRAINT "profiles_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "profiles_rels" ADD CONSTRAINT "profiles_rels_event_categories_fk" FOREIGN KEY ("event_categories_id") REFERENCES "public"."event_categories"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_municipality_id_municipalities_id_fk" FOREIGN KEY ("municipality_id") REFERENCES "public"."municipalities"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "events" ADD CONSTRAINT "events_municipality_id_municipalities_id_fk" FOREIGN KEY ("municipality_id") REFERENCES "public"."municipalities"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "events" ADD CONSTRAINT "events_organizer_id_users_id_fk" FOREIGN KEY ("organizer_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "events" ADD CONSTRAINT "events_category_id_event_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."event_categories"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "events" ADD CONSTRAINT "events_image_id_media_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "registrations" ADD CONSTRAINT "registrations_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "registrations" ADD CONSTRAINT "registrations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "registrations" ADD CONSTRAINT "registrations_attendance_marked_by_id_users_id_fk" FOREIGN KEY ("attendance_marked_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "event_media" ADD CONSTRAINT "event_media_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "event_media" ADD CONSTRAINT "event_media_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "event_media" ADD CONSTRAINT "event_media_uploaded_by_id_users_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "event_feedback" ADD CONSTRAINT "event_feedback_registration_id_registrations_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."registrations"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "auth_identities" ADD CONSTRAINT "auth_identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "municipality_areas" ADD CONSTRAINT "municipality_areas_municipality_id_municipalities_id_fk" FOREIGN KEY ("municipality_id") REFERENCES "public"."municipalities"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "consents" ADD CONSTRAINT "consents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_municipality_id_municipalities_id_fk" FOREIGN KEY ("municipality_id") REFERENCES "public"."municipalities"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."payload_locked_documents"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_users_fk" FOREIGN KEY ("users_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_media_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_municipalities_fk" FOREIGN KEY ("municipalities_id") REFERENCES "public"."municipalities"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_event_categories_fk" FOREIGN KEY ("event_categories_id") REFERENCES "public"."event_categories"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_profiles_fk" FOREIGN KEY ("profiles_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_user_roles_fk" FOREIGN KEY ("user_roles_id") REFERENCES "public"."user_roles"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_events_fk" FOREIGN KEY ("events_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_registrations_fk" FOREIGN KEY ("registrations_id") REFERENCES "public"."registrations"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_event_media_fk" FOREIGN KEY ("event_media_id") REFERENCES "public"."event_media"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_event_feedback_fk" FOREIGN KEY ("event_feedback_id") REFERENCES "public"."event_feedback"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_auth_identities_fk" FOREIGN KEY ("auth_identities_id") REFERENCES "public"."auth_identities"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_municipality_areas_fk" FOREIGN KEY ("municipality_areas_id") REFERENCES "public"."municipality_areas"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_consents_fk" FOREIGN KEY ("consents_id") REFERENCES "public"."consents"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_audit_log_fk" FOREIGN KEY ("audit_log_id") REFERENCES "public"."audit_log"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_notifications_fk" FOREIGN KEY ("notifications_id") REFERENCES "public"."notifications"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_preferences_rels" ADD CONSTRAINT "payload_preferences_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."payload_preferences"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_preferences_rels" ADD CONSTRAINT "payload_preferences_rels_users_fk" FOREIGN KEY ("users_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "users_tenants_order_idx" ON "users_tenants" USING btree ("_order");
  CREATE INDEX "users_tenants_parent_id_idx" ON "users_tenants" USING btree ("_parent_id");
  CREATE INDEX "users_tenants_tenant_idx" ON "users_tenants" USING btree ("tenant_id");
  CREATE INDEX "users_sessions_order_idx" ON "users_sessions" USING btree ("_order");
  CREATE INDEX "users_sessions_parent_id_idx" ON "users_sessions" USING btree ("_parent_id");
  CREATE INDEX "users_updated_at_idx" ON "users" USING btree ("updated_at");
  CREATE INDEX "users_created_at_idx" ON "users" USING btree ("created_at");
  CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree ("email");
  CREATE INDEX "media_updated_at_idx" ON "media" USING btree ("updated_at");
  CREATE INDEX "media_created_at_idx" ON "media" USING btree ("created_at");
  CREATE UNIQUE INDEX "media_filename_idx" ON "media" USING btree ("filename");
  CREATE INDEX "municipalities_admin_user_idx" ON "municipalities" USING btree ("admin_user_id");
  CREATE INDEX "municipalities_updated_at_idx" ON "municipalities" USING btree ("updated_at");
  CREATE INDEX "municipalities_created_at_idx" ON "municipalities" USING btree ("created_at");
  CREATE INDEX "event_categories_updated_at_idx" ON "event_categories" USING btree ("updated_at");
  CREATE INDEX "event_categories_created_at_idx" ON "event_categories" USING btree ("created_at");
  CREATE UNIQUE INDEX "profiles_user_idx" ON "profiles" USING btree ("user_id");
  CREATE INDEX "profiles_municipality_idx" ON "profiles" USING btree ("municipality_id");
  CREATE INDEX "profiles_home_area_idx" ON "profiles" USING btree ("home_area_id");
  CREATE INDEX "profiles_updated_at_idx" ON "profiles" USING btree ("updated_at");
  CREATE INDEX "profiles_created_at_idx" ON "profiles" USING btree ("created_at");
  CREATE INDEX "profiles_texts_order_parent" ON "profiles_texts" USING btree ("order","parent_id");
  CREATE INDEX "profiles_rels_order_idx" ON "profiles_rels" USING btree ("order");
  CREATE INDEX "profiles_rels_parent_idx" ON "profiles_rels" USING btree ("parent_id");
  CREATE INDEX "profiles_rels_path_idx" ON "profiles_rels" USING btree ("path");
  CREATE INDEX "profiles_rels_event_categories_id_idx" ON "profiles_rels" USING btree ("event_categories_id");
  CREATE INDEX "user_roles_user_idx" ON "user_roles" USING btree ("user_id");
  CREATE INDEX "user_roles_municipality_idx" ON "user_roles" USING btree ("municipality_id");
  CREATE INDEX "user_roles_updated_at_idx" ON "user_roles" USING btree ("updated_at");
  CREATE INDEX "user_roles_created_at_idx" ON "user_roles" USING btree ("created_at");
  CREATE INDEX "events_municipality_idx" ON "events" USING btree ("municipality_id");
  CREATE INDEX "events_organizer_idx" ON "events" USING btree ("organizer_id");
  CREATE INDEX "events_category_idx" ON "events" USING btree ("category_id");
  CREATE INDEX "events_image_idx" ON "events" USING btree ("image_id");
  CREATE INDEX "events_updated_at_idx" ON "events" USING btree ("updated_at");
  CREATE INDEX "events_created_at_idx" ON "events" USING btree ("created_at");
  CREATE INDEX "registrations_event_idx" ON "registrations" USING btree ("event_id");
  CREATE INDEX "registrations_user_idx" ON "registrations" USING btree ("user_id");
  CREATE INDEX "registrations_attendance_marked_by_idx" ON "registrations" USING btree ("attendance_marked_by_id");
  CREATE INDEX "registrations_updated_at_idx" ON "registrations" USING btree ("updated_at");
  CREATE INDEX "registrations_created_at_idx" ON "registrations" USING btree ("created_at");
  CREATE UNIQUE INDEX "registrations_active_event_user_idx" ON "registrations" USING btree ("event_id","user_id") WHERE "registrations"."status" != 'cancelled';
  CREATE INDEX "event_media_event_idx" ON "event_media" USING btree ("event_id");
  CREATE INDEX "event_media_media_idx" ON "event_media" USING btree ("media_id");
  CREATE INDEX "event_media_uploaded_by_idx" ON "event_media" USING btree ("uploaded_by_id");
  CREATE INDEX "event_media_updated_at_idx" ON "event_media" USING btree ("updated_at");
  CREATE INDEX "event_media_created_at_idx" ON "event_media" USING btree ("created_at");
  CREATE UNIQUE INDEX "event_feedback_registration_idx" ON "event_feedback" USING btree ("registration_id");
  CREATE INDEX "event_feedback_updated_at_idx" ON "event_feedback" USING btree ("updated_at");
  CREATE INDEX "event_feedback_created_at_idx" ON "event_feedback" USING btree ("created_at");
  CREATE INDEX "auth_identities_user_idx" ON "auth_identities" USING btree ("user_id");
  CREATE UNIQUE INDEX "auth_identities_provider_subject_idx" ON "auth_identities" USING btree ("provider_subject");
  CREATE INDEX "auth_identities_provider_idx" ON "auth_identities" USING btree ("provider");
  CREATE INDEX "auth_identities_connection_idx" ON "auth_identities" USING btree ("connection");
  CREATE INDEX "auth_identities_email_idx" ON "auth_identities" USING btree ("email");
  CREATE INDEX "auth_identities_updated_at_idx" ON "auth_identities" USING btree ("updated_at");
  CREATE INDEX "auth_identities_created_at_idx" ON "auth_identities" USING btree ("created_at");
  CREATE INDEX "municipality_areas_municipality_idx" ON "municipality_areas" USING btree ("municipality_id");
  CREATE INDEX "municipality_areas_updated_at_idx" ON "municipality_areas" USING btree ("updated_at");
  CREATE INDEX "municipality_areas_created_at_idx" ON "municipality_areas" USING btree ("created_at");
  CREATE INDEX "consents_user_idx" ON "consents" USING btree ("user_id");
  CREATE INDEX "consents_updated_at_idx" ON "consents" USING btree ("updated_at");
  CREATE INDEX "consents_created_at_idx" ON "consents" USING btree ("created_at");
  CREATE INDEX "audit_log_actor_idx" ON "audit_log" USING btree ("actor_id");
  CREATE INDEX "audit_log_municipality_idx" ON "audit_log" USING btree ("municipality_id");
  CREATE INDEX "audit_log_updated_at_idx" ON "audit_log" USING btree ("updated_at");
  CREATE INDEX "audit_log_created_at_idx" ON "audit_log" USING btree ("created_at");
  CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id");
  CREATE INDEX "notifications_updated_at_idx" ON "notifications" USING btree ("updated_at");
  CREATE INDEX "notifications_created_at_idx" ON "notifications" USING btree ("created_at");
  CREATE UNIQUE INDEX "payload_kv_key_idx" ON "payload_kv" USING btree ("key");
  CREATE INDEX "payload_locked_documents_global_slug_idx" ON "payload_locked_documents" USING btree ("global_slug");
  CREATE INDEX "payload_locked_documents_updated_at_idx" ON "payload_locked_documents" USING btree ("updated_at");
  CREATE INDEX "payload_locked_documents_created_at_idx" ON "payload_locked_documents" USING btree ("created_at");
  CREATE INDEX "payload_locked_documents_rels_order_idx" ON "payload_locked_documents_rels" USING btree ("order");
  CREATE INDEX "payload_locked_documents_rels_parent_idx" ON "payload_locked_documents_rels" USING btree ("parent_id");
  CREATE INDEX "payload_locked_documents_rels_path_idx" ON "payload_locked_documents_rels" USING btree ("path");
  CREATE INDEX "payload_locked_documents_rels_users_id_idx" ON "payload_locked_documents_rels" USING btree ("users_id");
  CREATE INDEX "payload_locked_documents_rels_media_id_idx" ON "payload_locked_documents_rels" USING btree ("media_id");
  CREATE INDEX "payload_locked_documents_rels_municipalities_id_idx" ON "payload_locked_documents_rels" USING btree ("municipalities_id");
  CREATE INDEX "payload_locked_documents_rels_event_categories_id_idx" ON "payload_locked_documents_rels" USING btree ("event_categories_id");
  CREATE INDEX "payload_locked_documents_rels_profiles_id_idx" ON "payload_locked_documents_rels" USING btree ("profiles_id");
  CREATE INDEX "payload_locked_documents_rels_user_roles_id_idx" ON "payload_locked_documents_rels" USING btree ("user_roles_id");
  CREATE INDEX "payload_locked_documents_rels_events_id_idx" ON "payload_locked_documents_rels" USING btree ("events_id");
  CREATE INDEX "payload_locked_documents_rels_registrations_id_idx" ON "payload_locked_documents_rels" USING btree ("registrations_id");
  CREATE INDEX "payload_locked_documents_rels_event_media_id_idx" ON "payload_locked_documents_rels" USING btree ("event_media_id");
  CREATE INDEX "payload_locked_documents_rels_event_feedback_id_idx" ON "payload_locked_documents_rels" USING btree ("event_feedback_id");
  CREATE INDEX "payload_locked_documents_rels_auth_identities_id_idx" ON "payload_locked_documents_rels" USING btree ("auth_identities_id");
  CREATE INDEX "payload_locked_documents_rels_municipality_areas_id_idx" ON "payload_locked_documents_rels" USING btree ("municipality_areas_id");
  CREATE INDEX "payload_locked_documents_rels_consents_id_idx" ON "payload_locked_documents_rels" USING btree ("consents_id");
  CREATE INDEX "payload_locked_documents_rels_audit_log_id_idx" ON "payload_locked_documents_rels" USING btree ("audit_log_id");
  CREATE INDEX "payload_locked_documents_rels_notifications_id_idx" ON "payload_locked_documents_rels" USING btree ("notifications_id");
  CREATE INDEX "payload_preferences_key_idx" ON "payload_preferences" USING btree ("key");
  CREATE INDEX "payload_preferences_updated_at_idx" ON "payload_preferences" USING btree ("updated_at");
  CREATE INDEX "payload_preferences_created_at_idx" ON "payload_preferences" USING btree ("created_at");
  CREATE INDEX "payload_preferences_rels_order_idx" ON "payload_preferences_rels" USING btree ("order");
  CREATE INDEX "payload_preferences_rels_parent_idx" ON "payload_preferences_rels" USING btree ("parent_id");
  CREATE INDEX "payload_preferences_rels_path_idx" ON "payload_preferences_rels" USING btree ("path");
  CREATE INDEX "payload_preferences_rels_users_id_idx" ON "payload_preferences_rels" USING btree ("users_id");
  CREATE INDEX "payload_migrations_updated_at_idx" ON "payload_migrations" USING btree ("updated_at");
  CREATE INDEX "payload_migrations_created_at_idx" ON "payload_migrations" USING btree ("created_at");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP TABLE "users_tenants" CASCADE;
  DROP TABLE "users_sessions" CASCADE;
  DROP TABLE "users" CASCADE;
  DROP TABLE "media" CASCADE;
  DROP TABLE "municipalities" CASCADE;
  DROP TABLE "event_categories" CASCADE;
  DROP TABLE "profiles" CASCADE;
  DROP TABLE "profiles_texts" CASCADE;
  DROP TABLE "profiles_rels" CASCADE;
  DROP TABLE "user_roles" CASCADE;
  DROP TABLE "events" CASCADE;
  DROP TABLE "registrations" CASCADE;
  DROP TABLE "event_media" CASCADE;
  DROP TABLE "event_feedback" CASCADE;
  DROP TABLE "auth_identities" CASCADE;
  DROP TABLE "municipality_areas" CASCADE;
  DROP TABLE "consents" CASCADE;
  DROP TABLE "audit_log" CASCADE;
  DROP TABLE "notifications" CASCADE;
  DROP TABLE "payload_kv" CASCADE;
  DROP TABLE "payload_locked_documents" CASCADE;
  DROP TABLE "payload_locked_documents_rels" CASCADE;
  DROP TABLE "payload_preferences" CASCADE;
  DROP TABLE "payload_preferences_rels" CASCADE;
  DROP TABLE "payload_migrations" CASCADE;
  DROP TYPE "public"."enum_users_role";
  DROP TYPE "public"."enum_profiles_gender";
  DROP TYPE "public"."enum_user_roles_role";
  DROP TYPE "public"."enum_events_status";
  DROP TYPE "public"."enum_events_cancellation_policy";
  DROP TYPE "public"."enum_registrations_status";
  DROP TYPE "public"."enum_registrations_attendance_status";
  DROP TYPE "public"."enum_registrations_payment_status";
  DROP TYPE "public"."enum_event_media_visibility";
  DROP TYPE "public"."enum_consents_type";`)
}
