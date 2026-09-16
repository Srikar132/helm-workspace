"use client";

import { QueryClient } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import { useState } from "react";
import NextTopLoader from "nextjs-toploader";
import { Toaster } from "@/components/ui/toast";
import { toastManager } from "@/lib/toast";

// Bump this whenever a persisted query's shape changes incompatibly — it
// invalidates every previously-persisted cache instead of a client hydrating
// stale-shaped data from localStorage against new code.
const CACHE_BUSTER = "v1";

// A real Storage-like object is required at construction time even during
// SSR — but branching WHICH PROVIDER COMPONENT renders based on
// `typeof window` (the earlier version of this file) shifts every
// downstream useId()-based id (base-ui's Checkbox/Menu, etc.) between the
// server and client render pass, since the two provider components aren't
// structurally identical. Always render the same PersistQueryClientProvider
// tree; only the storage backing the persister differs, and only that is
// actually SSR-unsafe.
function createNoopStorage() {
  return {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  };
}

/** One QueryClient for the whole session, mounted at the root layout — not
 *  per-page. A client created inside a page component (the old setup) gets
 *  torn down and rebuilt every time that page unmounts, which happens on
 *  every client-side route change (e.g. canvas -> /workspaces -> canvas).
 *  That wiped the entire cache on every nav, forcing every widget to refetch
 *  everything from zero even if it had just fetched seconds earlier — the
 *  actual cause of the repeated getDocProject/getAlbumPreview calls, not
 *  query complexity or a missing staleTime. */
export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Prefetched/shared data (doc projects, album previews, gmail
            // status, workspace members) is refreshed by our own writes via
            // explicit invalidateQueries calls, not by polling — a long
            // staleTime here just avoids redundant refetches for data we
            // already know is current.
            staleTime: 5 * 60 * 1000,
            // Switching browser tabs shouldn't re-trigger a full round trip
            // to Neon for data that isn't actually stale.
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  const [persister] = useState(() =>
    createSyncStoragePersister({
      storage: typeof window === "undefined" ? createNoopStorage() : window.localStorage,
      key: "helm-query-cache",
    }),
  );

  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        buster: CACHE_BUSTER,
        // Cache surviving a full reload is meant for "instant paint from
        // yesterday's data while a fresh fetch catches up," not indefinite
        // offline storage — a week-old entry is just noise.
        maxAge: 24 * 60 * 60 * 1000,
        dehydrateOptions: {
          // Mutations should never "resume" from a stale reload — only
          // queries (read caches) get persisted.
          shouldDehydrateMutation: () => false,
          // "board" used to be naturally cache-busted by a `date` key that
          // changed every day; now that the board shows all dates unscoped,
          // that key is static, so a persisted-but-stale board query would
          // otherwise shadow fresh SSR data on the next reload indefinitely.
          shouldDehydrateQuery: (query) =>
            query.state.status === "success" &&
            query.queryKey[0] !== "gmailMessages" &&
            query.queryKey[0] !== "board",
        },
      }}
    >
      {/* Route-change progress bar — the blue of the logo mark, with a soft
          glow so it reads as a highlight rather than a hard line. */}
      <NextTopLoader
        color="#4285F4"
        height={3}
        showSpinner={false}
        crawl
        crawlSpeed={200}
        speed={300}
        shadow="0 1px 6px rgba(66,133,244,0.55), 0 0 12px rgba(66,133,244,0.35)"
        zIndex={1600}
      />
      {children}
      <Toaster toastManager={toastManager} />
      {process.env.NODE_ENV === "development" && <ReactQueryDevtools initialIsOpen={false} />}
    </PersistQueryClientProvider>
  );
}
