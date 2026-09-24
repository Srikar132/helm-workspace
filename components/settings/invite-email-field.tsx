"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { suggestInviteEmailsAction } from "@/lib/actions/members";
import { unwrapAction } from "@/lib/query-utils";
import { inviteSuggestionsKey } from "@/lib/query-keys";

const SUGGEST_DEBOUNCE_MS = 200;
/** Below this the suggestion list is more noise than help, and the action
 *  refuses to search anyway. */
const MIN_QUERY_LENGTH = 2;

interface InviteEmailFieldProps {
  /** Suggestions exclude the current workspace's members and pending invites,
   *  so the same text yields different results per workspace. */
  slug: string;
  value: string;
  onChange: (value: string) => void;
  /** Enter in the field submits, same as the Invite button. */
  onSubmit: () => void;
  disabled: boolean;
  /** For an external <label htmlFor>. */
  id?: string;
}

/**
 * Email input with suggestions drawn from people the viewer already shares a
 * workspace with (see suggestInviteEmailsAction for why it isn't a global user
 * search). Anyone else can still be invited by typing their address in full.
 */
export function InviteEmailField({ slug, value, onChange, onSubmit, disabled, id }: InviteEmailFieldProps) {
  const listboxId = useId();
  const [debounced, setDebounced] = useState(value);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), SUGGEST_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [value]);

  const trimmed = debounced.trim();
  const { data } = useQuery({
    queryKey: inviteSuggestionsKey(slug, trimmed.toLowerCase()),
    queryFn: () => unwrapAction(suggestInviteEmailsAction(trimmed)),
    enabled: trimmed.length >= MIN_QUERY_LENGTH,
    // Who shares a workspace with you barely changes between keystrokes.
    staleTime: 60_000,
  });

  const suggestions = data?.suggestions ?? [];
  const showList = open && suggestions.length > 0;

  // Clicking anywhere else closes the list. Pointerdown rather than click so it
  // closes before a click elsewhere lands.
  useEffect(() => {
    if (!showList) return;
    function handlePointerDown(e: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [showList]);

  function choose(email: string) {
    onChange(email);
    setOpen(false);
    setActiveIndex(-1);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      // Enter picks the highlighted suggestion if the user arrowed to one;
      // otherwise it submits whatever they typed.
      if (showList && activeIndex >= 0) choose(suggestions[activeIndex].email);
      else onSubmit();
      return;
    }
    if (e.key === "Escape") {
      setOpen(false);
      setActiveIndex(-1);
      return;
    }
    if (!showList) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    }
  }

  return (
    <div ref={containerRef} className="relative min-w-0 flex-1">
      <input
        id={id}
        type="email"
        placeholder="teammate@company.com"
        value={value}
        disabled={disabled}
        autoComplete="off"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listboxId}
        aria-autocomplete="list"
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActiveIndex(-1);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        className="h-10 w-full rounded-xl border border-input bg-background px-3.5 text-[13.5px] text-foreground placeholder:text-muted-foreground outline-none transition-colors focus:border-ring focus:ring-3 focus:ring-ring/30 disabled:opacity-50 dark:bg-input/30"
      />

      {showList && (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute inset-x-0 top-full z-20 mt-1.5 overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-xl"
        >
          {suggestions.map((suggestion, index) => (
            <li key={suggestion.email} role="option" aria-selected={index === activeIndex}>
              <button
                type="button"
                // Mousedown, not click: the input's blur would otherwise close
                // the list before the click could register.
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(suggestion.email);
                }}
                onMouseEnter={() => setActiveIndex(index)}
                className={`flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left ${
                  index === activeIndex ? "bg-accent" : "hover:bg-accent/60"
                }`}
              >
                <span className="truncate text-[12.5px] text-foreground">{suggestion.email}</span>
                {suggestion.name && (
                  <span className="truncate text-[11px] text-muted-foreground">{suggestion.name}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
