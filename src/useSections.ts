import { useCallback, useEffect, useRef, useState } from "react";
import {
  useRealtime,
  useRealtimeConnectionState,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import type { t3sidebarRpcContract } from "./server";
import type { FolderColor } from "./folderColors";
import type { NewThreadRequest } from "@get-bb/plugin-sdk/app";

export interface SidebarSection {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  color: FolderColor | null;
}

function orderedSections(
  sections: readonly SidebarSection[],
  sectionIds: readonly string[],
): SidebarSection[] {
  const positionById = new Map(
    sectionIds.map((sectionId, position) => [sectionId, position]),
  );
  return [...sections].sort(
    (left, right) =>
      (positionById.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
      (positionById.get(right.id) ?? Number.MAX_SAFE_INTEGER),
  );
}

export function useSections() {
  const rpc = useRpc<typeof t3sidebarRpcContract>();
  const [sections, setSections] = useState<SidebarSection[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const connectionState = useRealtimeConnectionState();
  const connectedOnce = useRef(false);
  const requestSeq = useRef(0);
  const pendingOrder = useRef<readonly string[] | null>(null);

  const refresh = useCallback(async () => {
    const seq = ++requestSeq.current;
    try {
      const result = await rpc.call("listSections", {});
      if (seq !== requestSeq.current) return;
      setSections(
        pendingOrder.current
          ? orderedSections(result.sections, pendingOrder.current)
          : result.sections,
      );
      setError(null);
    } catch (cause) {
      if (seq !== requestSeq.current) return;
      setError(cause instanceof Error ? cause.message : "Could not load folders");
    } finally {
      if (seq === requestSeq.current) setIsLoading(false);
    }
  }, [rpc]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useRealtime("sections", () => {
    void refresh();
  });

  useEffect(() => {
    if (connectionState !== "connected") return;
    if (connectedOnce.current) void refresh();
    connectedOnce.current = true;
  }, [connectionState, refresh]);

  const create = useCallback(
    async (name: string) => {
      const result = await rpc.call("createSection", { name });
      await refresh();
      return result.section;
    },
    [refresh, rpc],
  );

  const rename = useCallback(
    async (sectionId: string, name: string) => {
      await rpc.call("renameSection", { sectionId, name });
      await refresh();
    },
    [refresh, rpc],
  );

  const reorder = useCallback(
    async (sectionIds: string[]) => {
      // Keep all refreshes in the intended order while the persistence RPC is
      // in flight. A realtime/reconnect list can otherwise return the old
      // order after this optimistic update and make the folder snap back.
      const intendedOrder = [...sectionIds];
      pendingOrder.current = intendedOrder;
      requestSeq.current += 1;
      setSections((current) => orderedSections(current, intendedOrder));
      try {
        await rpc.call("reorderSections", { sectionIds: intendedOrder });
        // Confirm against persisted state. The server publishes before the RPC
        // returns, so this is also newer than any signal-triggered refresh.
        await refresh();
      } catch (cause) {
        if (pendingOrder.current === intendedOrder) pendingOrder.current = null;
        await refresh();
        throw cause;
      } finally {
        if (pendingOrder.current === intendedOrder) pendingOrder.current = null;
      }
    },
    [refresh, rpc],
  );

  const remove = useCallback(
    async (sectionId: string) => {
      const result = await rpc.call("deleteSection", { sectionId });
      await refresh();
      return result.updatedThreadCount;
    },
    [refresh, rpc],
  );

  const moveThread = useCallback(
    async (threadId: string, sectionId: string | null) => {
      await rpc.call("moveThreadToSection", { threadId, sectionId });
    },
    [rpc],
  );

  const renameThread = useCallback(
    async (threadId: string, title: string | null) => {
      await rpc.call("renameThread", { threadId, title });
    },
    [rpc],
  );

  const setColor = useCallback(
    async (sectionId: string, color: FolderColor) => {
      await rpc.call("setSectionColor", { sectionId, color });
      await refresh();
    },
    [refresh, rpc],
  );

  const createThread = useCallback(
    async (sectionId: string, request: NewThreadRequest) => {
      const result = await rpc.call("createThreadInSection", {
        sectionId,
        request,
      });
      return result.threadId;
    },
    [rpc],
  );

  return {
    sections,
    isLoading,
    error,
    create,
    rename,
    reorder,
    remove,
    moveThread,
    renameThread,
    setColor,
    createThread,
  };
}
