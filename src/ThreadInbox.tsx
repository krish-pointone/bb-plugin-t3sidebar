import { useEffect, useMemo, useRef, useState } from "react";
import {
  experimental_useSidebarThreads as useSidebarThreads,
  experimental_useSidebarThreadActions as useSidebarThreadActions,
  useBbNavigate,
  type PluginSidebarThread,
  type PluginThreadListProps,
} from "@get-bb/plugin-sdk/app";
import { Icon } from "./components/Icon";
import { cn } from "./lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./components/Select";
import { ThreadCard } from "./ThreadCard";
import { SlimRow } from "./SlimRow";
import { UndoToast } from "./UndoToast";
import { CommandPalette, type PaletteCommand } from "./CommandPalette";
import { ShortcutCheatSheet } from "./ShortcutCheatSheet";
import { CustomSnoozeDialog } from "./CustomSnoozeDialog";
import {
  ShortcutEditor,
  shortcutFromEvent,
  shortcutLabel,
  type CommandShortcuts,
} from "./ShortcutEditor";
import { isWorking, useLifecycle } from "./useLifecycle";
import { useSections, type SidebarSection } from "./useSections";
import { useUndoStack } from "./useUndoStack";
import { resolveSnoozePresets } from "./lifecycle";
import {
  DEFAULT_FOLDER_COLORS,
  FOLDER_COLOR_PRESETS,
  folderColorWithAlpha,
  isFolderColor,
  normalizeFolderColor,
  type FolderColor,
} from "./folderColors";
import { TRAILING_GLYPH_BOX_CLASS } from "./StatusSlot";
import {
  filterByProject,
  hideChildrenOfVisibleParents,
  partitionPinned,
  searchThreadsByTitle,
  sortByCreatedAtDescending,
  threadDisplayTitle,
  visibleInboxThreads,
} from "./inbox";

const ALL_PROJECTS = "__all__";
const UNFILED_FILTER = "__unfiled__";
const FOLDER_DRAG_TYPE = "application/x-bb-folder";
const SHORTCUT_STORAGE_KEY = "t3sidebar.command-shortcuts.v1";

type StatusFilter = "working" | "attention" | "unread" | "idle";

function isFolderTransfer(dataTransfer: DataTransfer): boolean {
  return Array.from(dataTransfer.types ?? []).includes(FOLDER_DRAG_TYPE);
}

function readCommandShortcuts(): CommandShortcuts {
  try {
    const value = window.localStorage.getItem(SHORTCUT_STORAGE_KEY);
    return value ? (JSON.parse(value) as CommandShortcuts) : {};
  } catch {
    return {};
  }
}

/**
 * The sidebar's scrolling list: one flat, statically ordered stack of cards.
 *
 * The host owns the New-thread button and the search field above it, so this
 * ships neither. It filters by the `searchQuery` prop and keeps only the one
 * control the host has no equivalent for: the project scope picker.
 */
