CREATE TABLE "records" (
	"collection" text NOT NULL,
	"id" text NOT NULL,
	"org_id" text,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "records_collection_id_pk" PRIMARY KEY("collection","id")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "profile" jsonb;--> statement-breakpoint
ALTER TABLE "records" ADD CONSTRAINT "records_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "records_org_idx" ON "records" USING btree ("collection","org_id");