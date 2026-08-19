import { useEffect, useState } from "react";
import {
  experimental_NewThreadComposer as NewThreadComposer,
  useBbNavigate,
  type PluginNavPanelProps,
} from "@get-bb/plugin-sdk/app";
import { Icon } from "./components/Icon";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./components/Select";
import {
  DEFAULT_FOLDER_COLORS,
  folderColorWithAlpha,
  normalizeFolderColor,
} from "./folderColors";
import { useSections } from "./useSections";

function decodeRoutePart(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return "";
  }
}

function parseRoute(subPath: string) {
  const [sectionPart = "", projectPart = ""] = subPath.split("/");
  return {
    sectionId: decodeRoutePart(sectionPart),
    projectId: projectPart ? decodeRoutePart(projectPart) || undefined : undefined,
  };
}

/** A full-page, native-composer route for creating directly in one folder. */
export function FolderThreadComposerPage({ subPath }: PluginNavPanelProps) {
  const { sectionId, projectId } = parseRoute(subPath);
  const folders = useSections();
  const navigate = useBbNavigate();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [selectedSectionId, setSelectedSectionId] = useState(sectionId);
  useEffect(() => setSelectedSectionId(sectionId), [sectionId]);

  const routeSection = folders.sections.find(
    (candidate) => candidate.id === sectionId,
  );
  const selectedSection =
    folders.sections.find(
      (candidate) => candidate.id === selectedSectionId,
    ) ?? routeSection;

  if (folders.isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Loading folder…
      </div>
    );
  }

  if (!routeSection || !selectedSection) {
    return (
      <main className="flex h-full items-center justify-center bg-background p-6">
        <div className="w-full max-w-md rounded-xl border border-sidebar-border bg-card p-6 text-center shadow-sm">
          <Icon name="Folder" className="mx-auto size-8 text-muted-foreground" />
          <h1 className="mt-4 text-lg font-semibold text-foreground">
            Folder not found
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            It may have been deleted while this page was open.
          </p>
          <button
            type="button"
            onClick={() => navigate.toCompose({ focusPrompt: true })}
            className="mt-5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Open regular New Thread
          </button>
        </div>
      </main>
    );
  }

  const color = normalizeFolderColor(
    selectedSection.color ?? DEFAULT_FOLDER_COLORS[0],
  );

  return (
    <main className="flex h-full min-h-0 flex-col bg-background">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-sidebar-border px-4">
        <button
          type="button"
          onClick={() => window.history.back()}
          aria-label="Go back"
          className="rounded-md p-1.5 text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
        >
          <Icon name="ChevronLeft" className="size-4" />
        </button>
        <h1 className="text-sm font-medium text-foreground">New thread</h1>
        <span className="text-muted-foreground/50">/</span>
        <span className="text-xs text-muted-foreground">Thread group</span>
        <Select value={selectedSection.id} onValueChange={setSelectedSectionId}>
          <SelectTrigger
            aria-label="Thread group"
            className="h-8 w-auto min-w-40 gap-1.5 border-0 px-2 text-xs font-medium shadow-none focus:ring-1"
            style={{
              backgroundColor: folderColorWithAlpha(color, "20"),
              color,
            }}
          >
            <Icon name="Folder" className="size-3.5 shrink-0" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {folders.sections.map((candidate) => {
              const candidateColor = normalizeFolderColor(
                candidate.color ?? DEFAULT_FOLDER_COLORS[0],
              );
              return (
                <SelectItem
                  key={candidate.id}
                  value={candidate.id}
                  className="text-xs"
                >
                  <span className="flex items-center gap-2">
                    <span
                      className="size-2.5 rounded-full"
                      style={{ backgroundColor: candidateColor }}
                    />
                    <span>{candidate.name}</span>
                  </span>
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex min-h-full w-full max-w-5xl flex-col px-6 py-8 sm:px-10 sm:py-12">
          <div className="mb-8 max-w-2xl">
            <div
              className="mb-4 flex size-11 items-center justify-center rounded-xl"
              style={{
                backgroundColor: folderColorWithAlpha(color, "20"),
                color,
              }}
            >
              <Icon name="Folder" className="size-5" />
            </div>
            <h2 className="text-2xl font-semibold tracking-tight text-foreground">
              Start a thread in {selectedSection.name}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Choose the project, environment, model, and permissions just like
              the standard New Thread page. The thread will be filed here
              automatically.
            </p>
          </div>

          {submitError ? (
            <div
              role="alert"
              className="mb-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive-text"
            >
              {submitError}
            </div>
          ) : null}

          <NewThreadComposer
            layout="document"
            className="w-full"
            defaultProjectId={projectId}
            draftKey={`t3sidebar-folder-${routeSection.id}`}
            focusRequest={1}
            placeholder={`What should the agent work on in ${selectedSection.name}?`}
            onSubmit={async (request) => {
              setSubmitError(null);
              try {
                const threadId = await folders.createThread(
                  selectedSection.id,
                  request,
                );
                navigate.toThread(threadId);
              } catch (cause) {
                setSubmitError(
                  cause instanceof Error
                    ? cause.message
                    : "Could not create thread",
                );
                throw cause;
              }
            }}
          />
        </div>
      </div>
    </main>
  );
}
