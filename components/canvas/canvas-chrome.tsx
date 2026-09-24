"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, LogOut, Plug, Plus, Settings } from "lucide-react";
import { authClient, useActiveOrganization, useListOrganizations, useSession } from "@/lib/auth-client";
import { NotificationBell } from "@/components/canvas/notification-bell";

function useClickOutside(onOutside: () => void) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onOutside();
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onOutside]); 

  return ref;
}

function WorkspaceSwitcher() {
  const router = useRouter();
  const { data: activeOrg } = useActiveOrganization();
  const { data: orgs } = useListOrganizations();
  const [open, setOpen] = useState(false);
  const ref = useClickOutside(() => setOpen(false));

  async function switchTo(organizationId: string, slug: string) {
    setOpen(false);
    // useActiveOrganization()'s cache only invalidates when the active org
    // changes through the client SDK (this call) — the server-side
    // setActiveOrganization in app/workspace/[slug]/page.tsx runs during the
    // next render and keeps direct/bookmarked URLs correct, but doesn't
    // tell this already-mounted component anything changed, which is why
    // the switcher kept showing the previous workspace's name after a
    // client-side navigation.
    await authClient.organization.setActive({ organizationId });
    router.push(`/workspace/${slug}`);
  }

  return (
    <div ref={ref} className="pointer-events-auto relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-full border border-white/[0.06] bg-[#131314]/85 px-2.5 py-1.5 shadow-lg backdrop-blur-md transition-colors hover:bg-[#131314] cursor-pointer"
      >
        <div className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white/10 p-0.5 border border-white/20">
          <img src="/logo.png" alt="Helm Logo" className="h-full w-full object-contain" />
        </div>
        <span className="max-w-[140px] truncate text-[13px] font-medium text-[#e8eaed]">
          {activeOrg?.name ?? "Helm"}
        </span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[#9aa0a6]" />
      </button>

      {open && (
        <div className="absolute left-0 top-[calc(100%+6px)] w-56 overflow-hidden rounded-2xl border border-white/[0.06] bg-[#131314] shadow-2xl">
          <div className="flex flex-col gap-0.5 p-1.5">
            {(orgs ?? []).map((org) => (
              <button
                key={org.id}
                type="button"
                onClick={() => switchTo(org.id, org.slug)}
                className="flex items-center gap-2 rounded-xl px-2.5 py-2 text-left text-[13px] text-[#e8eaed] hover:bg-white/5 cursor-pointer"
              >
                <span className="flex-1 truncate">{org.name}</span>
                {org.id === activeOrg?.id && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
              </button>
            ))}
          </div>
          <div className="border-t border-white/[0.06] p-1.5">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                router.push("/onboarding");
              }}
              className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-[13px] text-primary hover:bg-white/5 cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5" />
              New workspace
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function UserMenu() {
  const router = useRouter();
  const { data: session } = useSession();
  const { data: activeOrg } = useActiveOrganization();
  const [open, setOpen] = useState(false);
  const ref = useClickOutside(() => setOpen(false));

  const user = session?.user;
  const initial = user?.name?.[0]?.toUpperCase() ?? "?";

  return (
    <div ref={ref} className="pointer-events-auto relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border border-white/[0.06] bg-[#131314]/85 shadow-lg backdrop-blur-md transition-colors hover:bg-[#131314] cursor-pointer"
      >
        {user?.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={user.image} alt={user.name} referrerPolicy="no-referrer" className="h-full w-full object-cover" />
        ) : (
          <span className="text-[13px] font-medium text-[#e8eaed]">{initial}</span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-[calc(100%+6px)] w-52 overflow-hidden rounded-2xl border border-white/[0.06] bg-[#131314] shadow-2xl">
          <div className="border-b border-white/[0.06] px-3 py-2.5">
            <p className="truncate text-[13px] font-medium text-[#e8eaed]">{user?.name}</p>
            <p className="truncate text-[12px] text-[#9aa0a6]">{user?.email}</p>
          </div>
          <div className="flex flex-col gap-0.5 p-1.5">
            {/* Members, invites, rename and delete used to be a pinned canvas
                card. Disabled rather than hidden when there's no active org yet,
                so the menu doesn't reshuffle as the session resolves. */}
            <button
              type="button"
              disabled={!activeOrg?.slug}
              onClick={() => {
                setOpen(false);
                router.push(`/workspace/${activeOrg?.slug}/settings`);
              }}
              className="flex items-center gap-2 rounded-xl px-2.5 py-2 text-left text-[13px] text-[#e8eaed] hover:bg-white/5 disabled:cursor-default disabled:opacity-40 cursor-pointer"
            >
              <Settings className="h-3.5 w-3.5 text-[#9aa0a6]" />
              Workspace settings
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                router.push("/settings/connections");
              }}
              className="flex items-center gap-2 rounded-xl px-2.5 py-2 text-left text-[13px] text-[#e8eaed] hover:bg-white/5 cursor-pointer"
            >
              <Plug className="h-3.5 w-3.5 text-[#9aa0a6]" />
              Connections
            </button>
            <button
              type="button"
              onClick={async () => {
                setOpen(false);
                await authClient.signOut();
                router.push("/sign-in");
              }}
              className="flex items-center gap-2 rounded-xl px-2.5 py-2 text-left text-[13px] text-[#f28b82] hover:bg-white/5 cursor-pointer"
            >
              <LogOut className="h-3.5 w-3.5" />
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function CanvasChrome() {
  return (
    <div
      className="pointer-events-none absolute inset-0 z-20 flex items-start justify-between p-4"
      style={{
        paddingTop: "max(1rem, env(safe-area-inset-top))",
        paddingLeft: "max(1rem, env(safe-area-inset-left))",
        paddingRight: "max(1rem, env(safe-area-inset-right))",
      }}
    >
      <WorkspaceSwitcher />
      <div className="flex items-center gap-2">
        <NotificationBell />
        <UserMenu />
      </div>
    </div>
  );
}
