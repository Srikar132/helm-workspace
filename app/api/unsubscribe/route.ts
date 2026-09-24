import { NextResponse } from "next/server";
import { unsubscribeWithTokenAction } from "@/lib/actions/notification-preferences";

/**
 * RFC 8058 one-click unsubscribe — the target of the List-Unsubscribe header
 * on notification email. Gmail/Yahoo POST `List-Unsubscribe=One-Click` here
 * straight from their UI, with no cookies, so like the /unsubscribe page this
 * authenticates nobody: the signed token is the authorization, and it can
 * only switch one kind of email off for one user.
 *
 * POST only. A GET would let link scanners unsubscribe people by prefetching.
 */
export async function POST(request: Request) {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const result = await unsubscribeWithTokenAction(token);
  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ unsubscribed: result.kind });
}
