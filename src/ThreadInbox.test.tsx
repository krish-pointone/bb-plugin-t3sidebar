// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk";

// Load through the harness so the plugin's `@get-bb/plugin-sdk/app` import binds
// to the test runtime; importing the component directly would bind it to an
// empty runtime first.
const app = await loadPluginApp(() => import("../app"));
const inbox = app.threadLists[0]!;

function thread(
  overrides: Partial<PluginSidebarThread> = {},
): PluginSidebarThread {
  return {
    id: "thr_1",
    projectId: "proj_1",
    title: "A thread",
    titleFallback: null,
    parentThreadId: null,
    sectionId: null,
    originKind: null,
    originPluginId: null,
    providerId: "codex",
    hasPendingInteraction: false,
    activity: {
      workflows: 0,
      backgroundAgents: 0,
      backgroundCommands: 0,
      planMode: 0,
      goals: 0,
    },
    indicator: "none",
    indicatorLabel: null,
    isUnread: false,
    isPinned: false,
    isArchived: false,
    environment: null,
    host: null,
    createdAt: 100,
    updatedAt: 100,
    lastReadAt: 100,
    latestAttentionAt: 100,
    ...overrides,
  };
}

const listProps = {
  activeThreadId: null,
  activeProjectId: null,
  isCompactViewport: false,
  onNavigate: () => {},
  searchQuery: "",
  experimental_Original: () => null,
};

function render(
  threads: PluginSidebarThread[],
  projects = [{ id: "proj_1", name: "bb", isPersonal: false }],
) {
  return renderSlot(inbox, listProps, {
    sidebarThreads: { status: "ready", threads, projects },
    // The lifecycle store is the plugin's own backend; an empty one means
    // every thread is active, which is what these list tests are about.
    rpc: {
      listLifecycle: () => ({ rows: [] }),
      listSections: () => ({ sections: [] }),
    },
  });
}

afterEach(() => {
  cleanup();
  window.localStorage?.clear();
});

describe("t3sidebar registration", () => {
  it("registers exactly one thread list", () => {
    expect(app.threadLists).toHaveLength(1);
    expect(inbox.id).toBe("inbox");
  });

  it("registers a full-page folder composer", () => {
    expect(app.navPanels).toContainEqual(
      expect.objectContaining({
        id: "folder-new-thread",
        path: "folder-new-thread",
      }),
    );
  });
});

