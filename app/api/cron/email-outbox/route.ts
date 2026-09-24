import { NextResponse } from "next/server";
import { deliverOutbox } from "@/lib/notification-email";

// Daily retry sweep for notification emails that didn't go out in after()
// (Resend down, domain not verified yet, key missing at the time). The
// immediate send is best-effort; this is what guarantees delivery.
//
// Stricter than the cloudinary sweep: in production a missing CRON_SECRET
// refuses to run rather than leaving a public "send everyone's pending email"
// button. Locally (no secret) it runs, so it can be triggered by hand.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret && process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 503 });
  }
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await deliverOutbox();
  return NextResponse.json(result);
}
