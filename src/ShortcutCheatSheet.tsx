import { useEffect, useState } from "react";
import { Icon } from "./components/Icon";
import { cn } from "./lib/utils";

const ENTER_DELAY_MS = 20;
const EXIT_MS = 220;

const GROUPS = [
  {
    title: "Threads",
    shortcuts: [
      ["↑ / ↓", "Move focus between threads"],
      ["Enter", "Open focused thread"],
      ["F2", "Rename focused thread"],
    ],
  },
  {
    title: "Folders",
    shortcuts: [
      ["⌥ ↑ / ↓", "Move folder one position"],
      ["⌥ ⇧ ↑ / ↓", "Move folder to top or bottom"],
      ["Enter / Space", "Expand or collapse folder"],
    ],
  },
  {
    title: "Actions",
    shortcuts: [
      ["⌘ K", "Open command palette"],
      ["⌘ Z", "Undo sidebar action"],
      ["⇧ ⌘ Z", "Redo sidebar action"],
      ["⌘ ?", "Show this shortcut guide"],
    ],
  },
  {
    title: "General",
    shortcuts: [
      ["Esc", "Cancel editing or close an overlay"],
      ["Tab", "Move through available controls"],
    ],
  },
] as const;

export function ShortcutCheatSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [present, setPresent] = useState(open);
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    if (open) {
      setPresent(true);
      setEntered(false);
      const timer = setTimeout(() => setEntered(true), ENTER_DELAY_MS);
      return () => clearTimeout(timer);
    }
    setEntered(false);
    const timer = setTimeout(() => setPresent(false), EXIT_MS);
    return () => clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onOpenChange(false);
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [onOpenChange, open]);

  if (!present) return null;

  return (
    <div
      aria-hidden={!open}
      className={cn(
        "fixed inset-0 z-[110] flex items-center justify-center bg-background/45 p-3 backdrop-blur-[2px] transition-opacity duration-200 ease-out motion-reduce:transition-none",
        entered ? "opacity-100" : "pointer-events-none opacity-0",
      )}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onOpenChange(false);
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        className={cn(
          "w-full max-w-xl origin-center overflow-hidden rounded-xl border border-sidebar-border bg-popover text-popover-foreground shadow-2xl will-change-transform transition-[opacity,transform] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none",
          entered
            ? "translate-y-0 scale-100 opacity-100"
            : "translate-y-2 scale-[0.97] opacity-0",
        )}
      >
        <div className="flex items-center gap-2 border-b border-sidebar-border px-4 py-3">
          <Icon name="CircleQuestion" className="size-4 text-muted-foreground" />
          <h2 className="min-w-0 flex-1 text-sm font-semibold">
            Keyboard shortcuts
          </h2>
          <button
            type="button"
            aria-label="Close keyboard shortcuts"
            onClick={() => onOpenChange(false)}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <Icon name="CircleX" className="size-4" />
          </button>
        </div>
        <div className="grid max-h-[min(480px,70vh)] grid-cols-1 gap-x-8 gap-y-5 overflow-y-auto p-4 sm:grid-cols-2">
          {GROUPS.map((group) => (
            <section key={group.title} aria-labelledby={`shortcut-${group.title}`}>
              <h3
                id={`shortcut-${group.title}`}
                className="mb-2 text-2xs font-medium uppercase tracking-wide text-muted-foreground/70"
              >
                {group.title}
              </h3>
              <dl className="space-y-2.5">
                {group.shortcuts.map(([keys, description]) => (
                  <div key={keys} className="flex items-center gap-3">
                    <dt className="w-24 shrink-0">
                      <kbd className="inline-flex min-h-6 items-center rounded border border-sidebar-border bg-muted/40 px-1.5 font-mono text-2xs text-foreground shadow-sm">
                        {keys}
                      </kbd>
                    </dt>
                    <dd className="min-w-0 text-xs text-muted-foreground">
                      {description}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
        <p className="border-t border-sidebar-border px-4 py-2.5 text-center text-2xs text-muted-foreground">
          Shortcuts are ignored while typing unless they intentionally open an overlay.
        </p>
      </div>
    </div>
  );
}
