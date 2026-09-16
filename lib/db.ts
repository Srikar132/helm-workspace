import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import * as authSchema from "@/lib/auth-schema";
import { user, organization } from "@/lib/auth-schema";

export * from "@/lib/auth-schema";

export const taskStatusEnum = pgEnum("task_status", ["todo", "in_progress", "completed"]);
export type TaskStatus = (typeof taskStatusEnum.enumValues)[number];

export const entries = pgTable(
  "entries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    date: date("date").notNull(),
    title: text("title"),
    summary: text("summary").notNull(),
    status: taskStatusEnum("status").notNull().default("todo"),
    // Plain text, not a pg enum on purpose — the fixed list of work types
    // lives in lib/constants.ts (WORK_TYPES) so adding a new one is a code
    // change, not a migration.
    workType: text("work_type").notNull().default("task"),
    dueDate: date("due_date"),
    organizationId: text("organization_id").references(() => organization.id, {
      onDelete: "cascade",
    }),
    authorId: text("author_id").references(() => user.id, { onDelete: "set null" }),
    deletedAt: timestamp("deleted_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("entries_organization_id_date_idx").on(table.organizationId, table.date),
    index("entries_organization_id_date_status_idx").on(
      table.organizationId,
      table.date,
      table.status,
    ),
  ],
);

export type WidgetLayoutItem = {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  /** Omitted for a widget that sizes to its own content (e.g. a fresh
   *  markdown note) until the user explicitly drags a resize handle. */
  height?: number;
  /** Widget-specific persisted state — e.g. a markdown note's Tiptap content. */
  data?: Record<string, unknown>;
};

// Superseded by `widgets` below (one row per widget instead of one JSONB
// blob per user+org) — kept as-is, unused by app code, purely as a
// rollback/backup source until the new table's been live a while.
export const widgetLayouts = pgTable(
  "widget_layouts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    layout: jsonb("layout").notNull().$type<WidgetLayoutItem[]>().default([]),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("widget_layouts_user_id_org_id_uidx").on(table.userId, table.organizationId),
  ],
);

