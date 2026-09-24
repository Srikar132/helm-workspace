import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { sql as drizzleSql } from "drizzle-orm";
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
    // Null for a document — only a photo has pixel dimensions.
    width: integer("width"),
    height: integer("height"),
    name: text("name"),
    // "image" | "pdf" | "word" — drives the tile's preview and whether a click
    // opens the lightbox, the PDF viewer, or a download. Plain text on purpose,
    // like entries.workType: the list lives in lib/album-file.ts, so a new kind
    // is a code change rather than a migration.
    kind: text("kind").notNull().default("image"),
    // Which Cloudinary resource type actually holds it: a photo and a PDF are
    // both "image" (the only type Cloudinary rasterises, which is where a PDF's
    // page-1 thumbnail comes from), a Word file is "raw". Recorded so a delete
    // is exact instead of leaning on the resource-type fallback in
    // lib/cloudinary-cleanup.ts.
    resourceType: text("resource_type").notNull().default("image"),
    // 0 for rows written before this column existed — the tile shows an em
    // dash rather than "0 B" (see formatFileSize).
    bytes: integer("bytes").notNull().default(0),
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

export const landmarks = pgTable(
  "landmarks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // URL-safe identity within the workspace, recomputed from `name` on
    // rename — unique PER WORKSPACE (two workspaces can each have "home"),
    // unlike the old globally-unique mark_name.
    slug: text("slug").notNull(),
    default: boolean("default").notNull().default(false),
    color: text("color").notNull().default("#ffffff"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("landmarks_organization_id_idx").on(table.organizationId),
    index("landmarks_user_id_idx").on(table.userId),
    uniqueIndex("landmarks_org_slug_unique").on(table.organizationId, table.slug),
  ],
);

/** Payload every notification carries. `href` is built server-side so the
 *  client never assembles a URL out of ids; `title`/`snippet` are plain text. */
export type NotificationPayload = { href: string; title: string; snippet?: string };

// One row per delivered in-app notification — mentions today, comment replies
// and AI alerts later, all written through lib/notifications.ts `notify()`.
// timestamptz ON PURPOSE, unlike every older table: those store server-local
// time read back tagged Z (see AGENTS.md §12); new tables start correct.
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    recipientId: text("recipient_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    actorType: text("actor_type").notNull(),
    // Null once the actor's account is deleted — the row still means something
    // to the recipient, it just renders as "Someone".
    actorId: text("actor_id").references(() => user.id, { onDelete: "set null" }),
    kind: text("kind").notNull(),
    sourceType: text("source_type").notNull(),
    sourceId: text("source_id").notNull(),
    payload: jsonb("payload").$type<NotificationPayload>().notNull(),
    // Idempotency: every insert is ON CONFLICT DO NOTHING against this, which
    // is what makes autosave bursts, the save retry and concurrent tabs safe
    // without transactions (Neon HTTP has none).
    dedupeKey: text("dedupe_key").notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("notifications_dedupe_key_uidx").on(table.dedupeKey),
    index("notifications_recipient_created_idx").on(table.recipientId, table.createdAt.desc(), table.id.desc()),
    index("notifications_recipient_unread_idx")
      .on(table.recipientId)
      .where(drizzleSql`${table.readAt} is null`),
  ],
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
    cloudinaryCleanupJobs,
    landmarks,
    notifications,
    ...authSchema,
  },
});

