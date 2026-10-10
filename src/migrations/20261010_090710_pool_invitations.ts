import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_pool_invitations_status" AS ENUM('pending', 'accepted', 'declined', 'withdrawn');
  CREATE TABLE "pool_invitations" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"user_id" integer NOT NULL,
  	"municipality_id" integer NOT NULL,
  	"invited_by_id" integer,
  	"message" varchar,
  	"status" "enum_pool_invitations_status" DEFAULT 'pending' NOT NULL,
  	"decided_at" timestamp(3) with time zone,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "pool_invitations_id" integer;
  ALTER TABLE "pool_invitations" ADD CONSTRAINT "pool_invitations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "pool_invitations" ADD CONSTRAINT "pool_invitations_municipality_id_municipalities_id_fk" FOREIGN KEY ("municipality_id") REFERENCES "public"."municipalities"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "pool_invitations" ADD CONSTRAINT "pool_invitations_invited_by_id_users_id_fk" FOREIGN KEY ("invited_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "pool_invitations_user_idx" ON "pool_invitations" USING btree ("user_id");
  CREATE INDEX "pool_invitations_municipality_idx" ON "pool_invitations" USING btree ("municipality_id");
  CREATE INDEX "pool_invitations_invited_by_idx" ON "pool_invitations" USING btree ("invited_by_id");
  CREATE INDEX "pool_invitations_updated_at_idx" ON "pool_invitations" USING btree ("updated_at");
  CREATE INDEX "pool_invitations_created_at_idx" ON "pool_invitations" USING btree ("created_at");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_pool_invitations_fk" FOREIGN KEY ("pool_invitations_id") REFERENCES "public"."pool_invitations"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_pool_invitations_id_idx" ON "payload_locked_documents_rels" USING btree ("pool_invitations_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "pool_invitations" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "pool_invitations" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_pool_invitations_fk";
  
  DROP INDEX "payload_locked_documents_rels_pool_invitations_id_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "pool_invitations_id";
  DROP TYPE "public"."enum_pool_invitations_status";`)
}
