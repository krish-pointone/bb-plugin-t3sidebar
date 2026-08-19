import { useEffect, useState } from "react";
import { Icon } from "./components/Icon";
import { cn } from "./lib/utils";

function initialValue(): string {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);
  const local = new Date(tomorrow.getTime() - tomorrow.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function CustomSnoozeDialog({
  open,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (snoozedUntil: number) => void | Promise<void>;
}) {
  const [value, setValue] = useState(initialValue);
  const [entered, setEntered] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setValue(initialValue());
    setError(null);
    setEntered(false);
    const timer = window.setTimeout(() => setEntered(true), 20);
    return () => window.clearTimeout(timer);
  }, [open]);
  if (!open) return null;
  return (
    <div className={cn("fixed inset-0 z-[115] flex items-center justify-center bg-background/55 p-3 backdrop-blur-[2px] transition-opacity duration-200", entered ? "opacity-100" : "opacity-0")} onMouseDown={(event) => {
      if (event.target === event.currentTarget) onOpenChange(false);
    }}>
      <form
        role="dialog"
        aria-modal="true"
        aria-label="Custom snooze time"
        onSubmit={(event) => {
          event.preventDefault();
          const timestamp = new Date(value).getTime();
          if (!Number.isFinite(timestamp) || timestamp <= Date.now()) {
            setError("Choose a time in the future.");
            return;
          }
          void Promise.resolve(onSubmit(timestamp)).then(() => onOpenChange(false));
        }}
        className={cn("w-full max-w-sm rounded-xl border border-sidebar-border bg-popover p-4 shadow-2xl transition-[opacity,transform] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]", entered ? "scale-100 opacity-100" : "-translate-y-2 scale-[0.97] opacity-0")}
      >
        <div className="flex items-center gap-2">
          <Icon name="Clock" className="size-4 text-muted-foreground" />
          <h2 className="flex-1 text-sm font-semibold">Snooze until…</h2>
          <button type="button" aria-label="Cancel custom snooze" onClick={() => onOpenChange(false)} className="rounded p-1 text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"><Icon name="CircleX" className="size-4" /></button>
        </div>
        <input autoFocus type="datetime-local" aria-label="Snooze date and time" value={value} onChange={(event) => setValue(event.target.value)} className="mt-4 h-10 w-full rounded-md border border-sidebar-border bg-background px-3 text-sm outline-none focus:border-ring" />
        {error ? <p role="alert" className="mt-2 text-xs text-destructive-text">{error}</p> : null}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={() => onOpenChange(false)} className="rounded-md px-3 py-2 text-xs text-muted-foreground hover:bg-sidebar-accent">Cancel</button>
          <button type="submit" className="rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:opacity-90">Snooze</button>
        </div>
      </form>
    </div>
  );
}
