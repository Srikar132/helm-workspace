import { Suspense } from "react";
import Image from "next/image";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/better-auth";
import { OAuthButtons } from "@/components/auth/oauth-buttons";
import { safeInternalPath } from "@/lib/utils";

/** `callbackURL` is where to land after sign-in — an invitation link sets it so
 *  the invitee returns to the invitation instead of being dropped on the
 *  workspaces list, which would silently abandon the invite. It comes from the
 *  query string, so it is validated as an in-app path before use.
 *  `invited` is the address the invitation was sent to, shown so the user knows
 *  which account to pick. */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackURL?: string; invited?: string }>;
}) {
  const { callbackURL: requestedCallback, invited } = await searchParams;
  const callbackURL = safeInternalPath(requestedCallback, "/");

  const session = await auth.api.getSession({ headers: await headers() });
  if (session) {
    redirect(callbackURL);
  }

  return (
    <main className="flex min-h-full flex-1 flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-8 shadow-sm">
        <div className="mb-8 text-center flex flex-col items-center">
          <div className="mb-4 relative h-14 w-14 overflow-hidden rounded-2xl bg-white/5 p-2 border border-white/10 shadow-lg">
            <Image
              src="/logo.png"
              alt="Helm Logo"
              width={56}
              height={56}
              className="h-full w-full object-contain"
              priority
            />
          </div>
          <h1 className="text-xl font-bold tracking-tight text-foreground">
            {invited ? "Sign in to accept your invitation" : "Sign in to Helm"}
          </h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {invited
              ? `Use ${invited} — the address the invitation was sent to. A new account is created automatically if you don't have one.`
              : "Your daily progress desk, controlled by you and your AI."}
          </p>
        </div>
        <Suspense fallback={null}>
          <OAuthButtons callbackURL={callbackURL} />
        </Suspense>
      </div>

      {/* Footer Links */}
      <footer className="mt-8 text-center text-xs text-muted-foreground flex items-center gap-4">
        <Link href="/terms" className="hover:text-foreground transition-colors">
          Terms of Service
        </Link>
        <span>&bull;</span>
        <Link href="/policies" className="hover:text-foreground transition-colors">
          Privacy & Policies
        </Link>
      </footer>
    </main>
  );
}
