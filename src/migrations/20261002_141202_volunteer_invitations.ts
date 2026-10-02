import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_registrations_role" AS ENUM('participant', 'volunteer');
  CREATE TYPE "public"."enum_volunteer_invitations_status" AS ENUM('pending', 'accepted', 'declined', 'withdrawn');
  CREATE TABLE "volunteer_invitations" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"event_id" integer NOT NULL,
  	"event_title" varchar NOT NULL,
  	"volunteer_id" integer NOT NULL,
  	"invited_by_id" integer NOT NULL,
  	"message" varchar,
  	"status" "enum_volunteer_invitations_status" DEFAULT 'pending' NOT NULL,
  	"registration_id" integer,
  	"decided_at" timestamp(3) with time zone,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "registrations" ADD COLUMN "role" "enum_registrations_role" DEFAULT 'participant';
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "volunteer_invitations_id" integer;
  ALTER TABLE "volunteer_invitations" ADD CONSTRAINT "volunteer_invitations_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "volunteer_invitations" ADD CONSTRAINT "volunteer_invitations_volunteer_id_users_id_fk" FOREIGN KEY ("volunteer_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "volunteer_invitations" ADD CONSTRAINT "volunteer_invitations_invited_by_id_users_id_fk" FOREIGN KEY ("invited_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "volunteer_invitations" ADD CONSTRAINT "volunteer_invitations_registration_id_registrations_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."registrations"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "volunteer_invitations_event_idx" ON "volunteer_invitations" USING btree ("event_id");
  CREATE INDEX "volunteer_invitations_volunteer_idx" ON "volunteer_invitations" USING btree ("volunteer_id");
  CREATE INDEX "volunteer_invitations_invited_by_idx" ON "volunteer_invitations" USING btree ("invited_by_id");
  CREATE INDEX "volunteer_invitations_registration_idx" ON "volunteer_invitations" USING btree ("registration_id");
  CREATE INDEX "volunteer_invitations_updated_at_idx" ON "volunteer_invitations" USING btree ("updated_at");
  CREATE INDEX "volunteer_invitations_created_at_idx" ON "volunteer_invitations" USING btree ("created_at");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_volunteer_invitations_fk" FOREIGN KEY ("volunteer_invitations_id") REFERENCES "public"."volunteer_invitations"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_volunteer_invitations_id_idx" ON "payload_locked_documents_rels" USING btree ("volunteer_invitations_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "volunteer_invitations" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "volunteer_invitations" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_volunteer_invitations_fk";
  
  DROP INDEX "payload_locked_documents_rels_volunteer_invitations_id_idx";
  ALTER TABLE "registrations" DROP COLUMN "role";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "volunteer_invitations_id";
  DROP TYPE "public"."enum_registrations_role";
  DROP TYPE "public"."enum_volunteer_invitations_status";`)
}
