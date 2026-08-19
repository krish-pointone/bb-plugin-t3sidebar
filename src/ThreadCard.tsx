import {
  experimental_useSidebarThreadPullRequest as useSidebarThreadPullRequest,
  experimental_useSidebarThreadSplit as useSidebarThreadSplit,
  experimental_useSidebarThreadActions as useSidebarThreadActions,
  type PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";
import { useRef, useState } from "react";
import { Icon, type IconName } from "./components/Icon";
import { cn } from "./lib/utils";
import { RowContextMenu } from "./RowContextMenu";
import { ProviderGlyph } from "./ProviderGlyph";
import { STATUS_SLOT_CLASS, StatusOrTime } from "./StatusSlot";
import { threadDisplayTitle } from "./inbox";
import { resolveSnoozePresets } from "./lifecycle";

/**
 * One thread as a three-line card: project and status, title, then branch and
 * activity. The card is the whole point of this sidebar — status lives in the
 * row instead of in its position, which is what lets the list stay still.
 *
 * The row is a positioned container with a full-bleed anchor UNDER the
 * controls, the way bb's own thread row does it: a `<button>` inside an `<a>`
 * is invalid interactive nesting and breaks keyboard behaviour.
 */
export function ThreadCard({
  thread,
  projectName,
  isActive,
  canPark,
  onNavigate,
  onSettle,
  onSnooze,
  onRename,
  now,
  draggable = false,
  isDragging = false,
  onDragStart,
  onDragEnd,
  embedded = false,
}: {
  thread: PluginSidebarThread;
  projectName: string | null;
  isActive: boolean;
  /** False while the thread is working or blocked on the user. */
  canPark: boolean;
  onNavigate: () => void;
  onSettle: () => void;
  onSnooze: (snoozedUntil: number) => void;
  onRename: (title: string) => Promise<void>;
  /** Quantized clock, so every card in one render agrees on "now". */
  now: number;
  draggable?: boolean;
  isDragging?: boolean;
  onDragStart?: (event: React.DragEvent<HTMLElement>) => void;
  onDragEnd?: () => void;
  /** Render transparently inside a folder's continuous colored surface. */
  embedded?: boolean;
}) {
  const actions = useSidebarThreadActions();
  const { splitProps, layout } = useSidebarThreadSplit(thread.id);
  // Opt-in per row: this costs a git-host lookup, and threads sharing a
  // worktree share one.
  const { pullRequest } = useSidebarThreadPullRequest(thread.id);
  const visibleTitle = threadDisplayTitle(thread);
  const [renaming, setRenaming] = useState(false);
  const [titleDraft, setTitleDraft] = useState(visibleTitle);
  const [renameError, setRenameError] = useState<string | null>(null);
  const savingRename = useRef(false);
  const isRowDraggable = draggable && !renaming;

  const beginRename = () => {
    setTitleDraft(visibleTitle);
    setRenameError(null);
    setRenaming(true);
  };

  const saveRename = async () => {
    const title = titleDraft.trim();
    if (savingRename.current) return;
    if (!title) {
      setRenameError("Thread name cannot be empty");
      return;
    }
    if (title === visibleTitle) {
      setRenaming(false);
      return;
    }
    savingRename.current = true;
    setRenameError(null);
    try {
      await onRename(title);
      setRenaming(false);
    } catch (cause) {
      setRenameError(
        cause instanceof Error ? cause.message : "Could not rename thread",
      );
    } finally {
      savingRename.current = false;
    }
  };

  return (
    <RowContextMenu thread={thread}>
      <li
        draggable={isRowDraggable}
        onDragStart={(event) => {
          event.currentTarget
            .querySelector<HTMLElement>("[data-sidebar-thread-shortcut-target]")
            ?.focus();
          onDragStart?.(event);
        }}
        onDragEnd={() => onDragEnd?.()}
        className={cn(
          "list-none",
          isRowDraggable && "cursor-grab active:cursor-grabbing",
          isDragging && "opacity-45",
        )}
      >
        <div
          data-folder-thread-card={embedded ? "" : undefined}
          className={cn(
            "group/card relative rounded-md px-2.5 py-2 transition-colors",
            embedded
              ? "hover:bg-foreground/5"
              : isActive
                ? "bg-sidebar-accent"
                : "hover:bg-sidebar-accent/60",
            // A thread open in another pane gets a weaker tint than the active
            // row, so the two states stay distinguishable.
            !embedded && !isActive && layout !== null && "bg-sidebar-accent/30",
            embedded && isActive && "ring-1 ring-inset ring-foreground/15",
          )}
        >
          <a
            // Both attributes, or bb's nine thread shortcuts stop finding rows.
            data-sidebar-thread-shortcut-target=""
            data-sidebar-thread-id={thread.id}
            href="#"
            aria-label={visibleTitle}
            title="Double-click or press F2 to rename"
            {...(draggable ? {} : splitProps)}
            onClick={(event) => {
              event.preventDefault();
              actions.open(thread.id, {
                split: event.metaKey || event.ctrlKey,
              });
              onNavigate();
            }}
            onDoubleClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              beginRename();
            }}
            onKeyDown={(event) => {
              if (event.key === "F2") {
                event.preventDefault();
                event.stopPropagation();
                beginRename();
                return;
              }
              if (
                event.key !== "ArrowUp" &&
                event.key !== "ArrowDown"
              ) {
                return;
              }
              const root = event.currentTarget.closest(
                "[data-t3-sidebar-root]",
              );
              if (!root) return;
              const targets = Array.from(
                root.querySelectorAll<HTMLElement>(
                  "[data-sidebar-thread-shortcut-target]",
                ),
              );
              const currentIndex = targets.indexOf(event.currentTarget);
              const nextIndex =
                currentIndex + (event.key === "ArrowUp" ? -1 : 1);
              const next = targets[nextIndex];
              if (!next) return;
              event.preventDefault();
              next.focus();
            }}
            className={cn(
              "absolute inset-0 rounded-md focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring",
              isRowDraggable
                ? "cursor-grab active:cursor-grabbing"
                : "cursor-pointer",
            )}
          />
          <div className="pointer-events-none relative flex h-5 items-center gap-1.5">
            <span className="min-w-0 flex-1 truncate text-2xs font-medium text-muted-foreground">
              {projectName ?? " "}
            </span>
            {/* Status at rest, park actions on hover. Only the status yields,
                so the project name never shifts. */}
            {canPark ? (
              <span className="pointer-events-auto hidden items-center gap-0.5 group-hover/card:flex">
                <ParkButton
                  label="Snooze until tomorrow"
                  icon="Clock"
                  onActivate={() =>
                  onSnooze(
                    resolveSnoozePresets(new Date()).find(
                      (preset) => preset.id === "tomorrow",
                    )!.snoozedUntil,
                  )
                  }
                />
                <ParkButton
                  label="Settle thread"
                  icon="Check"
                  onActivate={onSettle}
                />
              </span>
            ) : null}
            <span
              className={cn(
                STATUS_SLOT_CLASS,
                canPark && "group-hover/card:hidden",
              )}
            >
              <StatusOrTime thread={thread} now={now} />
            </span>
          </div>
          {renaming ? (
            <form
              className="relative mt-0.5"
              onSubmit={(event) => {
                event.preventDefault();
                void saveRename();
              }}
            >
              <input
                autoFocus
                aria-label={`Rename ${visibleTitle}`}
                aria-invalid={renameError ? true : undefined}
                title={renameError ?? undefined}
                value={titleDraft}
                maxLength={500}
                onFocus={(event) => event.currentTarget.select()}
                onChange={(event) => setTitleDraft(event.target.value)}
                onBlur={() => void saveRename()}
                onClick={(event) => event.stopPropagation()}
                onDoubleClick={(event) => event.stopPropagation()}
                onDragStart={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    event.stopPropagation();
                    setRenameError(null);
                    setRenaming(false);
                  }
                }}
                className={cn(
                  "h-6 w-full rounded border bg-background px-1.5 text-sm text-foreground outline-none",
                  renameError
                    ? "border-destructive focus:border-destructive"
                    : "border-sidebar-border focus:border-ring",
                )}
              />
            </form>
          ) : (
            <div
              className={cn(
                // Weight alone carries unread. Fading the title — or the whole
                // card — makes a thread at rest read as disabled, and at rest is
                // what most of the list is most of the time.
                "pointer-events-none relative mt-0.5 truncate text-sm text-foreground",
                thread.isUnread && "font-medium",
              )}
            >
              {visibleTitle}
            </div>
          )}
          <div className="pointer-events-none relative mt-0.5 flex h-4 items-center gap-1.5 text-2xs text-muted-foreground">
            {/* A thread without a worktree still runs somewhere, so the
                machine takes the branch's place rather than leaving the line
                blank. */}
            {thread.environment?.branchName ? (
              <span className="min-w-0 flex-1 truncate font-mono">
                {thread.environment.branchName}
              </span>
            ) : thread.host ? (
              <span className="min-w-0 flex-1 truncate">
                {thread.host.name}
              </span>
            ) : (
              <span className="flex-1" />
            )}
            {thread.activity.workflows > 0 ? (
              <ActivityCount
                label="workflows"
                count={thread.activity.workflows}
              />
            ) : null}
            {thread.activity.backgroundAgents > 0 ? (
              <ActivityCount
                label="background agents"
                count={thread.activity.backgroundAgents}
              />
            ) : null}
            {pullRequest ? (
              <a
                href={pullRequest.url}
                target="_blank"
                rel="noreferrer"
                onClick={(event) => event.stopPropagation()}
                title={pullRequest.title}
                className={cn(
                  "relative shrink-0 font-mono hover:underline",
                  pullRequest.state === "merged"
                    ? "text-[color:var(--pr-merged)]"
                    : pullRequest.attention === "checks_failed" ||
                        pullRequest.attention === "conflicts"
                      ? "text-destructive-text"
                      : pullRequest.attention === "ready_to_merge"
                        ? "text-success-foreground"
                        : "text-muted-foreground",
                )}
              >
                #{pullRequest.number}
              </a>
            ) : null}
            {/* Always drawn, so the line has a fixed right edge. */}
            <ProviderGlyph providerId={thread.providerId} />
          </div>
        </div>
      </li>
    </RowContextMenu>
  );
}

function ParkButton({
  label,
  icon,
  onActivate,
}: {
  label: string;
  icon: Extract<IconName, "Clock" | "Check">;
  onActivate: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onActivate();
      }}
      className="rounded p-0.5 text-muted-foreground hover:text-foreground"
    >
      <Icon name={icon} className="size-3.5" />
    </button>
  );
}

function ActivityCount({ label, count }: { label: string; count: number }) {
  return (
    <span
      aria-label={`${count} ${label}`}
      className="shrink-0 rounded bg-muted px-1 font-mono text-2xs text-muted-foreground"
    >
      {count}
    </span>
  );
}
