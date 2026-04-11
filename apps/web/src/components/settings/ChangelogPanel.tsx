import type { ChangelogAssetFile, ChangelogEntryCategory } from "@t3tools/contracts";
import { useQuery } from "@tanstack/react-query";
import { FileClockIcon, LoaderIcon } from "lucide-react";

import { changelogQueryOptions } from "../../lib/changelogReactQuery";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../ui/empty";
import { SettingsPageContainer } from "./SettingsPanels";

const CATEGORY_COLOR: Record<ChangelogEntryCategory, string> = {
  feature: "bg-info",
  improvement: "bg-success",
  fix: "bg-muted-foreground",
  performance: "bg-success",
  breaking: "bg-warning",
  security: "bg-destructive",
  internal: "bg-muted-foreground/50",
};

const CATEGORY_TEXT_COLOR: Record<ChangelogEntryCategory, string> = {
  feature: "text-info-foreground",
  improvement: "text-success-foreground",
  fix: "text-muted-foreground",
  performance: "text-success-foreground",
  breaking: "text-warning-foreground",
  security: "text-destructive-foreground",
  internal: "text-muted-foreground",
};

function formatDateHeading(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export function ChangelogPanel() {
  const changelogQuery = useQuery(changelogQueryOptions());
  const data: ChangelogAssetFile | null = changelogQuery.data ?? null;
  const error = changelogQuery.error?.message ?? null;

  return (
    <SettingsPageContainer>
      <div className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">Changelog</h1>
        <p className="text-sm text-muted-foreground">
          Release notes from committed git history.
          {data?.lastProcessedCommit ? (
            <span className="ml-2 font-mono text-[11px] text-muted-foreground/60">
              {data.lastProcessedCommit.slice(0, 8)}
            </span>
          ) : null}
        </p>
      </div>

      {changelogQuery.isPending ? (
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
        <div className="space-y-10">
          {data.groups.map((group) => (
            <section key={group.date}>
              <h2 className="mb-4 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                {formatDateHeading(group.date)}
              </h2>

              <div className="space-y-0">
                {group.entries.map((entry) => (
                  <article
                    key={entry.id}
                    className="group relative border-l-2 border-border/40 py-3 pl-5 transition-colors hover:border-border"
                  >
                    <span
                      className={`absolute -left-[5px] top-[18px] size-2 rounded-full ${CATEGORY_COLOR[entry.category]} ring-[3px] ring-background`}
                    />
                    <div className="flex items-baseline gap-2.5">
                      <h3 className="text-[13px] font-medium leading-snug text-foreground/90 group-hover:text-foreground">
                        {entry.title}
                      </h3>
                      <span
                        className={`shrink-0 text-[10px] font-medium uppercase tracking-wider ${CATEGORY_TEXT_COLOR[entry.category]} opacity-60`}
                      >
                        {entry.category}
                      </span>
                    </div>
                    <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground/70">
                      {entry.summary}
                    </p>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </SettingsPageContainer>
  );
}