export function ThreadInbox({
  activeThreadId,
  activeProjectId,
  onNavigate,
  searchQuery,
}: PluginThreadListProps) {
  const { status, threads, projects } = useSidebarThreads();
  const navigate = useBbNavigate();
  const threadActions = useSidebarThreadActions();
  const lifecycle = useLifecycle(threads);
  const folders = useSections();
  const undoHistory = useUndoStack();
  const [scope, setScope] = useState<string>(ALL_PROJECTS);
  const [providerFilter, setProviderFilter] = useState<string | null>(null);
  const [hostFilter, setHostFilter] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter | null>(null);
  const [folderFilter, setFolderFilter] = useState<string | null>(null);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [shortcutCheatSheetOpen, setShortcutCheatSheetOpen] = useState(false);
  const [shortcutEditorOpen, setShortcutEditorOpen] = useState(false);
  const [customSnoozeThreadId, setCustomSnoozeThreadId] = useState<string | null>(null);
  const [commandShortcuts, setCommandShortcuts] = useState<CommandShortcuts>(
    readCommandShortcuts,
  );
  const [commandContext, setCommandContext] = useState<{
    threadId: string | null;
    sectionId: string | null;
  }>({ threadId: null, sectionId: null });
  const [newFolderName, setNewFolderName] = useState("");
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
  const [folderNameDraft, setFolderNameDraft] = useState("");
  const [busyFolderId, setBusyFolderId] = useState<string | null>(null);
  const [draggedThreadId, setDraggedThreadId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [draggedFolderId, setDraggedFolderId] = useState<string | null>(null);
  const draggedFolderIdRef = useRef<string | null>(null);
  const [folderDropTarget, setFolderDropTarget] = useState<{
    sectionId: string;
    position: "before" | "after";
  } | null>(null);
  const [folderError, setFolderError] = useState<string | null>(null);
  const [colorPickerFolderId, setColorPickerFolderId] = useState<string | null>(
    null,
  );
  const [collapsedFolderIds, setCollapsedFolderIds] = useState<Set<string>>(
    () => new Set(),
  );
  // One clock for every card in a render, quantized to the minute so the
  // labels do not disagree and do not churn on unrelated re-renders.
  const [nowMinute, setNowMinute] = useState(() =>
    Math.floor(Date.now() / 60_000),
  );
  useEffect(() => {
    const timer = setInterval(
      () => setNowMinute(Math.floor(Date.now() / 60_000)),
      60_000,
    );
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    try {
      window.localStorage.setItem(
        SHORTCUT_STORAGE_KEY,
        JSON.stringify(commandShortcuts),
      );
    } catch {
      // A locked-down webview may disable storage; shortcuts still work for
      // the current session.
    }
  }, [commandShortcuts]);
  const now = nowMinute * 60_000;
  const [showSnoozed, setShowSnoozed] = useState(false);
  const [showSettled, setShowSettled] = useState(false);

  const projectNameById = useMemo(
    () => new Map(projects.map((project) => [project.id, project.name])),
    [projects],
  );

  const { active, snoozed, settled } = useMemo(() => {
    const projectScoped = filterByProject(
      visibleInboxThreads(threads),
      scope === ALL_PROJECTS ? null : scope,
    );
    const scoped = projectScoped.filter((thread) => {
      if (providerFilter && thread.providerId !== providerFilter) return false;
      if (hostFilter && thread.host?.id !== hostFilter) return false;
      if (!statusFilter) return true;
      if (statusFilter === "working") return isWorking(thread);
      if (statusFilter === "attention") return thread.hasPendingInteraction;
      if (statusFilter === "unread") return thread.isUnread;
      return !isWorking(thread) && !thread.hasPendingInteraction;
    });
    // Children live in their parent's header chip instead of the flat list;
    // an orphan whose parent is not on screen stays here.
    const matched = searchThreadsByTitle(
      hideChildrenOfVisibleParents(scoped),
      searchQuery,
    );
    const active: typeof matched = [];
    const onSnoozeShelf: typeof matched = [];
    const onSettledShelf: typeof matched = [];
    for (const thread of matched) {
      const shelf = lifecycle.shelfFor(thread);
      if (shelf === "snoozed") onSnoozeShelf.push(thread);
      else if (shelf === "settled") onSettledShelf.push(thread);
      else active.push(thread);
    }
    return {
      active,
      // Soonest wake first: "what comes back next" is the shelf's question.
      snoozed: [...onSnoozeShelf].sort(
        (left, right) =>
          (lifecycle.wakeAtFor(left) ?? 0) - (lifecycle.wakeAtFor(right) ?? 0),
      ),
      settled: sortByCreatedAtDescending(onSettledShelf),
    };
  }, [hostFilter, lifecycle, providerFilter, scope, searchQuery, statusFilter, threads]);

  const { pinned, inbox, folderGroups } = useMemo(() => {
    const knownSectionIds = new Set(folders.sections.map((section) => section.id));
    const unfiled = active.filter(
      (thread) => thread.sectionId === null || !knownSectionIds.has(thread.sectionId),
    );
    const split = partitionPinned(unfiled);
    return {
      pinned: sortByCreatedAtDescending(split.pinned),
      inbox: sortByCreatedAtDescending(split.inbox),
      folderGroups: folders.sections.map((section) => {
        const inSection = active.filter((thread) => thread.sectionId === section.id);
        const sectionSplit = partitionPinned(inSection);
        return {
          section,
          threads: [
            ...sortByCreatedAtDescending(sectionSplit.pinned),
            ...sortByCreatedAtDescending(sectionSplit.inbox),
          ],
        };
      }),
    };
  }, [active, folders.sections]);
  const visibleFolderGroups = useMemo(
    () =>
      folderGroups.filter(
        ({ section, threads: folderThreads }) =>
          (folderFilter === null ||
            (folderFilter !== UNFILED_FILTER &&
              section.id === folderFilter)) &&
          (!searchQuery.trim() || folderThreads.length > 0),
      ),
    [folderFilter, folderGroups, searchQuery],
  );
  const showUnfiledThreads =
    folderFilter === null || folderFilter === UNFILED_FILTER;

  const createFolder = async () => {
    const name = newFolderName.trim();
    if (!name) return;
    setBusyFolderId("__new__");
    setFolderError(null);
    try {
      await folders.create(name);
      setNewFolderName("");
      setCreatingFolder(false);
    } catch (cause) {
      setFolderError(cause instanceof Error ? cause.message : "Could not create folder");
    } finally {
      setBusyFolderId(null);
    }
  };

  const renameFolder = async (sectionId: string) => {
    const name = folderNameDraft.trim();
    if (!name) return;
    const previousName = folders.sections.find(
      (section) => section.id === sectionId,
    )?.name;
    setBusyFolderId(sectionId);
    setFolderError(null);
    try {
      await folders.rename(sectionId, name);
      if (previousName && previousName !== name) {
        undoHistory.push(
          "Folder renamed",
          () => folders.rename(sectionId, previousName),
          () => folders.rename(sectionId, name),
        );
      }
      setRenamingFolderId(null);
      setFolderNameDraft("");
    } catch (cause) {
      setFolderError(cause instanceof Error ? cause.message : "Could not rename folder");
    } finally {
      setBusyFolderId(null);
    }
  };

  const deleteFolder = async (section: SidebarSection) => {
    if (!window.confirm(`Delete “${section.name}”? Its threads will move to Unfiled.`)) return;
    setBusyFolderId(section.id);
    setFolderError(null);
    try {
      await folders.remove(section.id);
    } catch (cause) {
      setFolderError(cause instanceof Error ? cause.message : "Could not delete folder");
    } finally {
      setBusyFolderId(null);
    }
  };

  const setFolderColor = async (sectionId: string, color: FolderColor) => {
    const previousColor = normalizeFolderColor(
      folders.sections.find((section) => section.id === sectionId)?.color ??
        DEFAULT_FOLDER_COLORS[0],
    );
    setBusyFolderId(sectionId);
    setFolderError(null);
    try {
      await folders.setColor(sectionId, color);
      if (previousColor !== color) {
        undoHistory.push(
          "Folder color changed",
          () => folders.setColor(sectionId, previousColor),
          () => folders.setColor(sectionId, color),
        );
      }
      setColorPickerFolderId(null);
    } catch (cause) {
      setFolderError(
        cause instanceof Error ? cause.message : "Could not change folder color",
      );
    } finally {
      setBusyFolderId(null);
    }
  };

  const moveThreadToSection = async (
    thread: PluginSidebarThread,
    sectionId: string | null,
  ) => {
    const previousSectionId = thread.sectionId;
    if (previousSectionId === sectionId) return;
    await folders.moveThread(thread.id, sectionId);
    undoHistory.push(
      sectionId === null ? "Thread removed from folder" : "Thread moved",
      () => folders.moveThread(thread.id, previousSectionId),
      () => folders.moveThread(thread.id, sectionId),
    );
  };

  const moveDraggedThread = async (sectionId: string | null) => {
    if (!draggedThreadId) return;
    const thread = threads.find((candidate) => candidate.id === draggedThreadId);
    setDropTargetId(null);
    setFolderError(null);
    try {
      if (thread) await moveThreadToSection(thread, sectionId);
    } catch (cause) {
      setFolderError(cause instanceof Error ? cause.message : "Could not move thread");
    } finally {
      setDraggedThreadId(null);
    }
  };

  const reorderDraggedFolder = async (
    targetSectionId: string,
    position: "before" | "after",
  ) => {
    // Native dragover/drop can arrive before React commits the state update
    // from dragstart. The ref is synchronous, so a quick drag still reorders.
    const sourceSectionId = draggedFolderIdRef.current ?? draggedFolderId;
    if (!sourceSectionId || sourceSectionId === targetSectionId) return;
    const previousSectionIds = folders.sections.map((section) => section.id);
    const sectionIds = previousSectionIds.filter(
      (sectionId) => sectionId !== sourceSectionId,
    );
    const targetIndex = sectionIds.indexOf(targetSectionId);
    if (targetIndex < 0) return;
    sectionIds.splice(
      targetIndex + (position === "after" ? 1 : 0),
      0,
      sourceSectionId,
    );
    setFolderDropTarget(null);
    setFolderError(null);
    try {
      await folders.reorder(sectionIds);
      undoHistory.push(
        "Folders reordered",
        () => folders.reorder(previousSectionIds),
        () => folders.reorder(sectionIds),
      );
    } catch (cause) {
      setFolderError(
        cause instanceof Error ? cause.message : "Could not reorder folders",
      );
    } finally {
      setDraggedFolderId(null);
    }
  };

  const moveFolderWithKeyboard = async (
    sectionId: string,
    direction: "up" | "down",
    toEdge: boolean,
  ) => {
    const previousSectionIds = folders.sections.map((section) => section.id);
    const currentIndex = previousSectionIds.indexOf(sectionId);
    if (currentIndex < 0) return;
    const targetIndex = toEdge
      ? direction === "up"
        ? 0
        : previousSectionIds.length - 1
      : currentIndex + (direction === "up" ? -1 : 1);
    if (
      targetIndex < 0 ||
      targetIndex >= previousSectionIds.length ||
      targetIndex === currentIndex
    ) {
      return;
    }
    const nextSectionIds = [...previousSectionIds];
    nextSectionIds.splice(currentIndex, 1);
    nextSectionIds.splice(targetIndex, 0, sectionId);
    setFolderError(null);
    try {
      await folders.reorder(nextSectionIds);
      undoHistory.push(
        "Folders reordered",
        () => folders.reorder(previousSectionIds),
        () => folders.reorder(nextSectionIds),
      );
    } catch (cause) {
      setFolderError(
        cause instanceof Error ? cause.message : "Could not reorder folders",
      );
    }
  };

  const renameThread = async (
    thread: PluginSidebarThread,
    title: string,
  ) => {
    await folders.renameThread(thread.id, title);
    undoHistory.push(
      "Thread renamed",
      () => folders.renameThread(thread.id, thread.title),
      () => folders.renameThread(thread.id, title),
    );
  };

  const settleThread = async (threadId: string) => {
    await lifecycle.settle(threadId);
    undoHistory.push(
      "Thread settled",
      () => lifecycle.unsettle(threadId),
      () => lifecycle.settle(threadId),
    );
  };

  const snoozeThread = async (threadId: string, snoozedUntil: number) => {
    await lifecycle.snooze(threadId, snoozedUntil);
    undoHistory.push(
      "Thread snoozed",
      () => lifecycle.unsnooze(threadId),
      () => lifecycle.snooze(threadId, snoozedUntil),
    );
  };

  const restoreParkedThread = async (
    thread: PluginSidebarThread,
    shelf: "snoozed" | "settled",
  ) => {
    const wakeAt = lifecycle.wakeAtFor(thread);
    if (shelf === "snoozed") {
      await lifecycle.unsnooze(thread.id);
      if (wakeAt !== null) {
        undoHistory.push(
          "Thread woken",
          () => lifecycle.snooze(thread.id, wakeAt),
          () => lifecycle.unsnooze(thread.id),
        );
      }
    } else {
      await lifecycle.unsettle(thread.id);
      undoHistory.push(
        "Thread restored",
        () => lifecycle.settle(thread.id),
        () => lifecycle.unsettle(thread.id),
      );
    }
  };

  const toggleFolder = (sectionId: string) => {
    setCollapsedFolderIds((current) => {
      const next = new Set(current);
      if (next.has(sectionId)) next.delete(sectionId);
      else next.add(sectionId);
      return next;
    });
  };

  const scopeLabel =
    scope === ALL_PROJECTS
      ? "All projects"
      : (projectNameById.get(scope) ?? "All projects");

  const openCommandPalette = () => {
    const focused =
      document.activeElement instanceof Element ? document.activeElement : null;
    const focusedThread = focused?.closest<HTMLElement>(
      "[data-sidebar-thread-id]",
    );
    const focusedFolder = focused?.closest<HTMLElement>("[data-folder-id]");
    setCommandContext({
      threadId:
        focusedThread?.dataset.sidebarThreadId ?? activeThreadId ?? null,
      sectionId: focusedFolder?.dataset.folderId ?? null,
    });
    setCommandPaletteOpen(true);
  };

  useEffect(() => {
    const onCommandPaletteShortcut = (event: KeyboardEvent) => {
      if (
        event.key.toLowerCase() !== "k" ||
        (!event.metaKey && !event.ctrlKey)
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      openCommandPalette();
    };
    document.addEventListener("keydown", onCommandPaletteShortcut, true);
    return () =>
      document.removeEventListener("keydown", onCommandPaletteShortcut, true);
  });

  useEffect(() => {
    const onShortcutCheatSheet = (event: KeyboardEvent) => {
      const questionMark =
        event.key === "?" || (event.key === "/" && event.shiftKey);
      if (!questionMark || (!event.metaKey && !event.ctrlKey)) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      setCommandPaletteOpen(false);
      setShortcutCheatSheetOpen(true);
    };
    document.addEventListener("keydown", onShortcutCheatSheet, true);
    return () =>
      document.removeEventListener("keydown", onShortcutCheatSheet, true);
  }, []);

  const contextThread = threads.find(
    (thread) => thread.id === commandContext.threadId,
  );
  const contextSection = folders.sections.find(
    (section) => section.id === commandContext.sectionId,
  );
  const paletteCommands: PaletteCommand[] = [];
  if (undoHistory.canUndo) {
    paletteCommands.push({
      id: "undo",
      label: "Undo last sidebar action",
      section: "History",
      shortcut: "⌘Z",
      icon: "ArrowTurnBackward",
      run: undoHistory.undo,
    });
  }
  if (undoHistory.canRedo) {
    paletteCommands.push({
      id: "redo",
      label: "Redo last sidebar action",
      section: "History",
      shortcut: "⇧⌘Z",
      icon: "ArrowTurnBackward",
      run: undoHistory.redo,
    });
  }
  for (const thread of [...threads].sort((left, right) =>
    threadDisplayTitle(left).localeCompare(threadDisplayTitle(right)),
  )) {
    paletteCommands.push({
      id: `jump-thread-${thread.id}`,
      label: `Jump to thread: ${threadDisplayTitle(thread)}`,
      section: "Jump to thread",
      searchOnly: true,
      keywords: `${thread.providerId} ${projectNameById.get(thread.projectId) ?? ""} open navigate go`,
      icon: "Target",
      run: () => {
        threadActions.open(thread.id);
        onNavigate();
      },
    });
  }
  for (const section of folders.sections) {
    paletteCommands.push({
      id: `jump-folder-${section.id}`,
      label: `Jump to folder: ${section.name}`,
      section: "Jump to folder",
      searchOnly: true,
      keywords: `open navigate focus group ${section.name}`,
      icon: "Folder",
      run: () => {
        setFolderFilter(null);
        setCollapsedFolderIds((current) => {
          const next = new Set(current);
          next.delete(section.id);
          return next;
        });
        window.setTimeout(() => {
          const target = Array.from(
            document.querySelectorAll<HTMLElement>("[data-folder-id]"),
          ).find((element) => element.dataset.folderId === section.id);
          target?.focus();
          target?.scrollIntoView?.({ block: "center", behavior: "smooth" });
        }, 0);
      },
    });
  }
  if (contextThread) {
    const contextShelf = lifecycle.shelfFor(contextThread);
    paletteCommands.push({
      id: "rename-thread",
      label: `Rename “${threadDisplayTitle(contextThread)}”`,
      section: "Thread",
      shortcut: "F2",
      keywords: "edit title",
      icon: "Edit",
      run: () => {
        const target = Array.from(
          document.querySelectorAll<HTMLElement>("[data-sidebar-thread-id]"),
        ).find(
          (element) =>
            element.dataset.sidebarThreadId === contextThread.id,
        );
        target?.dispatchEvent(
          new KeyboardEvent("keydown", { key: "F2", bubbles: true }),
        );
      },
    });
    paletteCommands.push({
      id: "pin-thread",
      label: contextThread.isPinned ? "Unpin thread" : "Pin thread",
      section: "Thread",
      keywords: "favorite top",
      icon: "Target",
      run: () =>
        threadActions.setPinned(contextThread.id, !contextThread.isPinned),
    });
    if (contextShelf === "settled") {
      paletteCommands.push({
        id: "unsettle-thread",
        label: "Unsettle thread",
        section: "Thread",
        keywords: "restore reopen active",
        icon: "ArrowTurnBackward",
        run: () => restoreParkedThread(contextThread, "settled"),
      });
    } else if (contextShelf === "snoozed") {
      paletteCommands.push({
        id: "wake-thread",
        label: "Wake thread now",
        section: "Thread",
        keywords: "restore unsnooze active",
        icon: "Clock",
        run: () => restoreParkedThread(contextThread, "snoozed"),
      });
    } else if (lifecycle.canPark(contextThread)) {
      paletteCommands.push({
          id: "settle-thread",
          label: "Settle thread",
          section: "Thread",
          keywords: "done hide complete",
          icon: "Check",
          run: () => settleThread(contextThread.id),
      });
      for (const preset of resolveSnoozePresets(new Date())) {
        paletteCommands.push({
          id: `snooze-thread-${preset.id}`,
          label: `Snooze thread: ${preset.label}`,
          section: "Snooze thread",
          keywords: `later hide ${preset.id}`,
          icon: "Clock",
          run: () => snoozeThread(contextThread.id, preset.snoozedUntil),
        });
      }
      paletteCommands.push({
        id: "snooze-thread-custom",
        label: "Snooze thread: Custom date and time…",
        section: "Snooze thread",
        keywords: "later schedule calendar custom",
        icon: "Clock",
        run: () => setCustomSnoozeThreadId(contextThread.id),
      });
    }
    for (const section of folders.sections) {
      if (section.id === contextThread.sectionId) continue;
      paletteCommands.push({
        id: `move-thread-${section.id}`,
        label: `Move thread to ${section.name}`,
        section: "Move to folder",
        searchOnly: true,
        keywords: `file organize ${section.name}`,
        icon: "Folder",
        run: () => moveThreadToSection(contextThread, section.id),
      });
    }
    if (contextThread.sectionId !== null) {
      paletteCommands.push({
        id: "move-thread-unfiled",
        label: "Move thread to Unfiled",
        section: "Move to folder",
        keywords: "remove folder inbox",
        icon: "Folder",
        run: () => moveThreadToSection(contextThread, null),
      });
    }
  }
  if (contextSection) {
    paletteCommands.push(
      {
        id: "rename-folder",
        label: `Rename ${contextSection.name}`,
        section: "Folder",
        shortcut: "F2",
        icon: "Edit",
        run: () => {
          const target = document.querySelector<HTMLElement>(
            `[data-folder-id="${contextSection.id}"]`,
          );
          target?.dispatchEvent(
            new KeyboardEvent("keydown", { key: "F2", bubbles: true }),
          );
        },
      },
      {
        id: "change-folder-color",
        label: `Change ${contextSection.name} color`,
        section: "Folder",
        icon: "Folder",
        run: () => setColorPickerFolderId(contextSection.id),
      },
      {
        id: "new-thread-folder",
        label: `New thread in ${contextSection.name}`,
        section: "Folder",
        icon: "Add",
        run: () => {
          const projectId = scope === ALL_PROJECTS ? activeProjectId : scope;
          navigate.toPluginPanel("folder-new-thread", {
            subPath: projectId
              ? `${encodeURIComponent(contextSection.id)}/${encodeURIComponent(projectId)}`
              : encodeURIComponent(contextSection.id),
          });
          onNavigate();
        },
      },
    );
    const folderIndex = folders.sections.findIndex(
      (section) => section.id === contextSection.id,
    );
    if (folderIndex > 0) {
      paletteCommands.push(
        {
          id: "move-folder-up",
          label: `Move ${contextSection.name} up`,
          section: "Folder order",
          icon: "ChevronUp",
          run: () => moveFolderWithKeyboard(contextSection.id, "up", false),
        },
        {
          id: "move-folder-top",
          label: `Move ${contextSection.name} to top`,
          section: "Folder order",
          icon: "ChevronUp",
          run: () => moveFolderWithKeyboard(contextSection.id, "up", true),
        },
      );
    }
    if (folderIndex >= 0 && folderIndex < folders.sections.length - 1) {
      paletteCommands.push(
        {
          id: "move-folder-down",
          label: `Move ${contextSection.name} down`,
          section: "Folder order",
          icon: "ChevronDown",
          run: () => moveFolderWithKeyboard(contextSection.id, "down", false),
        },
        {
          id: "move-folder-bottom",
          label: `Move ${contextSection.name} to bottom`,
          section: "Folder order",
          icon: "ChevronDown",
          run: () => moveFolderWithKeyboard(contextSection.id, "down", true),
        },
      );
    }
    for (const preset of FOLDER_COLOR_PRESETS) {
      paletteCommands.push({
        id: `folder-color-${preset.label.toLowerCase()}`,
        label: `Set ${contextSection.name} color to ${preset.label}`,
        section: "Folder color",
        searchOnly: true,
        keywords: `theme customize ${preset.color}`,
        icon: "Folder",
        run: () => setFolderColor(contextSection.id, preset.color),
      });
    }
  }
  paletteCommands.push(
    {
      id: "create-folder",
      label: "Create folder",
      section: "Sidebar",
      icon: "Add",
      run: () => setCreatingFolder(true),
    },
    {
      id: "show-keyboard-shortcuts",
      label: "Show keyboard shortcut cheat sheet",
      section: "Sidebar",
      shortcut: "⌘?",
      keywords: "help keys commands",
      icon: "CircleQuestion",
      run: () => setShortcutCheatSheetOpen(true),
    },
    {
      id: "customize-keyboard-shortcuts",
      label: "Customize keyboard shortcuts",
      section: "Sidebar",
      keywords: "edit bind hotkeys keys commands",
      icon: "Command",
      run: () => setShortcutEditorOpen(true),
    },
    {
      id: "expand-folders",
      label: "Expand all folders",
      section: "Sidebar",
      keywords: "open show",
      icon: "ChevronDown",
      run: () => setCollapsedFolderIds(new Set()),
    },
    {
      id: "collapse-folders",
      label: "Collapse all folders",
      section: "Sidebar",
      keywords: "close hide",
      icon: "ChevronUp",
      run: () =>
        setCollapsedFolderIds(
          new Set(folders.sections.map((section) => section.id)),
        ),
    },
  );
  for (const section of folders.sections) {
    paletteCommands.push({
      id: `new-thread-in-${section.id}`,
      label: `Create thread in ${section.name}`,
      section: "Create thread",
      searchOnly: true,
      keywords: `new agent compose folder ${section.name}`,
      icon: "Add",
      run: () => {
        const projectId = scope === ALL_PROJECTS ? activeProjectId : scope;
        navigate.toPluginPanel("folder-new-thread", {
          subPath: projectId
            ? `${encodeURIComponent(section.id)}/${encodeURIComponent(projectId)}`
            : encodeURIComponent(section.id),
        });
        onNavigate();
      },
    });
  }
  paletteCommands.push({
    id: "new-thread-unfiled",
    label: "Create unfiled thread",
    section: "Create thread",
    keywords: "new agent compose inbox",
    icon: "Add",
    run: () =>
      threadActions.openNewThread({
        projectId: scope === ALL_PROJECTS ? activeProjectId ?? undefined : scope,
        focusPrompt: true,
      }),
  });

  paletteCommands.push({
    id: "filter-project-all",
    label: "Filter: All projects",
    section: "Filter by project",
    searchOnly: true,
    icon: "Target",
    run: () => setScope(ALL_PROJECTS),
  });
  for (const project of projects) {
    paletteCommands.push({
      id: `filter-project-${project.id}`,
      label: `Filter by project: ${project.name}`,
      section: "Filter by project",
      searchOnly: true,
      keywords: `scope workspace ${project.name}`,
      icon: "Target",
      run: () => setScope(project.id),
    });
  }
  for (const providerId of [...new Set(threads.map((thread) => thread.providerId))].sort()) {
    paletteCommands.push({
      id: `filter-provider-${providerId}`,
      label: `Filter by agent/provider: ${providerId}`,
      section: "Filter by agent",
      searchOnly: true,
      keywords: `model agent provider ${providerId}`,
      icon: "Workflow",
      run: () => setProviderFilter(providerId),
    });
  }
  const hosts = new Map(
    threads.flatMap((thread) =>
      thread.host ? [[thread.host.id, thread.host.name] as const] : [],
    ),
  );
  for (const [hostId, hostName] of hosts) {
    paletteCommands.push({
      id: `filter-machine-${hostId}`,
      label: `Filter by machine: ${hostName}`,
      section: "Filter by machine",
      searchOnly: true,
      keywords: `host computer person owner ${hostName}`,
      icon: "Terminal",
      run: () => setHostFilter(hostId),
    });
  }
  for (const [value, label] of [
    ["working", "Working"],
    ["attention", "Needs attention"],
    ["unread", "Unread"],
    ["idle", "Idle"],
  ] as const) {
    paletteCommands.push({
      id: `filter-status-${value}`,
      label: `Filter by status: ${label}`,
      section: "Filter by status",
      searchOnly: true,
      keywords: `state ${label}`,
      icon: value === "working" ? "Loading" : value === "attention" ? "CircleQuestion" : "Check",
      run: () => setStatusFilter(value),
    });
  }
  paletteCommands.push({
    id: "filter-folder-unfiled",
    label: "Filter by folder: Unfiled",
    section: "Filter by folder",
    searchOnly: true,
    icon: "Folder",
    run: () => setFolderFilter(UNFILED_FILTER),
  });
  for (const section of folders.sections) {
    paletteCommands.push({
      id: `filter-folder-${section.id}`,
      label: `Filter by folder: ${section.name}`,
      section: "Filter by folder",
      searchOnly: true,
      keywords: `group organize ${section.name}`,
      icon: "Folder",
      run: () => setFolderFilter(section.id),
    });
  }
  if (
    scope !== ALL_PROJECTS ||
    providerFilter !== null ||
    hostFilter !== null ||
    statusFilter !== null ||
    folderFilter !== null
  ) {
    paletteCommands.push({
      id: "clear-filters",
      label: "Clear all sidebar filters",
      section: "Filters",
      shortcut: "⌥⌘⌫",
      keywords: "reset show everything",
      icon: "CircleX",
      run: () => {
        setScope(ALL_PROJECTS);
        setProviderFilter(null);
        setHostFilter(null);
        setStatusFilter(null);
        setFolderFilter(null);
      },
    });
  }
  paletteCommands.push(
    {
      id: "show-snoozed",
      label: showSnoozed ? "Hide snoozed threads" : "Show snoozed threads",
      section: "View",
      icon: "Clock",
      run: () => setShowSnoozed((current) => !current),
    },
    {
      id: "show-settled",
      label: showSettled ? "Hide settled threads" : "Show settled threads",
      section: "View",
      icon: "Check",
      run: () => setShowSettled((current) => !current),
    },
    {
      id: "open-kanban",
      label: "Open Kanban board",
      section: "Open view",
      keywords: "workflow columns board",
      icon: "ListTodo",
      run: () => window.location.assign("/plugins/kanban/board"),
    },
    {
      id: "open-linear",
      label: "Open Linear",
      section: "Open view",
      keywords: "issues tickets workspace",
      icon: "Workflow",
      run: () => window.location.assign("/plugins/linear/workspace"),
    },
  );

  const shortcutCommands: PaletteCommand[] = [
    {
      id: "open-command-palette",
      label: "Open command palette",
      section: "Global",
      shortcut: "⌘K",
      icon: "Command",
      run: openCommandPalette,
    },
    ...paletteCommands,
  ];
  const displayedPaletteCommands = paletteCommands.map((command) => ({
    ...command,
    shortcut: commandShortcuts[command.id]
      ? shortcutLabel(commandShortcuts[command.id])
      : command.shortcut,
  }));

  useEffect(() => {
    const onCustomShortcut = (event: KeyboardEvent) => {
      const shortcut = shortcutFromEvent(event);
      if (!shortcut) return;
      const commandId = Object.keys(commandShortcuts).find(
        (id) => commandShortcuts[id] === shortcut,
      );
      if (!commandId) return;
      const command = shortcutCommands.find((candidate) => candidate.id === commandId);
      if (!command) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      void command.run();
    };
    document.addEventListener("keydown", onCustomShortcut, true);
    return () => document.removeEventListener("keydown", onCustomShortcut, true);
  });

  return (
    <div
      data-t3-sidebar-root=""
      className="relative flex min-h-0 flex-1 flex-col"
    >
      {/* The one control the host has no equivalent for. Everything else in
          the chrome above — New thread, search — is bb's and stays bb's. */}
      <div className="flex shrink-0 items-center gap-1 px-2 pb-1">
        <Select value={scope} onValueChange={setScope}>
          {/* Ghost trigger: no border, no filled track — it reads as a label
              until you hover it. */}
          <SelectTrigger
            className="h-7 min-w-0 flex-1 border-0 px-1.5 py-1 text-xs font-medium text-muted-foreground shadow-none hover:bg-sidebar-accent focus:ring-0"
            aria-label={`Project scope: ${scopeLabel}`}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_PROJECTS} className="text-xs">
              All projects
            </SelectItem>
            {projects.map((project) => (
              <SelectItem
                key={project.id}
                value={project.id}
                className="text-xs"
              >
                {project.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <button
          type="button"
          aria-label="Show keyboard shortcuts"
          title="Keyboard shortcuts (⌘?)"
          onClick={() => {
            setCommandPaletteOpen(false);
            setShortcutCheatSheetOpen(true);
          }}
          className="rounded p-1.5 text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
        >
          <Icon name="CircleQuestion" className="size-3.5" />
        </button>
        <button
          type="button"
          aria-label="Open sidebar command palette"
          title="Command palette (⌘K)"
          onMouseDown={(event) => {
            event.preventDefault();
            openCommandPalette();
          }}
          className="rounded p-1.5 text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
        >
          <Icon name="Command" className="size-3.5" />
        </button>
        <button
          type="button"
          aria-label="Create folder"
          title="Create folder"
          onClick={() => setCreatingFolder(true)}
          className="rounded p-1.5 text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
        >
          <Icon name="Folder" className="size-3.5" />
        </button>
      </div>

      {providerFilter || hostFilter || statusFilter || folderFilter ? (
        <div
          aria-label="Active sidebar filters"
          className="flex shrink-0 flex-wrap items-center gap-1 px-2 pb-1"
        >
          {providerFilter ? (
            <FilterChip label={`Agent: ${providerFilter}`} onClear={() => setProviderFilter(null)} />
          ) : null}
          {hostFilter ? (
            <FilterChip label={`Machine: ${hosts.get(hostFilter) ?? hostFilter}`} onClear={() => setHostFilter(null)} />
          ) : null}
          {statusFilter ? (
            <FilterChip label={`Status: ${statusFilter}`} onClear={() => setStatusFilter(null)} />
          ) : null}
          {folderFilter ? (
            <FilterChip
              label={`Folder: ${
                folderFilter === UNFILED_FILTER
                  ? "Unfiled"
                  : folders.sections.find((section) => section.id === folderFilter)?.name ?? "Unknown"
              }`}
              onClear={() => setFolderFilter(null)}
            />
          ) : null}
        </div>
      ) : null}

      {creatingFolder ? (
        <form
          className="mx-2 mb-1 flex items-center gap-1"
          onSubmit={(event) => {
            event.preventDefault();
            void createFolder();
          }}
        >
          <input
            autoFocus
            aria-label="Folder name"
            value={newFolderName}
            onChange={(event) => setNewFolderName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setCreatingFolder(false);
            }}
            placeholder="Folder name"
            maxLength={80}
            className="h-7 min-w-0 flex-1 rounded border border-sidebar-border bg-background px-2 text-xs outline-none focus:border-ring"
          />
          <button
            type="submit"
            disabled={!newFolderName.trim() || busyFolderId === "__new__"}
            className="rounded p-1.5 text-muted-foreground hover:bg-sidebar-accent hover:text-foreground disabled:opacity-40"
            aria-label="Save folder"
          >
            <Icon name="Check" className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={() => {
              setCreatingFolder(false);
              setNewFolderName("");
            }}
            className="rounded p-1.5 text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
            aria-label="Cancel folder"
          >
            <Icon name="CircleX" className="size-3.5" />
          </button>
        </form>
      ) : null}

      {folderError || folders.error ? (
        <p role="alert" className="px-3 pb-1 text-2xs text-destructive-text">
          {folderError ?? folders.error}
        </p>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
        {status === "loading" ? null : status === "error" ? (
          <p
            role="status"
            className="px-2 py-6 text-center text-xs text-muted-foreground"
          >
            Could not load threads.
          </p>
        ) : (showUnfiledThreads ? pinned.length + inbox.length : 0) +
              snoozed.length + settled.length === 0 &&
          visibleFolderGroups.length === 0 ? (
          <p
            role="status"
            className="px-2 py-6 text-center text-xs text-muted-foreground"
          >
            {searchQuery.trim() ? "No threads found" : "No threads yet"}
          </p>
        ) : (
          <>
            {showUnfiledThreads && pinned.length > 0 ? (
              <Shelf label="Pinned">
                {pinned.map((thread) => (
                  <ThreadCard
                    key={thread.id}
                    thread={thread}
                    projectName={projectNameById.get(thread.projectId) ?? null}
                    isActive={thread.id === activeThreadId}
                    canPark={lifecycle.canPark(thread)}
                    onNavigate={onNavigate}
                    onSettle={() => void settleThread(thread.id)}
                    onSnooze={(until) => void snoozeThread(thread.id, until)}
                    onRename={(title) => renameThread(thread, title)}
                    now={now}
                    draggable
                    isDragging={draggedThreadId === thread.id}
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", thread.id);
                      setDraggedThreadId(thread.id);
                    }}
                    onDragEnd={() => {
                      setDraggedThreadId(null);
                      setDropTargetId(null);
                    }}
                  />
                ))}
              </Shelf>
            ) : null}
            {visibleFolderGroups.map(({ section, threads: folderThreads }) => (
                <FolderShelf
                  key={section.id}
                  section={section}
                  threads={folderThreads}
                  expanded={!collapsedFolderIds.has(section.id)}
                  busy={busyFolderId === section.id}
                  isDropTarget={dropTargetId === section.id}
                  isFolderDragging={draggedFolderId === section.id}
                  folderDragging={draggedFolderId !== null}
                  folderDropPosition={
                    folderDropTarget?.sectionId === section.id
                      ? folderDropTarget.position
                      : null
                  }
                  renaming={renamingFolderId === section.id}
                  nameDraft={folderNameDraft}
                  activeThreadId={activeThreadId}
                  projectNameById={projectNameById}
                  lifecycle={lifecycle}
                  now={now}
                  draggedThreadId={draggedThreadId}
                  onNavigate={onNavigate}
                  onRenameThread={(threadId, title) =>
                    renameThread(
                      folderThreads.find((thread) => thread.id === threadId)!,
                      title,
                    )
                  }
                  onSettleThread={(threadId) => void settleThread(threadId)}
                  onSnoozeThread={(threadId, until) =>
                    void snoozeThread(threadId, until)
                  }
                  onToggle={() => toggleFolder(section.id)}
                  onNameDraftChange={setFolderNameDraft}
                  onStartRename={() => {
                    setRenamingFolderId(section.id);
                    setFolderNameDraft(section.name);
                  }}
                  onCancelRename={() => setRenamingFolderId(null)}
                  onRename={() => void renameFolder(section.id)}
                  onDelete={() => void deleteFolder(section)}
                  onCreateThread={() => {
                    const projectId =
                      scope === ALL_PROJECTS ? activeProjectId : scope;
                    navigate.toPluginPanel("folder-new-thread", {
                      subPath: projectId
                        ? `${encodeURIComponent(section.id)}/${encodeURIComponent(projectId)}`
                        : encodeURIComponent(section.id),
                    });
                    onNavigate();
                  }}
                  colorPickerOpen={colorPickerFolderId === section.id}
                  onToggleColorPicker={() =>
                    setColorPickerFolderId((current) =>
                      current === section.id ? null : section.id,
                    )
                  }
                  onColorChange={(color) =>
                    void setFolderColor(section.id, color)
                  }
                  onDragStart={setDraggedThreadId}
                  onDragEnd={() => {
                    setDraggedThreadId(null);
                    setDropTargetId(null);
                  }}
                  onDragEnter={() => setDropTargetId(section.id)}
                  onDrop={() => void moveDraggedThread(section.id)}
                  onFolderDragStart={() => {
                    setDraggedThreadId(null);
                    setDropTargetId(null);
                    draggedFolderIdRef.current = section.id;
                    setDraggedFolderId(section.id);
                  }}
                  onFolderDragEnd={() => {
                    draggedFolderIdRef.current = null;
                    setDraggedFolderId(null);
                    setFolderDropTarget(null);
                  }}
                  onFolderDragOver={(position) =>
                    setFolderDropTarget({
                      sectionId: section.id,
                      position,
                    })
                  }
                  onFolderDrop={(position) =>
                    void reorderDraggedFolder(section.id, position)
                  }
                  onFolderKeyboardMove={(direction, toEdge) =>
                    void moveFolderWithKeyboard(section.id, direction, toEdge)
                  }
                />
              ))}
            {showUnfiledThreads && inbox.length > 0 ? (
              <Shelf
                label={pinned.length > 0 || folderGroups.length > 0 ? "Unfiled" : null}
                isDropTarget={dropTargetId === "__unfiled__"}
                onDragEnter={() => setDropTargetId("__unfiled__")}
                onDrop={() => void moveDraggedThread(null)}
              >
                {inbox.map((thread) => (
                  <ThreadCard
                    key={thread.id}
                    thread={thread}
                    projectName={projectNameById.get(thread.projectId) ?? null}
                    isActive={thread.id === activeThreadId}
                    canPark={lifecycle.canPark(thread)}
                    onNavigate={onNavigate}
                    onSettle={() => void settleThread(thread.id)}
                    onSnooze={(until) => void snoozeThread(thread.id, until)}
                    onRename={(title) => renameThread(thread, title)}
                    now={now}
                    draggable
                    isDragging={draggedThreadId === thread.id}
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", thread.id);
                      setDraggedThreadId(thread.id);
                    }}
                    onDragEnd={() => {
                      setDraggedThreadId(null);
                      setDropTargetId(null);
                    }}
                  />
                ))}
              </Shelf>
            ) : null}
            {inbox.length === 0 && draggedThreadId ? (
              <EmptyDropTarget
                active={dropTargetId === "__unfiled__"}
                onDragEnter={() => setDropTargetId("__unfiled__")}
                onDrop={() => void moveDraggedThread(null)}
              />
            ) : null}
            <ParkedShelf
              label="Snoozed"
              threads={snoozed}
              expanded={showSnoozed}
              onToggle={() => setShowSnoozed((open) => !open)}
              shelf="snoozed"
              activeThreadId={activeThreadId}
              lifecycle={lifecycle}
              onNavigate={onNavigate}
              onRestoreThread={restoreParkedThread}
              onRenameThread={renameThread}
            />
            <ParkedShelf
              label="Settled"
              threads={settled}
              expanded={showSettled}
              onToggle={() => setShowSettled((open) => !open)}
              shelf="settled"
              activeThreadId={activeThreadId}
              lifecycle={lifecycle}
              onNavigate={onNavigate}
              onRestoreThread={restoreParkedThread}
              onRenameThread={renameThread}
            />
          </>
        )}
      </div>
      {undoHistory.toastLabel ? (
        <UndoToast
          label={undoHistory.toastLabel}
          visible={undoHistory.toastVisible}
          depth={undoHistory.depth}
          isUndoing={undoHistory.isBusy}
          error={undoHistory.error}
          actionLabel={undoHistory.toastActionLabel}
          shortcut={undoHistory.toastShortcut}
          onAction={() => void undoHistory.toastAction()}
          onDismiss={undoHistory.dismiss}
          onPauseChange={undoHistory.setToastPaused}
        />
      ) : null}
      <CommandPalette
        open={commandPaletteOpen}
        commands={displayedPaletteCommands}
        onOpenChange={setCommandPaletteOpen}
      />
      <ShortcutCheatSheet
        open={shortcutCheatSheetOpen}
        onOpenChange={setShortcutCheatSheetOpen}
      />
      <ShortcutEditor
        open={shortcutEditorOpen}
        commands={shortcutCommands}
        shortcuts={commandShortcuts}
        onChange={setCommandShortcuts}
        onOpenChange={setShortcutEditorOpen}
      />
      <CustomSnoozeDialog
        open={customSnoozeThreadId !== null}
        onOpenChange={(open) => {
          if (!open) setCustomSnoozeThreadId(null);
        }}
        onSubmit={(snoozedUntil) =>
          customSnoozeThreadId
            ? snoozeThread(customSnoozeThreadId, snoozedUntil)
            : Promise.resolve()
        }
      />
    </div>
  );
}

function FilterChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <button
      type="button"
      onClick={onClear}
      aria-label={`Clear ${label}`}
      className="inline-flex h-6 max-w-full items-center gap-1 rounded-full border border-sidebar-border bg-sidebar-accent/60 px-2 text-2xs text-muted-foreground hover:text-foreground"
    >
      <span className="truncate">{label}</span>
      <Icon name="CircleX" className="size-3 shrink-0" />
    </button>
  );
}

