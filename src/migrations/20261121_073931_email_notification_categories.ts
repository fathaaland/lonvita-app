import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_profiles_email_muted" AS ENUM('my_registrations', 'volunteering', 'my_events', 'my_requests', 'obec_requests');
  CREATE TABLE "profiles_email_muted" (
  	"order" integer NOT NULL,
  	"parent_id" integer NOT NULL,
  	"value" "enum_profiles_email_muted",
  	"id" serial PRIMARY KEY NOT NULL
  );
  
  ALTER TABLE "profiles_email_muted" ADD CONSTRAINT "profiles_email_muted_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "profiles_email_muted_order_idx" ON "profiles_email_muted" USING btree ("order");
  CREATE INDEX "profiles_email_muted_parent_idx" ON "profiles_email_muted" USING btree ("parent_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP TABLE "profiles_email_muted" CASCADE;
  DROP TYPE "public"."enum_profiles_email_muted";`)
}
