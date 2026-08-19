import { useEffect, useMemo, useRef, useState } from "react";
import type { PaletteCommand } from "./CommandPalette";
import { Icon } from "./components/Icon";
import { cn } from "./lib/utils";

export type CommandShortcuts = Record<string, string>;

const ENTER_DELAY_MS = 20;
const EXIT_MS = 220;

export function shortcutFromEvent(event: KeyboardEvent | React.KeyboardEvent): string | null {
  const key = event.key.toLowerCase();
  if (["meta", "control", "alt", "shift"].includes(key)) return null;
  const modifiers = [
    event.metaKey || event.ctrlKey ? "mod" : null,
    event.altKey ? "alt" : null,
    event.shiftKey ? "shift" : null,
  ].filter(Boolean);
  if (modifiers.length === 0 && !/^f\d{1,2}$/.test(key)) return null;
  return [...modifiers, key].join("+");
}

export function shortcutLabel(shortcut: string): string {
  return shortcut
    .split("+")
    .map((part) => {
      if (part === "mod") return "⌘";
      if (part === "alt") return "⌥";
      if (part === "shift") return "⇧";
      if (part === "backspace") return "⌫";
      if (part === "enter") return "↵";
      return part.length === 1 ? part.toUpperCase() : part.toUpperCase();
    })
    .join("");
}

export function ShortcutEditor({
  open,
  commands,
  shortcuts,
  onChange,
  onOpenChange,
}: {
  open: boolean;
  commands: readonly PaletteCommand[];
  shortcuts: CommandShortcuts;
  onChange: (shortcuts: CommandShortcuts) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const [present, setPresent] = useState(open);
  const [entered, setEntered] = useState(false);
  const [query, setQuery] = useState("");
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return commands.filter(
      (command, index) =>
        commands.findIndex((candidate) => candidate.id === command.id) === index &&
        (!needle ||
          `${command.label} ${command.section}`.toLowerCase().includes(needle)),
    );
  }, [commands, query]);

  useEffect(() => {
    if (open) {
      setPresent(true);
      setQuery("");
      setRecordingId(null);
      const enterTimer = window.setTimeout(() => setEntered(true), ENTER_DELAY_MS);
      const focusTimer = window.setTimeout(() => searchRef.current?.focus(), 0);
      return () => {
        window.clearTimeout(enterTimer);
        window.clearTimeout(focusTimer);
      };
    }
    setEntered(false);
    const timer = window.setTimeout(() => setPresent(false), EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [open]);

  if (!present) return null;

  return (
    <div
      className={cn(
        "fixed inset-0 z-[110] flex items-center justify-center bg-background/55 p-3 backdrop-blur-[2px] transition-opacity duration-200",
        entered ? "opacity-100" : "pointer-events-none opacity-0",
      )}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onOpenChange(false);
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Customize keyboard shortcuts"
        className={cn(
          "flex max-h-[min(680px,82vh)] w-full max-w-xl origin-top flex-col overflow-hidden rounded-xl border border-sidebar-border bg-popover shadow-2xl transition-[opacity,transform] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]",
          entered ? "scale-100 opacity-100" : "-translate-y-2 scale-[0.97] opacity-0",
        )}
      >
        <div className="flex items-center gap-3 border-b border-sidebar-border px-4 py-3">
          <Icon name="Command" className="size-4 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold">Keyboard shortcuts</h2>
            <p className="text-2xs text-muted-foreground">Select a command, then press a modified key combination.</p>
          </div>
          <button type="button" onClick={() => onOpenChange(false)} aria-label="Close shortcut editor" className="rounded p-1.5 text-muted-foreground hover:bg-sidebar-accent hover:text-foreground">
            <Icon name="CircleX" className="size-4" />
          </button>
        </div>
        <div className="border-b border-sidebar-border p-2">
          <input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search commands…" aria-label="Search shortcut commands" className="h-9 w-full rounded-md border border-sidebar-border bg-background px-3 text-sm outline-none focus:border-ring" />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {filtered.map((command) => {
            const assigned = shortcuts[command.id];
            const recording = recordingId === command.id;
            return (
              <div key={command.id} className="flex min-h-10 items-center gap-3 rounded-md px-2 hover:bg-sidebar-accent/60">
                <Icon name={command.icon} className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-sm">{command.label}</span>
                {assigned ? (
                  <button type="button" onClick={() => {
                    const next = { ...shortcuts };
                    delete next[command.id];
                    onChange(next);
                  }} aria-label={`Clear shortcut for ${command.label}`} className="text-2xs text-muted-foreground hover:text-foreground">Clear</button>
                ) : null}
                <button
                  type="button"
                  onClick={() => setRecordingId(command.id)}
                  onKeyDown={(event) => {
                    if (!recording) return;
                    if (event.key === "Escape") {
                      event.preventDefault();
                      setRecordingId(null);
                      return;
                    }
                    const shortcut = shortcutFromEvent(event);
                    if (!shortcut) return;
                    event.preventDefault();
                    const next = { ...shortcuts };
                    for (const [id, value] of Object.entries(next)) {
                      if (value === shortcut) delete next[id];
                    }
                    next[command.id] = shortcut;
                    onChange(next);
                    setRecordingId(null);
                  }}
                  className={cn(
                    "min-w-20 rounded border px-2 py-1 font-mono text-2xs",
                    recording ? "border-primary bg-primary/10 text-primary" : "border-sidebar-border text-muted-foreground hover:text-foreground",
                  )}
                >
                  {recording ? "Press keys…" : assigned ? shortcutLabel(assigned) : "Assign"}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
