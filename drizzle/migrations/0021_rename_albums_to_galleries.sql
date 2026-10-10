-- "Album" is now "gallery" everywhere. Every statement here is a metadata-only
-- rename: no rows move, foreign keys and cascades keep pointing at the same
-- tables, and the locks are instant. Index / constraint names are renamed to
-- match what drizzle-kit derives from the new table and column names, so the
-- next `drizzle-kit generate` sees no difference.
ALTER TABLE "albums" RENAME TO "galleries";--> statement-breakpoint
ALTER TABLE "album_groups" RENAME TO "gallery_groups";--> statement-breakpoint
ALTER TABLE "album_images" RENAME TO "gallery_images";--> statement-breakpoint
ALTER TABLE "gallery_groups" RENAME COLUMN "album_id" TO "gallery_id";--> statement-breakpoint
ALTER TABLE "gallery_images" RENAME COLUMN "album_id" TO "gallery_id";--> statement-breakpoint
ALTER INDEX "albums_pkey" RENAME TO "galleries_pkey";--> statement-breakpoint
ALTER INDEX "album_groups_pkey" RENAME TO "gallery_groups_pkey";--> statement-breakpoint
ALTER INDEX "album_images_pkey" RENAME TO "gallery_images_pkey";--> statement-breakpoint
ALTER INDEX "albums_organization_id_idx" RENAME TO "galleries_organization_id_idx";--> statement-breakpoint
ALTER INDEX "album_groups_album_id_idx" RENAME TO "gallery_groups_gallery_id_idx";--> statement-breakpoint
ALTER INDEX "album_images_album_id_created_at_idx" RENAME TO "gallery_images_gallery_id_created_at_idx";--> statement-breakpoint
ALTER INDEX "album_images_album_id_group_id_idx" RENAME TO "gallery_images_gallery_id_group_id_idx";--> statement-breakpoint
ALTER TABLE "galleries" RENAME CONSTRAINT "albums_organization_id_organization_id_fk" TO "galleries_organization_id_organization_id_fk";--> statement-breakpoint
ALTER TABLE "galleries" RENAME CONSTRAINT "albums_created_by_user_id_fk" TO "galleries_created_by_user_id_fk";--> statement-breakpoint
ALTER TABLE "gallery_groups" RENAME CONSTRAINT "album_groups_album_id_albums_id_fk" TO "gallery_groups_gallery_id_galleries_id_fk";--> statement-breakpoint
ALTER TABLE "gallery_images" RENAME CONSTRAINT "album_images_album_id_albums_id_fk" TO "gallery_images_gallery_id_galleries_id_fk";--> statement-breakpoint
ALTER TABLE "gallery_images" RENAME CONSTRAINT "album_images_group_id_album_groups_id_fk" TO "gallery_images_group_id_gallery_groups_id_fk";--> statement-breakpoint
ALTER TABLE "gallery_images" RENAME CONSTRAINT "album_images_created_by_user_id_fk" TO "gallery_images_created_by_user_id_fk";--> statement-breakpoint
-- A canvas gallery widget remembers its gallery in its own data blob. Only rows
-- that still carry the old key are touched, so re-running this is a no-op.
UPDATE "widgets" SET "data" = ("data" - 'albumId') || jsonb_build_object('galleryId', "data"->'albumId') WHERE "type" = 'gallery' AND "data" ? 'albumId';