// One row per widget — repositioning/resizing one widget is a single-row
// UPDATE instead of rewriting every widget's data back through one shared
// JSONB array (widgetLayouts' actual bloat problem: moving any one widget
// meant serializing and rewriting all of them).
export const widgets = pgTable(
  "widgets",
  {
    // True row identity — kept separate from `id` below because a handful
    // of pinned default widgets (board-1, mail-summary-1, ...) reuse the
    // same app-level id for every user, so `id` alone can't be a primary
    // key without colliding across users.
    pk: uuid("pk").defaultRandom().primaryKey(),
    id: text("id").notNull(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    x: integer("x").notNull(),
    y: integer("y").notNull(),
    width: integer("width").notNull(),
    // Null = auto-height (sizes to content until manually resized) — same
    // meaning as WidgetLayoutItem["height"] being omitted.
    height: integer("height"),
    data: jsonb("data").$type<Record<string, unknown>>(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    // A widget belongs to the WORKSPACE, so its app-level id is unique per
    // organization — not per (organization, member). The old composite let the
    // pinned defaults exist once per member of the same org, which is how one
    // workspace ended up with two board-1 rows and forced the read to dedupe in
    // JavaScript. Migration 0013 collapses those and narrows this.
    uniqueIndex("widgets_id_org_uidx").on(table.id, table.organizationId),
    index("widgets_org_idx").on(table.organizationId),
  ],
);

/** A titled link — a GitHub repo, a resource, etc. `label` is optional; the
 *  URL is shown alone when there isn't one. */
export type DocLink = { label?: string; url: string };

export const docProjects = pgTable(
  "doc_projects",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    githubLinks: jsonb("github_links").notNull().$type<DocLink[]>().default([]),
    resourceLinks: jsonb("resource_links").notNull().$type<DocLink[]>().default([]),
    liveLink: text("live_link"),
    // Public share URL is always /share/docs/{shareToken} — the token
    // existing isn't itself enough to be visible; isPublic is the actual
    // gate, so unsharing doesn't require rotating/invalidating the token.
    shareToken: text("share_token").notNull(),
    isPublic: boolean("is_public").notNull().default(false),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("doc_projects_organization_id_idx").on(table.organizationId),
    uniqueIndex("doc_projects_share_token_uidx").on(table.shareToken),
  ],
);

export const docPages = pgTable(
  "doc_pages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    docProjectId: uuid("doc_project_id")
      .notNull()
      .references(() => docProjects.id, { onDelete: "cascade" }),
    title: text("title").notNull().default("Untitled"),
    content: jsonb("content").$type<Record<string, unknown>>(),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [index("doc_pages_doc_project_id_idx").on(table.docProjectId)],
);

export const albums = pgTable(
  "albums",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [index("albums_organization_id_idx").on(table.organizationId)],
);

export const albumGroups = pgTable(
  "album_groups",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    albumId: uuid("album_id")
      .notNull()
      .references(() => albums.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("album_groups_album_id_idx").on(table.albumId)],
);

export const albumImages = pgTable(
  "album_images",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    albumId: uuid("album_id")
      .notNull()
      .references(() => albums.id, { onDelete: "cascade" }),
    // Null = ungrouped — deleting a group falls its images back here rather
    // than deleting them (see onDelete: "set null").
    groupId: uuid("group_id").references(() => albumGroups.id, { onDelete: "set null" }),
    url: text("url").notNull(),
    width: integer("width"),
    height: integer("height"),
    name: text("name"),
    // Needed to delete the actual Cloudinary asset, not just this row —
    // the DB has no way to reach into Cloudinary from a public URL alone.
    cloudinaryPublicId: text("cloudinary_public_id"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("album_images_album_id_created_at_idx").on(table.albumId, table.createdAt),
    index("album_images_album_id_group_id_idx").on(table.albumId, table.groupId),
  ],
);

// Documents get the same organizing surface photos have (albums/groups/
// images), rather than existing only as single canvas cards. Kept as its own
// set of tables instead of a `type` column on the album tables: an album image
// is a URL with dimensions, a library file is a URL with a size, a kind, and
// the Cloudinary resource type it lives under — and every album query would
// have had to start filtering by type forever.
export const fileLibraries = pgTable(
  "file_libraries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [index("file_libraries_organization_id_idx").on(table.organizationId)],
);

export const fileFolders = pgTable(
  "file_folders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    libraryId: uuid("library_id")
      .notNull()
      .references(() => fileLibraries.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("file_folders_library_id_idx").on(table.libraryId)],
);

export const libraryFiles = pgTable(
  "library_files",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    libraryId: uuid("library_id")
      .notNull()
      .references(() => fileLibraries.id, { onDelete: "cascade" }),
    // Null = ungrouped — deleting a folder falls its documents back here
    // rather than deleting them, same rule album groups follow.
    folderId: uuid("folder_id").references(() => fileFolders.id, { onDelete: "set null" }),
    url: text("url").notNull(),
    // Needed to destroy the actual Cloudinary asset, not just this row.
    cloudinaryPublicId: text("cloudinary_public_id"),
    // Which Cloudinary resource type actually holds it: a PDF goes up as
    // "image" (the only type Cloudinary will rasterise, which is where the
    // page-1 thumbnail comes from), a Word file as "raw". Recorded so a delete
    // is exact instead of leaning on the resource-type fallback in
    // lib/cloudinary-cleanup.ts.
    resourceType: text("resource_type").notNull().default("image"),
    // "pdf" | "word" — drives the tile's icon and whether a click opens the
    // viewer or downloads. Plain text on purpose, like entries.workType: the
    // list lives in lib/canvas/document-file.ts, so a new kind is a code
    // change rather than a migration.
    kind: text("kind").notNull().default("pdf"),
    name: text("name").notNull(),
    bytes: integer("bytes").notNull().default(0),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("library_files_library_id_created_at_idx").on(table.libraryId, table.createdAt),
    index("library_files_library_id_folder_id_idx").on(table.libraryId, table.folderId),
  ],
);

export const cloudinaryCleanupStatusEnum = pgEnum("cloudinary_cleanup_status", ["pending", "done", "failed"]);

// Durable record of "this Cloudinary asset needs to be destroyed" — created
// synchronously in the same request that deletes the owning DB row, so the
// cleanup survives even if the best-effort after() attempt (see
// lib/actions/albums.ts) never runs (frozen function, Cloudinary outage,
// etc). The cron sweep (app/api/cron/cloudinary-cleanup/route.ts) is what
// actually guarantees delivery, not the after() call.
export const cloudinaryCleanupJobs = pgTable(
  "cloudinary_cleanup_jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    publicId: text("public_id").notNull(),
    status: cloudinaryCleanupStatusEnum("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [index("cloudinary_cleanup_jobs_status_idx").on(table.status, table.createdAt)],
);

const sql = neon(process.env.DATABASE_URL || "postgres://placeholder:placeholder@localhost/placeholder");

export const db = drizzle(sql, {
  schema: {
    entries,
    widgetLayouts,
    widgets,
    docProjects,
    docPages,
    albums,
    albumGroups,
    albumImages,
    fileLibraries,
    fileFolders,
    libraryFiles,
    cloudinaryCleanupJobs,
    ...authSchema,
  },
});

