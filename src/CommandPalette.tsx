import { useEffect, useMemo, useRef, useState } from "react";
import { Icon, type IconName } from "./components/Icon";
import { cn } from "./lib/utils";

export interface PaletteCommand {
  id: string;
  label: string;
  section: string;
  keywords?: string;
  shortcut?: string;
  /** Hidden from the compact default list but available immediately by search. */
  searchOnly?: boolean;
  icon: IconName;
  run: () => void | Promise<void>;
}

const PALETTE_EXIT_MS = 220;
const PALETTE_ENTER_DELAY_MS = 20;

export function CommandPalette({
  open,
  commands,
  onOpenChange,
}: {
  open: boolean;
  commands: readonly PaletteCommand[];
  onOpenChange: (open: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [present, setPresent] = useState(open);
  const [entered, setEntered] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return commands.filter((command) => !command.searchOnly);
    const tokens = needle.split(/\s+/).filter(Boolean);
    return commands.filter((command) => {
      const haystack = `${command.label} ${command.section} ${command.keywords ?? ""}`.toLowerCase();
      return tokens.every((token) => haystack.includes(token));
    });
  }, [commands, query]);

  useEffect(() => {
    if (open) {
      setPresent(true);
      setEntered(false);
      const timer = setTimeout(() => setEntered(true), PALETTE_ENTER_DELAY_MS);
      return () => clearTimeout(timer);
    }
    setEntered(false);
    const timer = setTimeout(() => setPresent(false), PALETTE_EXIT_MS);
    return () => clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActiveIndex(0);
    setError(null);
    const timer = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (activeIndex >= filtered.length) setActiveIndex(0);
  }, [activeIndex, filtered.length]);

  if (!present) return null;

  const execute = async (command: PaletteCommand) => {
    setError(null);
    try {
      await command.run();
      onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Command failed");
    }
  };

  let previousSection: string | null = null;
  return (
    <div
      aria-hidden={!open}
      className={cn(
        "fixed inset-0 z-[100] flex items-center justify-center bg-background/45 p-3 backdrop-blur-[2px] transition-opacity duration-200 ease-out motion-reduce:transition-none",
        entered ? "opacity-100" : "pointer-events-none opacity-0",
      )}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onOpenChange(false);
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Sidebar command palette"
        className={cn(
          "w-full max-w-lg origin-top overflow-hidden rounded-xl border border-sidebar-border bg-popover text-popover-foreground shadow-2xl will-change-transform transition-[opacity,transform] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none",
          entered
            ? "translate-y-0 scale-100 opacity-100"
            : "-translate-y-2 scale-[0.97] opacity-0",
        )}
      >
        <div className="flex h-12 items-center gap-2 border-b border-sidebar-border px-3">
          <Icon name="Command" className="size-4 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                onOpenChange(false);
              } else if (event.key === "ArrowDown") {
                event.preventDefault();
                setActiveIndex((current) =>
                  filtered.length === 0 ? 0 : (current + 1) % filtered.length,
                );
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setActiveIndex((current) =>
                  filtered.length === 0
                    ? 0
                    : (current - 1 + filtered.length) % filtered.length,
                );
              } else if (event.key === "Enter" && filtered[activeIndex]) {
                event.preventDefault();
                void execute(filtered[activeIndex]);
              }
            }}
            placeholder="Type a command…"
            aria-label="Search sidebar commands"
            aria-controls="t3-command-list"
            aria-activedescendant={
              filtered[activeIndex]
                ? `t3-command-${filtered[activeIndex].id}`
                : undefined
            }
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <kbd className="rounded border border-sidebar-border px-1.5 py-0.5 font-mono text-2xs text-muted-foreground">
            Esc
          </kbd>
        </div>
        <div
          id="t3-command-list"
          role="listbox"
          className="max-h-[min(420px,60vh)] overflow-y-auto p-1.5"
        >
          {filtered.length === 0 ? (
            <p className="px-3 py-8 text-center text-xs text-muted-foreground">
              No matching commands
            </p>
          ) : (
            filtered.map((command, index) => {
              const showSection = command.section !== previousSection;
              previousSection = command.section;
              return (
                <div key={command.id}>
                  {showSection ? (
                    <p className="px-2.5 pb-1 pt-2 text-2xs font-medium uppercase tracking-wide text-muted-foreground/70">
                      {command.section}
                    </p>
                  ) : null}
                  <button
                    id={`t3-command-${command.id}`}
                    type="button"
                    role="option"
                    aria-selected={index === activeIndex}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => void execute(command)}
                    className={cn(
                      "flex h-9 w-full items-center gap-2 rounded-md px-2.5 text-left text-sm outline-none",
                      index === activeIndex
                        ? "bg-sidebar-accent text-foreground"
                        : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
                    )}
                  >
                    <Icon name={command.icon} className="size-4 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">
                      {command.label}
                    </span>
                    {command.shortcut ? (
                      <kbd className="shrink-0 rounded border border-sidebar-border px-1.5 py-0.5 font-mono text-2xs text-muted-foreground">
                        {command.shortcut}
                      </kbd>
                    ) : null}
                  </button>
                </div>
              );
            })
          )}
        </div>
        {error ? (
          <p role="alert" className="border-t border-sidebar-border px-3 py-2 text-xs text-destructive-text">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