function FolderShelf({
  section,
  threads,
  expanded,
  busy,
  isDropTarget,
  isFolderDragging,
  folderDragging,
  folderDropPosition,
  renaming,
  nameDraft,
  activeThreadId,
  projectNameById,
  lifecycle,
  now,
  draggedThreadId,
  onNavigate,
  onRenameThread,
  onSettleThread,
  onSnoozeThread,
  onToggle,
  onNameDraftChange,
  onStartRename,
  onCancelRename,
  onRename,
  onDelete,
  onCreateThread,
  colorPickerOpen,
  onToggleColorPicker,
  onColorChange,
  onDragStart,
  onDragEnd,
  onDragEnter,
  onDrop,
  onFolderDragStart,
  onFolderDragEnd,
  onFolderDragOver,
  onFolderDrop,
  onFolderKeyboardMove,
}: {
  section: SidebarSection;
  threads: readonly PluginSidebarThread[];
  expanded: boolean;
  busy: boolean;
  isDropTarget: boolean;
  isFolderDragging: boolean;
  folderDragging: boolean;
  folderDropPosition: "before" | "after" | null;
  renaming: boolean;
  nameDraft: string;
  activeThreadId: string | null;
  projectNameById: ReadonlyMap<string, string>;
  lifecycle: ReturnType<typeof useLifecycle>;
  now: number;
  draggedThreadId: string | null;
  onNavigate: () => void;
  onRenameThread: (threadId: string, title: string) => Promise<void>;
  onSettleThread: (threadId: string) => void;
  onSnoozeThread: (threadId: string, snoozedUntil: number) => void;
  onToggle: () => void;
  onNameDraftChange: (name: string) => void;
  onStartRename: () => void;
  onCancelRename: () => void;
  onRename: () => void;
  onDelete: () => void;
  onCreateThread: () => void;
  colorPickerOpen: boolean;
  onToggleColorPicker: () => void;
  onColorChange: (color: FolderColor) => void;
  onDragStart: (threadId: string) => void;
  onDragEnd: () => void;
  onDragEnter: () => void;
  onDrop: () => void;
  onFolderDragStart: () => void;
  onFolderDragEnd: () => void;
  onFolderDragOver: (position: "before" | "after") => void;
  onFolderDrop: (position: "before" | "after") => void;
  onFolderKeyboardMove: (
    direction: "up" | "down",
    toEdge: boolean,
  ) => void;
}) {
  const color = normalizeFolderColor(section.color ?? DEFAULT_FOLDER_COLORS[0]);
  const [customColorDraft, setCustomColorDraft] = useState(color);
  useEffect(() => {
    if (colorPickerOpen) setCustomColorDraft(color);
  }, [color, colorPickerOpen]);
  return (
    <section
      aria-label={section.name}
      data-folder-surface=""
      className={cn(
        "mt-2 overflow-hidden rounded-md border border-transparent transition-colors",
        isDropTarget && "border-primary/40 bg-primary/5",
        isFolderDragging && "opacity-55",
      )}
      style={{
        backgroundColor: folderColorWithAlpha(color, "20"),
        boxShadow:
          folderDropPosition === "before"
            ? "inset 0 2px 0 var(--primary)"
            : folderDropPosition === "after"
              ? "inset 0 -2px 0 var(--primary)"
              : undefined,
      }}
      onDragOver={(event) => {
        if (folderDragging || isFolderTransfer(event.dataTransfer)) {
          // The complete colored folder is a reorder target, not only its
          // narrow header. This also makes dropping over expanded cards work.
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          const bounds = event.currentTarget.getBoundingClientRect();
          onFolderDragOver(
            event.clientY < bounds.top + bounds.height / 2 ? "before" : "after",
          );
          return;
        }
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        onDragEnter();
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          // The parent clears the highlight on another target or drag end.
        }
      }}
      onDrop={(event) => {
        if (folderDragging || isFolderTransfer(event.dataTransfer)) {
          event.preventDefault();
          event.stopPropagation();
          const bounds = event.currentTarget.getBoundingClientRect();
          onFolderDrop(
            event.clientY < bounds.top + bounds.height / 2 ? "before" : "after",
          );
          return;
        }
        event.preventDefault();
        onDrop();
      }}
    >
      <div
        data-folder-id={section.id}
        tabIndex={0}
        role="group"
        aria-label={`Folder ${section.name}`}
        title="Drag to reorder · F2 rename · ⌥↑/↓ move"
        draggable={!renaming && !colorPickerOpen}
        onDragStart={(event) => {
          event.currentTarget.focus();
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData(FOLDER_DRAG_TYPE, section.id);
          event.dataTransfer.setData("text/plain", section.id);
          onFolderDragStart();
        }}
        onDragEnd={onFolderDragEnd}
        onDragOver={(event) => {
          if (!folderDragging && !isFolderTransfer(event.dataTransfer)) return;
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = "move";
          const bounds = event.currentTarget.getBoundingClientRect();
          onFolderDragOver(
            event.clientY < bounds.top + bounds.height / 2 ? "before" : "after",
          );
        }}
        onDrop={(event) => {
          if (!folderDragging && !isFolderTransfer(event.dataTransfer)) return;
          event.preventDefault();
          event.stopPropagation();
          const bounds = event.currentTarget.getBoundingClientRect();
          onFolderDrop(
            event.clientY < bounds.top + bounds.height / 2 ? "before" : "after",
          );
        }}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key === "F2") {
            event.preventDefault();
            onStartRename();
            return;
          }
          if (
            event.altKey &&
            (event.key === "ArrowUp" || event.key === "ArrowDown")
          ) {
            event.preventDefault();
            onFolderKeyboardMove(
              event.key === "ArrowUp" ? "up" : "down",
              event.shiftKey,
            );
            return;
          }
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onToggle();
          }
        }}
        className={cn(
          "group/folder flex h-8 items-center gap-1 rounded-md px-2",
          !renaming && !colorPickerOpen && "cursor-grab active:cursor-grabbing",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring",
        )}
      >
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-label={`${expanded ? "Collapse" : "Expand"} ${section.name}`}
          className="rounded p-1 text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
        >
          <Icon
            name="ChevronDown"
            className={cn("size-3 transition-transform", !expanded && "-rotate-90")}
          />
        </button>
        <button
          type="button"
          onClick={onToggleColorPicker}
          disabled={busy}
          aria-label={`Change color for ${section.name}`}
          aria-expanded={colorPickerOpen}
          title="Change folder color"
          className="rounded p-1 hover:bg-sidebar-accent disabled:opacity-40"
          style={{ color }}
        >
          <Icon name="Folder" className="size-3.5" />
        </button>
        {renaming ? (
          <form
            className="flex min-w-0 flex-1 items-center gap-1"
            onSubmit={(event) => {
              event.preventDefault();
              onRename();
            }}
          >
            <input
              autoFocus
              aria-label={`Rename ${section.name}`}
              value={nameDraft}
              onChange={(event) => onNameDraftChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") onCancelRename();
              }}
              maxLength={80}
              className="h-6 min-w-0 flex-1 rounded border border-sidebar-border bg-background px-1.5 text-xs outline-none focus:border-ring"
            />
            <button
              type="submit"
              disabled={!nameDraft.trim() || busy}
              aria-label="Save folder name"
              className="rounded p-1 text-muted-foreground hover:text-foreground disabled:opacity-40"
            >
              <Icon name="Check" className="size-3" />
            </button>
            <button
              type="button"
              onClick={onCancelRename}
              aria-label="Cancel rename"
              className="rounded p-1 text-muted-foreground hover:text-foreground"
            >
              <Icon name="CircleX" className="size-3" />
            </button>
          </form>
        ) : (
          <>
            <button
              type="button"
              onClick={onToggle}
              className="min-w-0 flex-1 truncate text-left text-xs font-medium text-muted-foreground"
            >
              {section.name}
            </button>
            <span className="text-2xs tabular-nums text-muted-foreground/70">
              {threads.length}
            </span>
            <span
              data-folder-actions=""
              className="flex w-16 shrink-0 items-center justify-end"
            >
              <span className="invisible flex items-center group-hover/folder:visible group-focus-within/folder:visible">
                <button
                  type="button"
                  onClick={onStartRename}
                  disabled={busy}
                  aria-label={`Rename ${section.name}`}
                  className="rounded p-1 text-muted-foreground hover:bg-sidebar-accent hover:text-foreground disabled:opacity-40"
                >
                  <Icon name="Edit" className="size-3" />
                </button>
                <button
                  type="button"
                  onClick={onDelete}
                  disabled={busy}
                  aria-label={`Delete ${section.name}`}
                  className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive-text disabled:opacity-40"
                >
                  <Icon name="Trash" className="size-3" />
                </button>
              </span>
              <button
                type="button"
                onClick={onCreateThread}
                disabled={busy}
                aria-label={`New thread in ${section.name}`}
                title={`New thread in ${section.name}`}
                className="rounded p-1 text-muted-foreground hover:bg-sidebar-accent hover:text-foreground disabled:opacity-40"
              >
                <Icon name="Add" className="size-3.5" />
              </button>
            </span>
          </>
        )}
      </div>
      {colorPickerOpen ? (
        <form
          aria-label={`Custom color for ${section.name}`}
          className="ml-9 flex flex-col gap-1 py-1 pr-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (isFolderColor(customColorDraft)) {
              onColorChange(customColorDraft);
            }
          }}
        >
          <div
            role="group"
            aria-label={`Preset colors for ${section.name}`}
            className="flex items-center gap-1"
          >
            {FOLDER_COLOR_PRESETS.map((preset) => (
              <button
                key={preset.color}
                type="button"
                onClick={() => onColorChange(preset.color)}
                disabled={busy}
                aria-label={`Set ${section.name} color to ${preset.label}`}
                aria-pressed={color === preset.color}
                title={preset.label}
                className={cn(
                  "flex size-6 items-center justify-center rounded-full hover:bg-foreground/10 disabled:opacity-40",
                  color === preset.color && "ring-1 ring-ring",
                )}
              >
                <span
                  className="size-3 rounded-full"
                  style={{ backgroundColor: preset.color }}
                />
              </button>
            ))}
          </div>
          <div className="flex w-full items-center gap-1">
            <input
              type="color"
              value={color}
              onChange={(event) => onColorChange(event.target.value)}
              disabled={busy}
              aria-label={`Pick custom color for ${section.name}`}
              title="Choose any RGB color"
              className="h-7 w-9 shrink-0 cursor-pointer rounded border border-sidebar-border bg-transparent p-0.5 disabled:opacity-40"
            />
            <input
              value={customColorDraft}
              onChange={(event) => setCustomColorDraft(event.target.value)}
              disabled={busy}
              aria-label={`Hex color for ${section.name}`}
              placeholder="#3b82f6"
              maxLength={7}
              className="h-7 min-w-0 flex-1 rounded border border-sidebar-border bg-background px-2 font-mono text-2xs outline-none focus:border-ring disabled:opacity-40"
            />
            <button
              type="submit"
              disabled={busy || !isFolderColor(customColorDraft)}
              aria-label={`Apply custom color for ${section.name}`}
              className="rounded p-1.5 text-muted-foreground hover:bg-sidebar-accent hover:text-foreground disabled:opacity-40"
            >
              <Icon name="Check" className="size-3.5" />
            </button>
          </div>
        </form>
      ) : null}
      {expanded ? (
        threads.length > 0 ? (
          <ul
            data-folder-thread-list=""
            className="ml-8 mr-1 flex flex-col gap-px pb-1"
          >
            {threads.map((thread) => (
              <ThreadCard
                key={thread.id}
                thread={thread}
                projectName={projectNameById.get(thread.projectId) ?? null}
                isActive={thread.id === activeThreadId}
                canPark={lifecycle.canPark(thread)}
                onNavigate={onNavigate}
                onSettle={() => onSettleThread(thread.id)}
                onSnooze={(until) => onSnoozeThread(thread.id, until)}
                onRename={(title) => onRenameThread(thread.id, title)}
                now={now}
                embedded
                draggable
                isDragging={draggedThreadId === thread.id}
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", thread.id);
                  onDragStart(thread.id);
                }}
                onDragEnd={onDragEnd}
              />
            ))}
          </ul>
        ) : (
          <p
            className="ml-8 px-2 pb-2 text-2xs text-muted-foreground/70"
          >
            Drop threads here
          </p>
        )
      ) : null}
    </section>
  );
}

