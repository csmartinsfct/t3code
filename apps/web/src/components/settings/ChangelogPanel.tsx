import type { ChangelogAssetFile, ChangelogEntryCategory } from "@t3tools/contracts";
import { ChangelogAssetFile as ChangelogAssetFileSchema } from "@t3tools/contracts";
import { CalendarDaysIcon, FileClockIcon, LoaderIcon } from "lucide-react";
import { Schema } from "effect";
import { useEffect, useState } from "react";

import { Badge } from "../ui/badge";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../ui/empty";
import { SettingsPageContainer, SettingsSection } from "./SettingsPanels";

const CATEGORY_BADGE_VARIANT: Record<
  ChangelogEntryCategory,
  "info" | "success" | "warning" | "error" | "outline"
> = {
  feature: "info",
  improvement: "success",
  fix: "outline",
  performance: "success",
  breaking: "warning",
  security: "error",
  internal: "outline",
};

function formatDateLabel(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function ChangelogPanel() {
  const [data, setData] = useState<ChangelogAssetFile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch("/generated/changelog.json", { cache: "no-store" });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const decoded = Schema.decodeUnknownSync(ChangelogAssetFileSchema)(await response.json());
        if (!cancelled) {
          setData(decoded);
        }
      } catch (cause) {
        if (!cancelled) {
          setData(null);
          setError(cause instanceof Error ? cause.message : "Unknown error");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <SettingsPageContainer>
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold tracking-tight text-foreground">Changelog</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            AI-generated release notes baked into the app at build time from committed git history.
          </p>
        </div>
        {data ? (
          <Badge variant="outline" size="sm" className="font-mono text-[11px]">
            {data.lastProcessedCommit?.slice(0, 12) ?? "no-commit"}
          </Badge>
        ) : null}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <LoaderIcon className="size-4 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <Empty>
          <EmptyMedia className="rounded-full border border-border/70 bg-muted/40">
            <FileClockIcon className="size-5 text-muted-foreground" />
          </EmptyMedia>
          <EmptyHeader>
            <EmptyTitle>Changelog unavailable</EmptyTitle>
            <EmptyDescription>
              The shipped changelog asset could not be loaded: {error}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : !data || data.groups.length === 0 ? (
        <Empty>
          <EmptyMedia className="rounded-full border border-border/70 bg-muted/40">
            <FileClockIcon className="size-5 text-muted-foreground" />
          </EmptyMedia>
          <EmptyHeader>
            <EmptyTitle>No changelog entries yet</EmptyTitle>
            <EmptyDescription>
              Local desktop builds will generate entries from committed history before packaging.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          <SettingsSection title="Release Notes" icon={<CalendarDaysIcon className="size-3.5" />}>
            <div className="divide-y divide-border">
              {data.groups.map((group) => (
                <section key={group.date} className="px-4 py-4 sm:px-5">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h2 className="text-sm font-medium text-foreground">
                      {formatDateLabel(group.date)}
                    </h2>
                    <Badge variant="outline" size="sm">
                      {group.entries.length} {group.entries.length === 1 ? "entry" : "entries"}
                    </Badge>
                  </div>

                  <div className="space-y-3">
                    {group.entries.map((entry) => (
                      <article
                        key={entry.id}
                        className="rounded-xl border border-border/70 bg-background/70 px-3 py-3"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-sm font-medium text-foreground">{entry.title}</h3>
                          <Badge variant={CATEGORY_BADGE_VARIANT[entry.category]} size="sm">
                            {entry.category}
                          </Badge>
                        </div>
                        <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
                          {entry.summary}
                        </p>
                      </article>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </SettingsSection>

          <div className="text-xs text-muted-foreground">
            Generated {new Date(data.generatedAt).toLocaleString()} from commit history through{" "}
            <code>{data.lastProcessedCommit?.slice(0, 12) ?? "unknown"}</code>.
          </div>
        </>
      )}
    </SettingsPageContainer>
  );
}
