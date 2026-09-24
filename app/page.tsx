import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/better-auth";
import { getLandingPath } from "@/lib/workspace";

export default async function RootPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    redirect("/sign-in");
  }

  redirect(await getLandingPath(session.user.id));
}
