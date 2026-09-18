DROP TABLE "file_folders" CASCADE;--> statement-breakpoint
DROP TABLE "file_libraries" CASCADE;--> statement-breakpoint
DROP TABLE "library_files" CASCADE;--> statement-breakpoint
ALTER TABLE "album_images" ADD COLUMN "kind" text DEFAULT 'image' NOT NULL;--> statement-breakpoint
ALTER TABLE "album_images" ADD COLUMN "resource_type" text DEFAULT 'image' NOT NULL;--> statement-breakpoint
ALTER TABLE "album_images" ADD COLUMN "bytes" integer DEFAULT 0 NOT NULL;