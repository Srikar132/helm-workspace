import type { Metadata } from "next";
import { getUnsubscribeStatusAction } from "@/lib/actions/notification-preferences";
import { EMAIL_KIND_LABELS } from "@/lib/email-unsubscribe";
import { UnsubscribeButton } from "@/components/unsubscribe/unsubscribe-button";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Unsubscribe · Helm", robots: { index: false } };

interface UnsubscribePageProps {
  params: Promise<{ token: string }>;
}

// Like /share/docs/[token], this page authenticates nobody on purpose: it's
// opened from an inbox. The signed token is the whole authorization, and it
// can only switch one kind of email OFF for the person it was sent to.
export default async function UnsubscribePage({ params }: UnsubscribePageProps) {
  const { token } = await params;
  const status = await getUnsubscribeStatusAction(token);

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 text-card-foreground shadow-sm">
        {!status.valid ? (
          <>
            <h1 className="text-base font-semibold">This unsubscribe link isn&apos;t valid</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              It may have been cut off when copied. Use the link from the email itself, or change your email
              settings in Helm under Notifications.
            </p>
          </>
        ) : status.alreadyOff ? (
          <>
            <h1 className="text-base font-semibold">You&apos;re already unsubscribed</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Helm won&apos;t send you {EMAIL_KIND_LABELS[status.kind]}. You&apos;ll still see them in the bell.
            </p>
          </>
        ) : (
          <>
            <h1 className="text-base font-semibold">Turn off {EMAIL_KIND_LABELS[status.kind]}?</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              You&apos;ll still see these in the bell inside Helm. You can turn them back on any time under
              Notifications.
            </p>
            <UnsubscribeButton token={token} label={EMAIL_KIND_LABELS[status.kind]} />
          </>
        )}
      </div>
    </main>
  );
}
