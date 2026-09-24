import { cn } from "@/lib/utils";

/** Avatar for comment authors. `no-referrer` because Google avatar URLs 429
 *  any request carrying our Referer (see the progress tracker). */
export function CommentAvatar({
  name,
  image,
  className,
}: {
  name: string | null;
  image: string | null;
  className?: string;
}) {
  const initial = (name?.trim()[0] ?? "?").toUpperCase();
  return image ? (
    // eslint-disable-next-line @next/next/no-img-element -- remote OAuth avatar; next/image needs a fixed host allowlist
    <img
      src={image}
      alt=""
      referrerPolicy="no-referrer"
      draggable={false}
      className={cn("shrink-0 rounded-full object-cover", className)}
    />
  ) : (
    <span
      aria-hidden
      className={cn(
        "flex shrink-0 select-none items-center justify-center rounded-full bg-muted font-medium text-muted-foreground",
        className,
      )}
    >
      {initial}
    </span>
  );
}
