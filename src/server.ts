// bb-plugin-t3sidebar backend — the settled / snoozed store.
//
// This state lives in the plugin's own SQLite database, never on bb's thread.
// Putting it on the thread would mean a schema change, a wire change, and a
// HOST_DAEMON_PROTOCOL_VERSION bump for something only this sidebar
// understands. Here, uninstalling the plugin removes its state with it.
import {
  defineRpcContract,
  type BbPluginApi,
  type NewThreadRequest,
} from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  DEFAULT_FOLDER_COLORS,
  normalizeFolderColor,
  type FolderColor,
} from "./folderColors";

const migrations = [
  `CREATE TABLE IF NOT EXISTS thread_lifecycle (
     thread_id      TEXT PRIMARY KEY,
     settled_at     INTEGER,
     snoozed_until  INTEGER,
     snoozed_at     INTEGER
   )`,
  `CREATE TABLE IF NOT EXISTS section_colors (
     section_id TEXT PRIMARY KEY,
     color      TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS section_order (
     section_id TEXT PRIMARY KEY,
     position   INTEGER NOT NULL
   )`,
];

export interface StoredLifecycleRow {
  threadId: string;
  settledAt: number | null;
  snoozedUntil: number | null;
  snoozedAt: number | null;
}

interface LifecycleDbRow {
  thread_id: string;
  settled_at: number | null;
  snoozed_until: number | null;
  snoozed_at: number | null;
}

const threadIdSchema = z.object({ threadId: z.string().trim().min(1) });
const folderColorSchema = z.string().regex(/^#[0-9a-f]{6}$/i);
const newThreadRequestSchema = z.custom<NewThreadRequest>(
  (value) =>
    typeof value === "object" &&
    value !== null &&
    typeof (value as { projectId?: unknown }).projectId === "string" &&
    Array.isArray((value as { input?: unknown }).input),
);
const sectionSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  color: folderColorSchema.nullable(),
});

export const t3sidebarRpcContract = defineRpcContract({
  listLifecycle: {
    input: z.object({}),
    output: z.object({
      rows: z.array(
        z.object({
          threadId: z.string(),
          settledAt: z.number().nullable(),
          snoozedUntil: z.number().nullable(),
          snoozedAt: z.number().nullable(),
        }),
      ),
    }),
  },
  settle: { input: threadIdSchema, output: z.object({ ok: z.boolean() }) },
  unsettle: { input: threadIdSchema, output: z.object({ ok: z.boolean() }) },
  snooze: {
    input: z.object({
      threadId: z.string().trim().min(1),
      // Absolute wake time, so a snooze means the same thing on every device.
      snoozedUntil: z.number().int().positive(),
    }),
    output: z.object({ ok: z.boolean() }),
  },
  unsnooze: { input: threadIdSchema, output: z.object({ ok: z.boolean() }) },
  listSections: {
    input: z.object({}),
    output: z.object({ sections: z.array(sectionSchema) }),
  },
  createSection: {
    input: z.object({ name: z.string().trim().min(1).max(80) }),
    output: z.object({ section: sectionSchema }),
  },
  renameSection: {
    input: z.object({
      sectionId: z.string().trim().min(1),
      name: z.string().trim().min(1).max(80),
    }),
    output: z.object({ ok: z.boolean() }),
  },
  reorderSections: {
    input: z.object({
      sectionIds: z.array(z.string().trim().min(1)).min(1),
    }),
    output: z.object({ ok: z.boolean() }),
  },
  deleteSection: {
    input: z.object({ sectionId: z.string().trim().min(1) }),
    output: z.object({ ok: z.boolean(), updatedThreadCount: z.number() }),
  },
  moveThreadToSection: {
    input: z.object({
      threadId: z.string().trim().min(1),
      sectionId: z.string().trim().min(1).nullable(),
    }),
    output: z.object({ ok: z.boolean() }),
  },
  renameThread: {
    input: z.object({
      threadId: z.string().trim().min(1),
      title: z.string().trim().min(1).max(500).nullable(),
    }),
    output: z.object({ ok: z.boolean() }),
  },
  setSectionColor: {
    input: z.object({
      sectionId: z.string().trim().min(1),
      color: folderColorSchema,
    }),
    output: z.object({ ok: z.boolean() }),
  },
  createThreadInSection: {
    input: z.object({
      sectionId: z.string().trim().min(1),
      request: newThreadRequestSchema,
    }),
    output: z.object({ threadId: z.string() }),
  },
});

