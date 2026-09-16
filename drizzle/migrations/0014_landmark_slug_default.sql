CREATE TABLE "landmarks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"default" boolean DEFAULT false NOT NULL,
	"color" text DEFAULT '#ffffff' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "landmarks" ADD CONSTRAINT "landmarks_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "landmarks" ADD CONSTRAINT "landmarks_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "landmarks_organization_id_idx" ON "landmarks" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "landmarks_user_id_idx" ON "landmarks" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "landmarks_org_slug_unique" ON "landmarks" USING btree ("organization_id","slug");