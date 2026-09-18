import { and, eq, lt } from "drizzle-orm";
import { db, cloudinaryCleanupJobs } from "@/lib/db";
import { cloudinary } from "@/lib/cloudinary";

const MAX_ATTEMPTS = 5;

type CleanupJob = { id: string; publicId: string; attempts?: number };

/** Durable record that an asset needs deleting — inserted synchronously in
 *  the same request as the DB row delete, so the cleanup survives even if
 *  the immediate after() attempt never runs (frozen function, Cloudinary
 *  outage). Returns the inserted rows so the caller can attempt them right
 *  away without a second read. */
export async function enqueueCloudinaryCleanup(publicIds: string[]): Promise<CleanupJob[]> {
  if (publicIds.length === 0) return [];
  return db
    .insert(cloudinaryCleanupJobs)
    .values(publicIds.map((publicId) => ({ publicId })))
    .returning({ id: cloudinaryCleanupJobs.id, publicId: cloudinaryCleanupJobs.publicId });
}

/**
 * A public id alone doesn't say which resource type the asset lives under, and
 * `destroy` silently reports "not found" when asked under the wrong one — so a
 * Word document (uploaded as `raw`, see lib/album-file.ts) would look
 * like a successful cleanup while the asset stayed billable forever. The job
 * row has no resource-type column, so the type is discovered by asking: images
 * first, since almost everything here is one, then the others only when the
 * answer was "not found".
 */
async function destroyAcrossResourceTypes(publicId: string): Promise<string> {
  for (const resourceType of ["image", "raw", "video"] as const) {
    const result = await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
    if (result.result !== "not found") return result.result;
  }
  return "not found";
}

/** Attempts each job's Cloudinary destroy once and records the outcome.
 *  Shared by the immediate after() best-effort pass (lib/actions/albums.ts)
 *  and the cron sweep (app/api/cron/cloudinary-cleanup/route.ts) — same
 *  function, two different triggers, so the retry bookkeeping can't drift
 *  between them. */
export async function runCleanupJobs(jobs: CleanupJob[]): Promise<void> {
  await Promise.all(
    jobs.map(async (job) => {
      try {
        const result = await destroyAcrossResourceTypes(job.publicId);
        // "not found" means the asset is already gone — that's the outcome
        // we wanted, not a failure to retry.
        if (result !== "ok" && result !== "not found") {
          throw new Error(`Cloudinary destroy returned "${result}"`);
        }
        await db
          .update(cloudinaryCleanupJobs)
          .set({ status: "done", updatedAt: new Date() })
          .where(eq(cloudinaryCleanupJobs.id, job.id));
      } catch (err) {
        const attempts = (job.attempts ?? 0) + 1;
        await db
          .update(cloudinaryCleanupJobs)
          .set({
            status: attempts >= MAX_ATTEMPTS ? "failed" : "pending",
            attempts,
            lastError: err instanceof Error ? err.message : String(err),
            updatedAt: new Date(),
          })
          .where(eq(cloudinaryCleanupJobs.id, job.id));
      }
    }),
  );
}

/** Cron entry point — picks up jobs the immediate after() pass never got to,
 *  or that failed and are still under the retry cap. Only sweeps jobs older
 *  than 2 minutes so it doesn't race the in-flight immediate attempt for a
 *  delete that just happened. */
export async function sweepPendingCloudinaryCleanup(limit = 200): Promise<{ processed: number }> {
  const cutoff = new Date(Date.now() - 2 * 60 * 1000);
  const jobs = await db
    .select({
      id: cloudinaryCleanupJobs.id,
      publicId: cloudinaryCleanupJobs.publicId,
      attempts: cloudinaryCleanupJobs.attempts,
    })
    .from(cloudinaryCleanupJobs)
    .where(and(eq(cloudinaryCleanupJobs.status, "pending"), lt(cloudinaryCleanupJobs.createdAt, cutoff)))
    .limit(limit);

  if (jobs.length === 0) return { processed: 0 };
  await runCleanupJobs(jobs);
  return { processed: jobs.length };
}
