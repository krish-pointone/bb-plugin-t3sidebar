import { Icon } from "./components/Icon";

export function UndoToast({
  label,
  visible,
  depth,
  isUndoing,
  error,
  actionLabel,
  shortcut,
  onAction,
  onDismiss,
  onPauseChange,
}: {
  label: string;
  visible: boolean;
  depth: number;
  isUndoing: boolean;
  error: string | null;
  actionLabel: "Undo" | "Redo";
  shortcut: string;
  onAction: () => void;
  onDismiss: () => void;
  onPauseChange: (paused: boolean) => void;
}) {
  return (
    <div
      role="region"
      aria-label="Undo notification"
      aria-hidden={!visible}
      data-state={visible ? "open" : "closed"}
      onMouseEnter={() => onPauseChange(true)}
      onMouseLeave={() => onPauseChange(false)}
      onFocusCapture={() => onPauseChange(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          onPauseChange(false);
        }
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onDismiss();
        }
      }}
      className={`absolute bottom-2 left-2 right-2 z-50 flex origin-bottom items-center gap-2 rounded-md border border-sidebar-border bg-popover/95 px-2.5 py-2 text-xs text-popover-foreground shadow-lg backdrop-blur-sm will-change-transform transition-[opacity,transform] duration-[380ms] ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none ${
        visible
          ? "translate-y-0 scale-100 opacity-100"
          : "pointer-events-none translate-y-3 scale-[0.96] opacity-0"
      }`}
    >
      <span aria-live="polite" className="min-w-0 flex-1 truncate">
        {error ?? label}
        {!error && depth > 1 ? (
          <span className="ml-1 text-muted-foreground">· {depth} undoable</span>
        ) : null}
      </span>
      <button
        type="button"
        tabIndex={visible ? 0 : -1}
        disabled={isUndoing}
        onClick={onAction}
        className="flex shrink-0 items-center gap-1 rounded px-1.5 py-1 font-medium text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
      >
        <Icon name="ArrowTurnBackward" className="size-3.5" />
        {actionLabel}
        <kbd className="ml-0.5 rounded border border-sidebar-border px-1 font-mono text-2xs text-muted-foreground">
          {shortcut}
        </kbd>
      </button>
      <button
        type="button"
        tabIndex={visible ? 0 : -1}
        aria-label="Dismiss history notification"
        onClick={onDismiss}
        className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <Icon name="CircleX" className="size-3.5" />
      </button>
    </div>
  );
}