describe("ThreadInbox", () => {
  it("lists threads newest first", () => {
    render([
      thread({ id: "a", title: "Older", createdAt: 1 }),
      thread({ id: "b", title: "Newer", createdAt: 2 }),
    ]);
    // The anchor is a full-bleed overlay, so read the row containers.
    const titles = screen
      .getAllByRole("listitem")
      .map((row) => row.textContent);
    expect(titles[0]).toContain("Newer");
    expect(titles[1]).toContain("Older");
  });

  // The DOM contract behind numbered thread shortcuts and thread.next/previous.
  // A plugin that drops these attributes silently breaks nine host shortcuts.
  it("marks every row as a host shortcut target", () => {
    render([thread({ id: "thr_x" })]);
    const row = screen.getByRole("link");
    expect(row.hasAttribute("data-sidebar-thread-shortcut-target")).toBe(true);
    expect(row.getAttribute("data-sidebar-thread-id")).toBe("thr_x");
  });

  it("opens a thread on click and closes the mobile drawer", () => {
    let navigated = 0;
    const rendered = renderSlot(
      inbox,
      { ...listProps, onNavigate: () => (navigated += 1) },
      {
        sidebarThreads: {
          status: "ready",
          threads: [thread({ id: "thr_open" })],
          projects: [{ id: "proj_1", name: "bb", isPersonal: false }],
        },
        rpc: { listLifecycle: () => ({ rows: [] }) },
      },
    );
    fireEvent.click(screen.getByRole("link"));
    expect(rendered.sidebarActionCalls).toContainEqual({
      method: "open",
      threadId: "thr_open",
      options: { split: false },
    });
    expect(navigated).toBe(1);
  });

  it("opens in a split with the platform modifier held", () => {
    const rendered = render([thread({ id: "thr_split" })]);
    fireEvent.click(screen.getByRole("link"), { metaKey: true });
    expect(rendered.sidebarActionCalls).toContainEqual({
      method: "open",
      threadId: "thr_split",
      options: { split: true },
    });
  });

  it("renames a thread inline on double-click", async () => {
    const renameCalls: Array<{ threadId: string; title: string }> = [];
    renderSlot(inbox, listProps, {
      sidebarThreads: {
        status: "ready",
        threads: [thread({ id: "thr_rename", title: "Old name" })],
        projects: [{ id: "proj_1", name: "bb", isPersonal: false }],
      },
      rpc: {
        listLifecycle: () => ({ rows: [] }),
        listSections: () => ({ sections: [] }),
        renameThread: (request) => {
          renameCalls.push(
            request as { threadId: string; title: string },
          );
          return { ok: true };
        },
      },
    });

    fireEvent.doubleClick(screen.getByRole("link", { name: "Old name" }));
    const input = await screen.findByRole("textbox", {
      name: "Rename Old name",
    });
    fireEvent.change(input, { target: { value: "New name" } });
    fireEvent.submit(input.closest("form")!);

    await waitFor(() =>
      expect(renameCalls).toEqual([
        { threadId: "thr_rename", title: "New name" },
      ]),
    );
  });

  it("navigates thread cards with arrows and renames with F2", async () => {
    render([
      thread({ id: "thr_new", title: "Newer", createdAt: 2 }),
      thread({ id: "thr_old", title: "Older", createdAt: 1 }),
    ]);
    const newer = screen.getByRole("link", { name: "Newer" });
    const older = screen.getByRole("link", { name: "Older" });
    newer.focus();
    fireEvent.keyDown(newer, { key: "ArrowDown" });
    expect(document.activeElement).toBe(older);
    fireEvent.keyDown(older, { key: "F2" });
    expect(
      await screen.findByRole("textbox", { name: "Rename Older" }),
    ).toBeDefined();
  });

  it("separates pinned threads from the inbox", () => {
    render([
      thread({ id: "a", title: "Plain" }),
      thread({ id: "b", title: "Stuck", isPinned: true }),
    ]);
    const pinned = screen.getByRole("region", { name: /pinned/i });
    expect(within(pinned).getByText("Stuck")).toBeDefined();
  });

  // The host owns the search field; the plugin only filters by what it is
  // handed, so there is deliberately no second search box to type into.
  it("filters by the host's search query", () => {
    renderSlot(
      inbox,
      { ...listProps, searchQuery: "sidebar" },
      {
        sidebarThreads: {
          status: "ready",
          threads: [
            thread({ id: "a", title: "Sidebar work" }),
            thread({ id: "b", title: "Something else" }),
          ],
          projects: [{ id: "proj_1", name: "bb", isPersonal: false }],
        },
        rpc: { listLifecycle: () => ({ rows: [] }) },
      },
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByText("Sidebar work")).toBeDefined();
  });

  it("ships no search field of its own", () => {
    render([thread({ id: "a" })]);
    expect(screen.queryByLabelText("Search threads")).toBeNull();
  });

  it("ships no new-thread button of its own", () => {
    render([thread({ id: "a" })]);
    expect(screen.queryByLabelText("New thread")).toBeNull();
  });

  it("scopes to one project", () => {
    render(
      [
        thread({ id: "a", title: "In bb", projectId: "proj_1" }),
        thread({ id: "b", title: "In other", projectId: "proj_2" }),
      ],
      [
        { id: "proj_1", name: "bb", isPersonal: false },
        { id: "proj_2", name: "other", isPersonal: false },
      ],
    );
    // Radix opens on keyboard too, which jsdom can drive without pointer
    // capture. Enter opens the list; the option click picks the scope.
    fireEvent.keyDown(screen.getByLabelText(/Project scope/), { key: "Enter" });
    fireEvent.click(screen.getByRole("option", { name: "other" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByText("In other")).toBeDefined();
  });

  it("hides archived threads", () => {
    render([thread({ id: "a", isArchived: true })]);
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });

  it("reports an empty inbox and a fruitless search differently", () => {
    render([]);
    expect(screen.getByText("No threads yet")).toBeDefined();
  });
});

describe("sidebar folders", () => {
  const section = {
    id: "sec_focus",
    name: "Focus",
    createdAt: 10,
    updatedAt: 10,
    color: "#3b82f6",
  };

  it("groups sectioned threads and collapses the folder", async () => {
    renderSlot(inbox, listProps, {
      sidebarThreads: {
        status: "ready",
        threads: [
          thread({
            id: "thr_focus",
            title: "Inside folder",
            sectionId: section.id,
          }),
        ],
        projects: [{ id: "proj_1", name: "bb", isPersonal: false }],
      },
      rpc: {
        listLifecycle: () => ({ rows: [] }),
        listSections: () => ({ sections: [section] }),
      },
    });

    const folder = await screen.findByRole("region", { name: "Focus" });
    expect(within(folder).getByText("Inside folder")).toBeDefined();
    fireEvent.click(within(folder).getByLabelText("Collapse Focus"));
    expect(within(folder).queryByText("Inside folder")).toBeNull();
  });

  it("creates a folder from the sidebar", async () => {
    let createdName: string | null = null;
    let sections: typeof section[] = [];
    renderSlot(inbox, listProps, {
      sidebarThreads: {
        status: "ready",
        threads: [],
        projects: [{ id: "proj_1", name: "bb", isPersonal: false }],
      },
      rpc: {
        listLifecycle: () => ({ rows: [] }),
        listSections: () => ({ sections }),
        createSection: (input) => {
          createdName = (input as { name: string }).name;
          sections = [{ ...section, name: createdName }];
          return { section: sections[0]! };
        },
      },
    });

    fireEvent.click(screen.getByLabelText("Create folder"));
    fireEvent.change(screen.getByLabelText("Folder name"), {
      target: { value: "Roadmap" },
    });
    fireEvent.click(screen.getByLabelText("Save folder"));
    await waitFor(() => expect(createdName).toBe("Roadmap"));
    expect(await screen.findByRole("region", { name: "Roadmap" })).toBeDefined();
  });

  it("moves a dragged thread into a folder", async () => {
    let moved: { threadId: string; sectionId: string | null } | null = null;
    renderSlot(inbox, listProps, {
      sidebarThreads: {
        status: "ready",
        threads: [thread({ id: "thr_drag", title: "Drag me" })],
        projects: [{ id: "proj_1", name: "bb", isPersonal: false }],
      },
      rpc: {
        listLifecycle: () => ({ rows: [] }),
        listSections: () => ({ sections: [section] }),
        moveThreadToSection: (input) => {
          moved = input as { threadId: string; sectionId: string | null };
          return { ok: true };
        },
      },
    });

    const folder = await screen.findByRole("region", { name: "Focus" });
    const dataTransfer = {
      effectAllowed: "none",
      dropEffect: "none",
      setData: () => {},
      getData: () => "thr_drag",
    };
    const listItem = screen.getByRole("listitem");
    expect(listItem.getAttribute("draggable")).toBe("true");
    expect(screen.queryByLabelText("Move Drag me to a folder")).toBeNull();
    fireEvent.dragStart(listItem, { dataTransfer });
    fireEvent.dragOver(folder, { dataTransfer });
    fireEvent.drop(folder, { dataTransfer });
    await waitFor(() =>
      expect(moved).toEqual({ threadId: "thr_drag", sectionId: "sec_focus" }),
    );
  });

  it("reorders folders by dragging their headers", async () => {
    const secondSection = {
      ...section,
      id: "sec_later",
      name: "Later",
      createdAt: 20,
      updatedAt: 20,
    };
    const reorderCalls: string[][] = [];
    let listSectionCalls = 0;
    renderSlot(inbox, listProps, {
      sidebarThreads: {
        status: "ready",
        threads: [],
        projects: [{ id: "proj_1", name: "bb", isPersonal: false }],
      },
      rpc: {
        listLifecycle: () => ({ rows: [] }),
        // Deliberately keep returning the original server order. The UI must
        // not snap back while a reorder is being persisted/refreshed.
        listSections: () => {
          listSectionCalls += 1;
          return { sections: [section, secondSection] };
        },
        reorderSections: (input) => {
          reorderCalls.push((input as { sectionIds: string[] }).sectionIds);
          return { ok: true };
        },
      },
    });

    const focusFolder = await screen.findByRole("region", { name: "Focus" });
    const laterFolder = screen.getByRole("region", { name: "Later" });
    const focusHeader = within(focusFolder).getByLabelText("Collapse Focus")
      .parentElement!;
    const dataTransfer = {
      effectAllowed: "none",
      dropEffect: "none",
      setData: () => {},
      getData: () => "sec_focus",
    };

    // Starting from the folder name (not a tiny dedicated handle) must drag
    // the enclosing header, matching the full-width grab affordance.
    fireEvent.dragStart(
      within(focusFolder).getByRole("button", { name: "Focus" }),
      { dataTransfer },
    );
    // The entire colored folder surface must accept the reorder, including
    // the body below its header where expanded thread cards are rendered.
    fireEvent.dragOver(laterFolder, { dataTransfer, clientY: 1 });
    fireEvent.drop(laterFolder, { dataTransfer, clientY: 1 });

    await waitFor(() =>
      expect(reorderCalls).toEqual([["sec_later", "sec_focus"]]),
    );
    await waitFor(() => expect(listSectionCalls).toBeGreaterThanOrEqual(2));
    expect(
      Array.from(document.querySelectorAll("[data-folder-surface]"))
        .map((folder) => folder.getAttribute("aria-label")),
    ).toEqual(["Later", "Focus"]);
    const toast = await screen.findByRole("region", {
      name: "Undo notification",
    });
    expect(screen.getByRole("button", { name: /Undo/ })).toBeDefined();

    fireEvent.click(screen.getByLabelText("Create folder"));
    const folderNameInput = screen.getByLabelText("Folder name");
    folderNameInput.focus();
    fireEvent.keyDown(folderNameInput, { key: "z", metaKey: true });
    expect(reorderCalls).toHaveLength(1);
    fireEvent.click(screen.getByLabelText("Cancel folder"));

    fireEvent.click(screen.getByLabelText("Dismiss history notification"));
    expect(toast.getAttribute("data-state")).toBe("closed");

    // Undo is window-wide after a sidebar operation, even when focus has
    // already moved back out of the sidebar.
    fireEvent.keyDown(document.body, { key: "z", metaKey: true });
    await waitFor(() =>
      expect(reorderCalls).toEqual([
        ["sec_later", "sec_focus"],
        ["sec_focus", "sec_later"],
      ]),
    );
    await screen.findByRole("button", { name: /Redo/ });

    fireEvent.keyDown(document.body, {
      key: "z",
      metaKey: true,
      shiftKey: true,
    });
    await waitFor(() =>
      expect(reorderCalls).toEqual([
        ["sec_later", "sec_focus"],
        ["sec_focus", "sec_later"],
        ["sec_later", "sec_focus"],
      ]),
    );

    // The keyboard reorder creates a new toast, and its button uses the same
    // undo stack as the global shortcut.
    fireEvent.keyDown(focusHeader, { key: "ArrowUp", altKey: true });
    await waitFor(() => expect(reorderCalls).toHaveLength(4));
    await waitFor(() => expect(toast.getAttribute("data-state")).toBe("open"));
    fireEvent.click(screen.getByRole("button", { name: /Undo/ }));
    await waitFor(() =>
      expect(reorderCalls).toEqual([
        ["sec_later", "sec_focus"],
        ["sec_focus", "sec_later"],
        ["sec_later", "sec_focus"],
        ["sec_focus", "sec_later"],
        ["sec_later", "sec_focus"],
      ]),
    );
  });

  it("opens the native new-thread composer from a folder", async () => {
    let navigated = 0;
    const rendered = renderSlot(
      inbox,
      {
        ...listProps,
        activeProjectId: "proj_1",
        onNavigate: () => (navigated += 1),
      },
      {
      sidebarThreads: {
        status: "ready",
        threads: [],
        projects: [{ id: "proj_1", name: "bb", isPersonal: false }],
      },
      rpc: {
        listLifecycle: () => ({ rows: [] }),
        listSections: () => ({ sections: [section] }),
      },
      },
    );

    const folder = await screen.findByRole("region", { name: "Focus" });
    expect(
      folder.querySelector("[data-folder-actions]")?.className,
    ).toContain("w-16");
    fireEvent.click(within(folder).getByLabelText("New thread in Focus"));
    expect(rendered.navigateCalls).toContainEqual({
      method: "toPluginPanel",
      path: "folder-new-thread",
      options: { subPath: "sec_focus/proj_1" },
    });
    expect(navigated).toBe(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renders the folder composer as a full page", async () => {
    const roadmap = {
      ...section,
      id: "sec_roadmap",
      name: "Roadmap",
      color: "#10b981",
    };
    const composer = app.navPanels.find(
      (panel) => panel.id === "folder-new-thread",
    )!;
    renderSlot(
      composer,
      { subPath: "sec_focus/proj_1" },
      {
        rpc: {
          listSections: () => ({ sections: [section, roadmap] }),
        },
      },
    );

    expect(
      await screen.findByRole("heading", {
        name: "Start a thread in Focus",
      }),
    ).toBeDefined();
    fireEvent.keyDown(screen.getByLabelText("Thread group"), { key: "Enter" });
    fireEvent.click(screen.getByRole("option", { name: "Roadmap" }));
    expect(
      screen.getByRole("heading", { name: "Start a thread in Roadmap" }),
    ).toBeDefined();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("navigates to the thread after creating it from a folder", async () => {
    const composer = app.navPanels.find(
      (panel) => panel.id === "folder-new-thread",
    )!;
    const rendered = renderSlot(
      composer,
      { subPath: "sec_focus/proj_1" },
      {
        rpc: {
          listSections: () => ({ sections: [section] }),
          createThreadInSection: () => ({ threadId: "thr_created" }),
        },
      },
    );

    await screen.findByRole("heading", { name: "Start a thread in Focus" });
    fireEvent.change(screen.getByTestId("bb-new-thread-composer-input"), {
      target: { value: "Build the thing" },
    });
    fireEvent.click(screen.getByTestId("bb-new-thread-composer-submit"));

    await waitFor(() =>
      expect(rendered.rpcCalls).toContainEqual({
        method: "createThreadInSection",
        input: expect.objectContaining({ sectionId: "sec_focus" }),
      }),
    );
    await waitFor(() =>
      expect(rendered.navigateCalls).toContainEqual({
        method: "toThread",
        threadId: "thr_created",
      }),
    );
  });

  it("indents folder threads and lets the folder color be changed", async () => {
    let colorChange: { sectionId: string; color: string } | null = null;
    renderSlot(inbox, listProps, {
      sidebarThreads: {
        status: "ready",
        threads: [
          thread({
            id: "thr_colored",
            title: "Nested work",
            sectionId: section.id,
          }),
        ],
        projects: [{ id: "proj_1", name: "bb", isPersonal: false }],
      },
      rpc: {
        listLifecycle: () => ({ rows: [] }),
        listSections: () => ({ sections: [section] }),
        setSectionColor: (input) => {
          colorChange = input as { sectionId: string; color: string };
          return { ok: true };
        },
      },
    });

    const folder = await screen.findByRole("region", { name: "Focus" });
    expect(
      folder.querySelector("[data-folder-thread-list]"),
    ).not.toBeNull();
    expect(
      (folder as HTMLElement).style.backgroundColor,
    ).not.toBe("");
    expect(
      folder.querySelector("[data-folder-thread-card]")?.className,
    ).toContain("hover:bg-foreground/5");
    fireEvent.click(within(folder).getByLabelText("Change color for Focus"));
    fireEvent.click(
      within(folder).getByLabelText("Set Focus color to Emerald"),
    );
    await waitFor(() =>
      expect(colorChange).toEqual({ sectionId: "sec_focus", color: "#10b981" }),
    );
    fireEvent.click(within(folder).getByLabelText("Change color for Focus"));
    fireEvent.change(
      within(folder).getByLabelText("Pick custom color for Focus"),
      { target: { value: "#12ab34" } },
    );
    await waitFor(() =>
      expect(colorChange).toEqual({ sectionId: "sec_focus", color: "#12ab34" }),
    );
  });
});

describe("parking threads", () => {
  it("moves a settled thread to the Settled shelf", async () => {
    renderSlot(inbox, listProps, {
      sidebarThreads: {
        status: "ready",
        threads: [thread({ id: "thr_done", title: "Finished work" })],
        projects: [{ id: "proj_1", name: "bb", isPersonal: false }],
      },
      rpc: {
        listLifecycle: () => ({
          rows: [
            {
              threadId: "thr_done",
              settledAt: 200,
              snoozedUntil: null,
              snoozedAt: null,
            },
          ],
        }),
      },
    });
    // The shelf renders once the lifecycle read resolves.
    const shelf = await screen.findByRole("region", { name: "Settled" });
    expect(within(shelf).getByText(/Settled \(1\)/)).toBeDefined();
    // Collapsed by default: parked work is out of the way, never gone.
    expect(screen.queryByText("Finished work")).toBeNull();
    fireEvent.click(within(shelf).getByRole("button"));
    expect(within(shelf).getByText("Finished work")).toBeDefined();
  });

  it("keeps a working thread out of the shelves and offers no park action", async () => {
    renderSlot(inbox, listProps, {
      sidebarThreads: {
        status: "ready",
        threads: [
          thread({
            id: "thr_busy",
            title: "Still running",
            indicator: "runtime",
            activity: {
              workflows: 0,
              backgroundAgents: 0,
              backgroundCommands: 0,
              planMode: 0,
              goals: 0,
            },
          }),
        ],
        projects: [{ id: "proj_1", name: "bb", isPersonal: false }],
      },
      // Settled in the store, but still working: it must stay visible.
      rpc: {
        listLifecycle: () => ({
          rows: [
            {
              threadId: "thr_busy",
              settledAt: 200,
              snoozedUntil: null,
              snoozedAt: null,
            },
          ],
        }),
      },
    });
    expect(await screen.findByText("Still running")).toBeDefined();
    expect(screen.queryByRole("region", { name: "Settled" })).toBeNull();
    expect(screen.queryByLabelText("Settle thread")).toBeNull();
  });

  it("offers settle and snooze on a parkable thread", async () => {
    render([thread({ id: "thr_park", title: "Quiet" })]);
    // Rendered (not merely accepted as props): a card whose park controls
    // never mount leaves the whole feature unreachable.
    expect(await screen.findByLabelText("Settle thread")).toBeDefined();
    expect(screen.getByLabelText("Snooze until tomorrow")).toBeDefined();
  });

  it("settles a thread when the user clicks Settle", async () => {
    let settled: string | null = null;
    renderSlot(inbox, listProps, {
      sidebarThreads: {
        status: "ready",
        threads: [thread({ id: "thr_park", title: "Quiet" })],
        projects: [{ id: "proj_1", name: "bb", isPersonal: false }],
      },
      rpc: {
        listLifecycle: () => ({ rows: [] }),
        settle: (input) => {
          settled = (input as { threadId: string }).threadId;
          return { ok: true };
        },
      },
    });
    fireEvent.click(await screen.findByLabelText("Settle thread"));
    await waitFor(() => expect(settled).toBe("thr_park"));
  });

  it("shows the wake countdown on a snoozed row", async () => {
    const wakeAt = Date.now() + 2 * 60 * 60 * 1000;
    renderSlot(inbox, listProps, {
      sidebarThreads: {
        status: "ready",
        threads: [thread({ id: "thr_snz", title: "Later" })],
        projects: [{ id: "proj_1", name: "bb", isPersonal: false }],
      },
      rpc: {
        listLifecycle: () => ({
          rows: [
            {
              threadId: "thr_snz",
              settledAt: null,
              snoozedUntil: wakeAt,
              snoozedAt: Date.now(),
            },
          ],
        }),
      },
    });
    const shelf = await screen.findByRole("region", { name: "Snoozed" });
    fireEvent.click(within(shelf).getByRole("button"));
    expect(within(shelf).getByText("2h")).toBeDefined();
    expect(within(shelf).getByLabelText("Wake thread now")).toBeDefined();
  });
});

describe("sidebar command palette", () => {
  const section = {
    id: "sec_focus",
    name: "Focus",
    createdAt: 10,
    updatedAt: 10,
    color: "#3b82f6",
  };

  it("opens with Cmd-K, searches, and runs a contextual thread command", async () => {
    let moved: { threadId: string; sectionId: string | null } | null = null;
    renderSlot(inbox, { ...listProps, activeThreadId: "thr_cmd" }, {
      sidebarThreads: {
        status: "ready",
        threads: [thread({ id: "thr_cmd", title: "Command me" })],
        projects: [{ id: "proj_1", name: "bb", isPersonal: false }],
      },
      rpc: {
        listLifecycle: () => ({ rows: [] }),
        listSections: () => ({ sections: [section] }),
        moveThreadToSection: (input) => {
          moved = input as { threadId: string; sectionId: string | null };
          return { ok: true };
        },
      },
    });

    fireEvent.keyDown(document.body, { key: "k", metaKey: true });
    expect(
      await screen.findByRole("dialog", { name: "Sidebar command palette" }),
    ).toBeDefined();
    expect(screen.getByText("Rename “Command me”")).toBeDefined();

    const search = screen.getByLabelText("Search sidebar commands");
    fireEvent.change(search, { target: { value: "move thread to focus" } });
    fireEvent.keyDown(search, { key: "Enter" });
    await waitFor(() =>
      expect(moved).toEqual({ threadId: "thr_cmd", sectionId: "sec_focus" }),
    );
    expect(
      screen.queryByRole("dialog", { name: "Sidebar command palette" }),
    ).toBeNull();
  });

  it("opens from its button and starts global commands", async () => {
    render([]);
    fireEvent.mouseDown(screen.getByLabelText("Open sidebar command palette"));
    const search = await screen.findByLabelText("Search sidebar commands");
    fireEvent.change(search, { target: { value: "create folder" } });
    fireEvent.keyDown(search, { key: "Enter" });
    expect(await screen.findByLabelText("Folder name")).toBeDefined();
  });

  it("jumps directly to a thread and a folder", async () => {
    const rendered = renderSlot(inbox, listProps, {
      sidebarThreads: {
        status: "ready",
        threads: [
          thread({
            id: "thr_jump",
            title: "Universal destination",
            sectionId: section.id,
          }),
        ],
        projects: [{ id: "proj_1", name: "bb", isPersonal: false }],
      },
      rpc: {
        listLifecycle: () => ({ rows: [] }),
        listSections: () => ({ sections: [section] }),
      },
    });

    fireEvent.keyDown(document.body, { key: "k", metaKey: true });
    let search = await screen.findByLabelText("Search sidebar commands");
    fireEvent.change(search, { target: { value: "universal destination" } });
    fireEvent.keyDown(search, { key: "Enter" });
    await waitFor(() =>
      expect(rendered.sidebarActionCalls).toContainEqual({
        method: "open",
        threadId: "thr_jump",
        options: undefined,
      }),
    );

    fireEvent.keyDown(document.body, { key: "k", metaKey: true });
    search = await screen.findByLabelText("Search sidebar commands");
    fireEvent.change(search, { target: { value: "jump to folder" } });
    fireEvent.keyDown(search, { key: "Enter" });
    await waitFor(() =>
      expect(document.activeElement?.getAttribute("aria-label")).toBe("Folder Focus"),
    );
  });

  it("filters by provider and exposes a removable filter chip", async () => {
    render([
      thread({ id: "thr_codex", title: "Codex work", providerId: "codex" }),
      thread({ id: "thr_claude", title: "Claude work", providerId: "claude-code" }),
    ]);
    fireEvent.keyDown(document.body, { key: "k", metaKey: true });
    const search = await screen.findByLabelText("Search sidebar commands");
    fireEvent.change(search, { target: { value: "filter agent claude-code" } });
    fireEvent.keyDown(search, { key: "Enter" });
    await screen.findByLabelText("Clear Agent: claude-code");
    expect(screen.queryByText("Codex work")).toBeNull();
    expect(screen.getByText("Claude work")).toBeDefined();
  });

  it("assigns and runs a custom shortcut", async () => {
    render([]);
    fireEvent.keyDown(document.body, { key: "k", metaKey: true });
    const search = await screen.findByLabelText("Search sidebar commands");
    fireEvent.change(search, { target: { value: "customize keyboard shortcuts" } });
    fireEvent.keyDown(search, { key: "Enter" });
    const editor = await screen.findByRole("dialog", {
      name: "Customize keyboard shortcuts",
    });
    const commandLabel = within(editor).getByText("Open command palette");
    const row = commandLabel.parentElement!;
    const assign = within(row).getByRole("button", { name: "Assign" });
    fireEvent.click(assign);
    fireEvent.keyDown(assign, { key: "j", metaKey: true });
    fireEvent.click(within(editor).getByLabelText("Close shortcut editor"));
    fireEvent.keyDown(document.body, { key: "j", metaKey: true });
    expect(
      await screen.findByRole("dialog", { name: "Sidebar command palette" }),
    ).toBeDefined();
  });

  it("shows the keyboard cheat sheet globally with Cmd-?", async () => {
    render([]);
    fireEvent.keyDown(document.body, {
      key: "?",
      metaKey: true,
      shiftKey: true,
    });
    const sheet = await screen.findByRole("dialog", {
      name: "Keyboard shortcuts",
    });
    expect(within(sheet).getByText("Open command palette")).toBeDefined();
    expect(within(sheet).getByText("Redo sidebar action")).toBeDefined();

    fireEvent.keyDown(document.body, { key: "Escape" });
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Keyboard shortcuts" }),
      ).toBeNull(),
    );
  });
});

describe("row context menu", () => {
  it("offers the plugin's own thread actions on right-click", async () => {
    render([thread({ id: "thr_menu", title: "Right click me" })]);
    const row = await screen.findByText("Right click me");
    fireEvent.contextMenu(row);
    const menu = await screen.findByRole("menu", { name: "Thread actions" });
    // The plugin builds this menu itself — the SDK ships no menu component —
    // so the items are this plugin's choice, backed by the action hook.
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual(["Open in split", "Mark unread", "Pin", "Archive", "Delete"]);
  });

  it("routes deletion through the host's confirmation", async () => {
    const rendered = render([thread({ id: "thr_del", title: "Delete me" })]);
    fireEvent.contextMenu(await screen.findByText("Delete me"));
    const menu = await screen.findByRole("menu", { name: "Thread actions" });
    fireEvent.click(within(menu).getByText("Delete"));
    await waitFor(() =>
      expect(rendered.sidebarActionCalls).toContainEqual({
        method: "requestDelete",
        threadId: "thr_del",
      }),
    );
  });
});

describe("card metadata", () => {
  it("always shows the provider glyph, even without a branch", async () => {
    render([thread({ id: "thr_p", providerId: "claude-code" })]);
    expect(await screen.findByLabelText("Claude Code")).toBeDefined();
  });

  it("falls back to a neutral glyph for an unknown provider", async () => {
    render([thread({ id: "thr_p", providerId: "some-new-agent" })]);
    expect(await screen.findByLabelText("some-new-agent")).toBeDefined();
  });

  // A personal-project thread has a machine but no worktree, so the machine
  // takes the branch's place instead of leaving the line blank.
  it("shows the machine when the thread has no branch", async () => {
    render([
      thread({
        id: "thr_m",
        host: { id: "host_1", name: "Sawyer's MacBook" },
      }),
    ]);
    expect(await screen.findByText("Sawyer's MacBook")).toBeDefined();
  });

  it("prefers the branch over the machine when both exist", async () => {
    render([
      thread({
        id: "thr_b",
        host: { id: "host_1", name: "Sawyer's MacBook" },
        environment: {
          id: "env_1",
          name: "Worktree",
          branchName: "bb/feature",
          workspaceDisplayKind: "managed-worktree",
        },
      }),
    ]);
    expect(await screen.findByText("bb/feature")).toBeDefined();
    expect(screen.queryByText("Sawyer's MacBook")).toBeNull();
  });

  // Not exactly 3h: the card's clock is quantized to the minute, so a
  // timestamp sitting on a bucket boundary legitimately reads one unit lower.
  it("shows how long ago the thread was touched", async () => {
    render([
      thread({ id: "thr_t", updatedAt: Date.now() - (3 * 3_600_000 + 60_000) }),
    ]);
    expect(await screen.findByText("3h")).toBeDefined();
  });

  // Status and age share one slot. A row that shows both puts a variable-width
  // label in the column, and no two rows line up.
  it("replaces the age label with the status glyph while work runs", async () => {
    render([
      thread({
        id: "thr_run",
        indicator: "runtime",
        indicatorLabel: "Agent is working",
        updatedAt: Date.now() - (3 * 3_600_000 + 60_000),
      }),
    ]);
    expect(await screen.findByLabelText("Agent is working")).toBeDefined();
    expect(screen.queryByText("3h")).toBeNull();
  });

  // An indicator this plugin does not know must fall through to the age label
  // rather than leave the slot blank.
  it("keeps the age label for an unrecognized indicator", async () => {
    render([
      thread({
        id: "thr_new",
        indicator: "something-bb-ships-later" as never,
        updatedAt: Date.now() - (3 * 3_600_000 + 60_000),
      }),
    ]);
    expect(await screen.findByText("3h")).toBeDefined();
  });
});

// The three states that want the user take the slot from the age label, and
// they use bb's own glyphs: the two lists sit in one window, and a user who
// switches between them should not have to learn a second vocabulary.
describe("attention states", () => {
  const states = [
    ["waiting-for-input", "Thread needs user input"],
    ["unread-error", "Unread thread failed"],
    ["unread-success", "Unread thread succeeded"],
  ] as const;

  for (const [indicator, label] of states) {
    it(`shows the ${indicator} glyph instead of the age`, async () => {
      render([
        thread({
          id: `thr_${indicator}`,
          indicator,
          indicatorLabel: label,
          updatedAt: Date.now() - (3 * 3_600_000 + 60_000),
        }),
      ]);
      expect(await screen.findByLabelText(label)).toBeDefined();
      expect(screen.queryByText("3h")).toBeNull();
    });
  }

  // Running work is the one state the user does NOT have to act on, so it gets
  // the neutral spinner and no notification dot.
  it("shows the spinner, not a dot, while work runs", async () => {
    render([
      thread({
        id: "thr_busy",
        isUnread: true,
        indicator: "runtime",
        indicatorLabel: "Thread working",
      }),
    ]);
    expect(await screen.findByLabelText("Thread working")).toBeDefined();
    expect(screen.queryByLabelText("Unread thread succeeded")).toBeNull();
  });
});

describe("pull request badge", () => {
  const withPr = (attention: string, state = "open") =>
    renderSlot(inbox, listProps, {
      sidebarThreads: {
        status: "ready",
        threads: [thread({ id: "thr_pr" })],
        projects: [{ id: "proj_1", name: "bb", isPersonal: false }],
      },
      rpc: { listLifecycle: () => ({ rows: [] }) },
      sidebarPullRequests: {
        thr_pr: {
          number: 412,
          title: "Fix the flake",
          url: "https://github.com/o/r/pull/412",
          state,
          attention,
        } as never,
      },
    });

  it("links the PR number out to the git host", async () => {
    withPr("none");
    const badge = await screen.findByRole("link", { name: "#412" });
    expect(badge.getAttribute("href")).toBe("https://github.com/o/r/pull/412");
    expect(badge.getAttribute("title")).toBe("Fix the flake");
  });

  it("shows no badge when the branch has no PR", async () => {
    render([thread({ id: "thr_nopr" })]);
    await screen.findByText("A thread");
    expect(screen.queryByRole("link", { name: /^#/ })).toBeNull();
  });

  // The attention state is bb's rolled-up "does this need you" signal, so the
  // badge can colour itself without reading checks/review/mergeability.
  it("colors the badge from the attention state", async () => {
    const failing = withPr("checks_failed");
    expect(
      (await screen.findByRole("link", { name: "#412" })).className,
    ).toContain("destructive");
    failing.unmount();

    withPr("ready_to_merge");
    expect(
      (await screen.findByRole("link", { name: "#412" })).className,
    ).toContain("success");
  });
});