function EmptyDropTarget({
  active,
  onDragEnter,
  onDrop,
}: {
  active: boolean;
  onDragEnter: () => void;
  onDrop: () => void;
}) {
  return (
    <div
      className={cn(
        "mx-1 mt-2 rounded-md border border-dashed border-sidebar-border px-3 py-2 text-2xs text-muted-foreground",
        active && "border-primary/40 bg-primary/5",
      )}
      onDragOver={(event) => {
        event.preventDefault();
        onDragEnter();
      }}
      onDrop={(event) => {
        event.preventDefault();
        onDrop();
      }}
    >
      Drop here to remove from a folder
    </div>
  );
}

/**
 * A collapsed shelf of parked threads. The header stays while anything is
 * parked — the count is the whole footprint when collapsed — and the shelf
 * vanishes entirely at zero.
 */
function ParkedShelf({
  label,
  threads,
  expanded,
  onToggle,
  shelf,
  activeThreadId,
  lifecycle,
  onNavigate,
  onRestoreThread,
  onRenameThread,
}: {
  label: string;
  threads: readonly PluginSidebarThread[];
  expanded: boolean;
  onToggle: () => void;
  shelf: "snoozed" | "settled";
  activeThreadId: string | null;
  lifecycle: ReturnType<typeof useLifecycle>;
  onNavigate: () => void;
  onRestoreThread: (
    thread: PluginSidebarThread,
    shelf: "snoozed" | "settled",
  ) => Promise<void>;
  onRenameThread: (
    thread: PluginSidebarThread,
    title: string,
  ) => Promise<void>;
}) {
  if (threads.length === 0) return null;
  const now = Date.now();
  return (
    <section aria-label={label}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        // Padded like a card, so the chevron ends on the same right edge as
        // every row's status and provider glyph.
        className="mt-3 flex w-full items-center gap-2 px-2.5 pb-1 text-left"
      >
        <span className="text-2xs font-medium text-muted-foreground/70">
          {expanded ? label : `${label} (${threads.length})`}
        </span>
        <span className="h-px flex-1 bg-sidebar-border" />
        <span className={TRAILING_GLYPH_BOX_CLASS}>
          <Icon
            name="ChevronDown"
            className={cn(
              "size-3 text-muted-foreground/70 transition-transform",
              expanded && "rotate-180",
            )}
          />
        </span>
      </button>
      {expanded ? (
        <ul className="flex flex-col gap-px">
          {threads.map((thread) => (
            <SlimRow
              key={thread.id}
              thread={thread}
              isActive={thread.id === activeThreadId}
              shelf={shelf}
              wakeAt={lifecycle.wakeAtFor(thread)}
              now={now}
              onNavigate={onNavigate}
              onRestore={() => void onRestoreThread(thread, shelf)}
              onRename={(title) => onRenameThread(thread, title)}
            />
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function Shelf({
  label,
  children,
  isDropTarget = false,
  onDragEnter,
  onDrop,
}: {
  label: string | null;
  children: React.ReactNode;
  isDropTarget?: boolean;
  onDragEnter?: () => void;
  onDrop?: () => void;
}) {
  return (
    // A named section is exposed as a landmark region; an unnamed one is not,
    // which is exactly right for the single unlabelled inbox list.
    <section
      {...(label ? { "aria-label": label } : {})}
      className={cn(
        "rounded-md border border-transparent transition-colors",
        isDropTarget && "border-primary/40 bg-primary/5",
      )}
      onDragOver={
        onDrop
          ? (event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              onDragEnter?.();
            }
          : undefined
      }
      onDrop={
        onDrop
          ? (event) => {
              event.preventDefault();
              onDrop();
            }
          : undefined
      }
    >
      {label ? (
        <h2 className={cn("flex items-center gap-2 px-2.5 pb-1 pt-3")}>
          <span className="text-2xs font-medium text-muted-foreground/70">
            {label}
          </span>
          <span className="h-px flex-1 bg-sidebar-border" />
        </h2>
      ) : null}
      <ul className="flex flex-col gap-px">{children}</ul>
    </section>
  );
}