/** Channel the frontend re-reads on. */
export const LIFECYCLE_CHANNEL = "lifecycle";
export const SECTIONS_CHANNEL = "sections";

export default function plugin(bb: BbPluginApi) {
  const db = bb.storage.database();
  bb.storage.migrate(db, migrations);

  const readAll = (): StoredLifecycleRow[] =>
    (
      db
        .prepare(
          `SELECT thread_id, settled_at, snoozed_until, snoozed_at
             FROM thread_lifecycle`,
        )
        .all() as LifecycleDbRow[]
    ).map((row) => ({
      threadId: row.thread_id,
      settledAt: row.settled_at,
      snoozedUntil: row.snoozed_until,
      snoozedAt: row.snoozed_at,
    }));

  const write = (row: StoredLifecycleRow): void => {
    db.prepare(
      `INSERT INTO thread_lifecycle
         (thread_id, settled_at, snoozed_until, snoozed_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(thread_id) DO UPDATE SET
         settled_at = excluded.settled_at,
         snoozed_until = excluded.snoozed_until,
         snoozed_at = excluded.snoozed_at`,
    ).run(row.threadId, row.settledAt, row.snoozedUntil, row.snoozedAt);
    bb.realtime.publish(LIFECYCLE_CHANNEL, { threadId: row.threadId });
  };

  const clear = (threadId: string): void => {
    db.prepare(`DELETE FROM thread_lifecycle WHERE thread_id = ?`).run(
      threadId,
    );
    bb.realtime.publish(LIFECYCLE_CHANNEL, { threadId });
  };

  const readSectionColors = (): Map<string, FolderColor> =>
    new Map(
      (
        db
          .prepare(`SELECT section_id, color FROM section_colors`)
          .all() as Array<{ section_id: string; color: FolderColor }>
      ).map((row) => [row.section_id, normalizeFolderColor(row.color)]),
    );

  const readSectionOrder = (): Map<string, number> =>
    new Map(
      (
        db
          .prepare(`SELECT section_id, position FROM section_order`)
          .all() as Array<{ section_id: string; position: number }>
      ).map((row) => [row.section_id, row.position]),
    );

  bb.rpc.register(t3sidebarRpcContract, {
    async listLifecycle() {
      return { rows: readAll() };
    },
    async settle({ threadId }) {
      // Settling clears any snooze: they are two answers to the same
      // question, and holding both would make the shelf order ambiguous.
      write({
        threadId,
        settledAt: Date.now(),
        snoozedUntil: null,
        snoozedAt: null,
      });
      return { ok: true };
    },
    async unsettle({ threadId }) {
      clear(threadId);
      return { ok: true };
    },
    async snooze({ threadId, snoozedUntil }) {
      const now = Date.now();
      write({
        threadId,
        settledAt: null,
        snoozedUntil,
        snoozedAt: now,
      });
      return { ok: true };
    },
    async unsnooze({ threadId }) {
      clear(threadId);
      return { ok: true };
    },
    async listSections() {
      const colors = readSectionColors();
      const order = readSectionOrder();
      const sections = await bb.sdk.threadSections.list();
      return {
        sections: sections
          .map((section, nativePosition) => ({ section, nativePosition }))
          .sort((left, right) => {
            const leftPosition =
              order.get(left.section.id) ?? left.nativePosition;
            const rightPosition =
              order.get(right.section.id) ?? right.nativePosition;
            return leftPosition - rightPosition;
          })
          .map(({ section }) => ({
            ...section,
            color: colors.get(section.id) ?? null,
          })),
      };
    },
    async createSection({ name }) {
      const existingSectionCount = (await bb.sdk.threadSections.list()).length;
      const section = await bb.sdk.threadSections.create({ name });
      const color =
        DEFAULT_FOLDER_COLORS[
          readSectionColors().size % DEFAULT_FOLDER_COLORS.length
        ]!;
      db.prepare(
        `INSERT INTO section_colors (section_id, color) VALUES (?, ?)`,
      ).run(section.id, color);
      const greatestStoredPosition = (
          db
            .prepare(`SELECT MAX(position) AS position FROM section_order`)
            .get() as { position: number | null }
        ).position;
      const nextPosition = Math.max(
        greatestStoredPosition ?? -1,
        existingSectionCount - 1,
      ) + 1;
      db.prepare(
        `INSERT INTO section_order (section_id, position) VALUES (?, ?)`,
      ).run(section.id, nextPosition + 1);
      bb.realtime.publish(SECTIONS_CHANNEL, { sectionId: section.id });
      return { section: { ...section, color } };
    },
    async renameSection({ sectionId, name }) {
      await bb.sdk.threadSections.update({ id: sectionId, name });
      bb.realtime.publish(SECTIONS_CHANNEL, { sectionId });
      return { ok: true };
    },
    async reorderSections({ sectionIds }) {
      if (new Set(sectionIds).size !== sectionIds.length) {
        throw new Error("Folder order contains duplicate ids");
      }
      const writeOrder = db.transaction((ids: readonly string[]) => {
        const statement = db.prepare(
          `INSERT INTO section_order (section_id, position) VALUES (?, ?)
           ON CONFLICT(section_id) DO UPDATE SET position = excluded.position`,
        );
        ids.forEach((sectionId, position) =>
          statement.run(sectionId, position),
        );
      });
      writeOrder(sectionIds);
      bb.realtime.publish(SECTIONS_CHANNEL, { sectionIds });
      return { ok: true };
    },
    async deleteSection({ sectionId }) {
      const result = await bb.sdk.threadSections.delete({ id: sectionId });
      db.prepare(`DELETE FROM section_colors WHERE section_id = ?`).run(sectionId);
      db.prepare(`DELETE FROM section_order WHERE section_id = ?`).run(sectionId);
      bb.realtime.publish(SECTIONS_CHANNEL, { sectionId });
      return { ok: true, updatedThreadCount: result.updatedThreadCount };
    },
    async moveThreadToSection({ threadId, sectionId }) {
      await bb.sdk.threads.update({ threadId, sectionId });
      bb.realtime.publish(SECTIONS_CHANNEL, { sectionId, threadId });
      return { ok: true };
    },
    async renameThread({ threadId, title }) {
      await bb.sdk.threads.update({ threadId, title });
      return { ok: true };
    },
    async setSectionColor({ sectionId, color }) {
      const normalizedColor = normalizeFolderColor(color);
      db.prepare(
        `INSERT INTO section_colors (section_id, color) VALUES (?, ?)
         ON CONFLICT(section_id) DO UPDATE SET color = excluded.color`,
      ).run(sectionId, normalizedColor);
      bb.realtime.publish(SECTIONS_CHANNEL, { sectionId });
      return { ok: true };
    },
    async createThreadInSection({ sectionId, request }) {
      // The native composer has already resolved these values from the user's
      // selections. Mark them explicit so the spawn path does not replace an
      // intentionally selected provider/model with the project's defaults.
      const executionInputSources = {
        ...request.executionInputSources,
        providerId: "explicit" as const,
        model: "explicit" as const,
        reasoningLevel: "explicit" as const,
        permissionMode: "explicit" as const,
        ...(request.serviceTier !== undefined
          ? { serviceTier: "explicit" as const }
          : {}),
      };
      const thread = await bb.sdk.threads.spawn({
        ...request,
        executionInputSources,
        sectionId,
      });
      return { threadId: thread.id };
    },
  });

  // A deleted thread must not leave a row behind that would park a future
  // thread reusing the id, and stale rows accumulate otherwise.
  bb.events.on("thread.deleted", ({ thread }) => {
    clear(thread.id);
  });
}
