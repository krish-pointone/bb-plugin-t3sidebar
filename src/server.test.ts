import { describe, expect, it } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "./server";

describe("folder RPCs", () => {
  it("uses bb's native thread sections and thread assignment", async () => {
    const sections = [
      { id: "sec_1", name: "Focus", createdAt: 1, updatedAt: 1 },
    ];
    const updates: Array<{
      threadId: string;
      sectionId: string | null;
      title?: string;
    }> = [];
    const spawns: Array<Record<string, unknown>> = [];
    const { bb, harness } = createFakePluginHost({
      pluginId: "t3sidebar",
      sdk: {
        threadSections: {
          list: async () => sections,
          create: async ({ name }: { name: string }) => ({
            id: "sec_2",
            name,
            createdAt: 2,
            updatedAt: 2,
          }),
          update: async ({ id, name }: { id: string; name: string }) => ({
            id,
            name,
            updatedThreadCount: 0,
          }),
          delete: async ({ id }: { id: string }) => ({
            id,
            name: "Focus",
            updatedThreadCount: 3,
          }),
        },
        threads: {
          spawn: async (request) => {
            spawns.push(request as unknown as Record<string, unknown>);
            return { id: "thr_new" };
          },
          update: async ({
            threadId,
            sectionId,
            title,
          }: {
            threadId: string;
            sectionId?: string | null;
            title?: string | null;
          }) => {
            updates.push({ threadId, sectionId: sectionId ?? null, ...(title ? { title } : {}) });
            return { id: threadId };
          },
        },
      },
    });
    await plugin(bb);

    expect(await harness.behavior.callRpc("listSections", {})).toEqual({
      sections: [{ ...sections[0], color: null }],
    });
    expect(
      await harness.behavior.callRpc("createSection", { name: "Roadmap" }),
    ).toEqual({
      section: {
        id: "sec_2",
        name: "Roadmap",
        createdAt: 2,
        updatedAt: 2,
        color: "#3b82f6",
      },
    });
    expect(
      await harness.behavior.callRpc("setSectionColor", {
        sectionId: "sec_1",
        color: "#12ab34",
      }),
    ).toEqual({ ok: true });
    expect(await harness.behavior.callRpc("listSections", {})).toEqual({
      sections: [{ ...sections[0], color: "#12ab34" }],
    });
    expect(
      await harness.behavior.callRpc("deleteSection", { sectionId: "sec_1" }),
    ).toEqual({ ok: true, updatedThreadCount: 3 });
    await harness.behavior.callRpc("moveThreadToSection", {
      threadId: "thr_1",
      sectionId: "sec_1",
    });
    expect(updates).toEqual([{ threadId: "thr_1", sectionId: "sec_1" }]);
    await harness.behavior.callRpc("renameThread", {
      threadId: "thr_1",
      title: "A clearer name",
    });
    expect(updates).toContainEqual({
      threadId: "thr_1",
      sectionId: null,
      title: "A clearer name",
    });
    expect(
      await harness.behavior.callRpc("createThreadInSection", {
        sectionId: "sec_1",
        request: {
          projectId: "proj_1",
          providerId: "claude-code",
          model: "claude-opus-5[1m]",
          reasoningLevel: "ultracode",
          permissionMode: "auto",
          executionInputSources: {
            providerId: "client-preference",
            model: "client-preference",
            reasoningLevel: "client-preference",
            permissionMode: "client-preference",
          },
          environment: { type: "project-default" },
          input: [],
        },
      }),
    ).toEqual({ threadId: "thr_new" });
    expect(spawns).toEqual([
      expect.objectContaining({
        projectId: "proj_1",
        providerId: "claude-code",
        model: "claude-opus-5[1m]",
        reasoningLevel: "ultracode",
        input: [],
        sectionId: "sec_1",
        executionInputSources: {
          providerId: "explicit",
          model: "explicit",
          reasoningLevel: "explicit",
          permissionMode: "explicit",
        },
      }),
    ]);
    expect(harness.inspection.realtimeSignals.some((signal) => signal.channel === "sections")).toBe(true);
  });

  it("persists and returns a custom folder order", async () => {
    const sections = [
      { id: "sec_first", name: "First", createdAt: 1, updatedAt: 1 },
      { id: "sec_second", name: "Second", createdAt: 2, updatedAt: 2 },
    ];
    const { bb, harness } = createFakePluginHost({
      pluginId: "t3sidebar-order",
      sdk: {
        threadSections: {
          list: async () => sections,
        },
      },
    });
    await plugin(bb);

    await harness.behavior.callRpc("reorderSections", {
      sectionIds: ["sec_second", "sec_first"],
    });

    expect(await harness.behavior.callRpc("listSections", {})).toEqual({
      sections: [
        { ...sections[1], color: null },
        { ...sections[0], color: null },
      ],
    });
  });
});
