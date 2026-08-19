import { useCallback, useEffect, useRef, useState } from "react";

interface HistoryEntry {
  id: number;
  label: string;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
}

interface ToastEntry {
  id: number;
  label: string;
}

type HistoryDirection = "undo" | "redo";

const MAX_UNDO_DEPTH = 20;
const TOAST_DURATION_MS = 8_000;
const TOAST_ENTER_DELAY_MS = 20;

function isTextEditingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest("input, textarea, [contenteditable='true']") !== null
  );
}

export function useUndoStack() {
  const [past, setPast] = useState<HistoryEntry[]>([]);
  const [future, setFuture] = useState<HistoryEntry[]>([]);
  const pastRef = useRef<HistoryEntry[]>([]);
  const futureRef = useRef<HistoryEntry[]>([]);
  const nextId = useRef(1);
  const busyRef = useRef(false);
  const revealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [toastVisible, setToastVisible] = useState(false);
  const [toastPaused, setToastPaused] = useState(false);
  const [displayEntry, setDisplayEntry] = useState<ToastEntry | null>(null);
  const [toastAction, setToastAction] = useState<HistoryDirection>("undo");
  const [error, setError] = useState<string | null>(null);

  const replacePast = useCallback((next: HistoryEntry[]) => {
    pastRef.current = next;
    setPast(next);
  }, []);
  const replaceFuture = useCallback((next: HistoryEntry[]) => {
    futureRef.current = next;
    setFuture(next);
  }, []);

  const revealToast = useCallback((entry: ToastEntry) => {
    if (revealTimerRef.current !== null) clearTimeout(revealTimerRef.current);
    // Commit the closed transform first. A later task flips it open, giving
    // the browser two painted states to interpolate between.
    setDisplayEntry(entry);
    setToastVisible(false);
    revealTimerRef.current = setTimeout(() => {
      revealTimerRef.current = null;
      setToastVisible(true);
    }, TOAST_ENTER_DELAY_MS);
  }, []);

  const dismiss = useCallback(() => {
    if (revealTimerRef.current !== null) {
      clearTimeout(revealTimerRef.current);
      revealTimerRef.current = null;
    }
    setToastVisible(false);
  }, []);

  useEffect(
    () => () => {
      if (revealTimerRef.current !== null) clearTimeout(revealTimerRef.current);
    },
    [],
  );

  const push = useCallback(
    (
      label: string,
      undo: () => Promise<void>,
      redo: () => Promise<void>,
    ) => {
      const entry = { id: nextId.current++, label, undo, redo };
      replacePast([...pastRef.current, entry].slice(-MAX_UNDO_DEPTH));
      replaceFuture([]);
      setToastAction("undo");
      setError(null);
      revealToast(entry);
    },
    [replaceFuture, replacePast, revealToast],
  );

  const undo = useCallback(async () => {
    if (busyRef.current) return;
    const entry = pastRef.current.at(-1);
    if (!entry) return;
    const remaining = pastRef.current.slice(0, -1);
    replacePast(remaining);
    busyRef.current = true;
    setIsBusy(true);
    setError(null);
    try {
      await entry.undo();
      replaceFuture([...futureRef.current, entry].slice(-MAX_UNDO_DEPTH));
      setToastAction("redo");
      revealToast({ id: entry.id, label: `Undid: ${entry.label}` });
    } catch (cause) {
      replacePast([...remaining, entry]);
      setToastAction("undo");
      setError(cause instanceof Error ? cause.message : "Could not undo action");
      revealToast(entry);
    } finally {
      busyRef.current = false;
      setIsBusy(false);
    }
  }, [replaceFuture, replacePast, revealToast]);

  const redo = useCallback(async () => {
    if (busyRef.current) return;
    const entry = futureRef.current.at(-1);
    if (!entry) return;
    const remaining = futureRef.current.slice(0, -1);
    replaceFuture(remaining);
    busyRef.current = true;
    setIsBusy(true);
    setError(null);
    try {
      await entry.redo();
      replacePast([...pastRef.current, entry].slice(-MAX_UNDO_DEPTH));
      setToastAction("undo");
      revealToast({ id: entry.id, label: `Redid: ${entry.label}` });
    } catch (cause) {
      replaceFuture([...remaining, entry]);
      setToastAction("redo");
      setError(cause instanceof Error ? cause.message : "Could not redo action");
      revealToast(entry);
    } finally {
      busyRef.current = false;
      setIsBusy(false);
    }
  }, [replaceFuture, replacePast, revealToast]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        isTextEditingTarget(event.target) ||
        isTextEditingTarget(document.activeElement)
      ) {
        return;
      }
      const commandZ =
        event.key.toLowerCase() === "z" && (event.metaKey || event.ctrlKey);
      const controlY =
        event.key.toLowerCase() === "y" && event.ctrlKey && !event.metaKey;
      const wantsRedo = (commandZ && event.shiftKey) || controlY;
      const wantsUndo = commandZ && !event.shiftKey;
      if (
        (!wantsUndo && !wantsRedo) ||
        (wantsUndo && pastRef.current.length === 0) ||
        (wantsRedo && futureRef.current.length === 0)
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (wantsRedo) void redo();
      else void undo();
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [redo, undo]);

  useEffect(() => {
    if (!toastVisible || toastPaused || !displayEntry) return;
    const timer = setTimeout(() => setToastVisible(false), TOAST_DURATION_MS);
    return () => clearTimeout(timer);
  }, [displayEntry, toastPaused, toastVisible]);

  const action = toastAction === "redo" ? redo : undo;
  const depth = toastAction === "redo" ? future.length : past.length;

  return {
    push,
    undo,
    redo,
    toastAction: action,
    toastActionLabel:
      toastAction === "redo" ? ("Redo" as const) : ("Undo" as const),
    toastShortcut: toastAction === "redo" ? "⇧⌘Z" : "⌘Z",
    dismiss,
    setToastPaused,
    toastLabel: displayEntry?.label ?? null,
    depth,
    canUndo: past.length > 0,
    canRedo: future.length > 0,
    isBusy,
    toastVisible,
    error,
  };
}
