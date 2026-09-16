CREATE TABLE "file_folders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"library_id" uuid NOT NULL,
	"name" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "file_libraries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "library_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"library_id" uuid NOT NULL,
	"folder_id" uuid,
	"url" text NOT NULL,
	"cloudinary_public_id" text,
	"resource_type" text DEFAULT 'image' NOT NULL,
	"kind" text DEFAULT 'pdf' NOT NULL,
	"name" text NOT NULL,
	"bytes" integer DEFAULT 0 NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "file_folders" ADD CONSTRAINT "file_folders_library_id_file_libraries_id_fk" FOREIGN KEY ("library_id") REFERENCES "public"."file_libraries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_libraries" ADD CONSTRAINT "file_libraries_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_libraries" ADD CONSTRAINT "file_libraries_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_files" ADD CONSTRAINT "library_files_library_id_file_libraries_id_fk" FOREIGN KEY ("library_id") REFERENCES "public"."file_libraries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_files" ADD CONSTRAINT "library_files_folder_id_file_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."file_folders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_files" ADD CONSTRAINT "library_files_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "file_folders_library_id_idx" ON "file_folders" USING btree ("library_id");--> statement-breakpoint
CREATE INDEX "file_libraries_organization_id_idx" ON "file_libraries" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "library_files_library_id_created_at_idx" ON "library_files" USING btree ("library_id","created_at");--> statement-breakpoint
CREATE INDEX "library_files_library_id_folder_id_idx" ON "library_files" USING btree ("library_id","folder_id");