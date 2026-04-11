import { Schema } from "effect";

import { IsoDateTime, TrimmedNonEmptyString } from "./baseSchemas";

export const ChangelogDate = TrimmedNonEmptyString;
export type ChangelogDate = typeof ChangelogDate.Type;

export const GitCommitSha = TrimmedNonEmptyString;
export type GitCommitSha = typeof GitCommitSha.Type;

export const ChangelogEntryCategory = Schema.Literals([
  "feature",
  "improvement",
  "fix",
  "performance",
  "breaking",
  "security",
  "internal",
]);
export type ChangelogEntryCategory = typeof ChangelogEntryCategory.Type;

export const ChangelogEntry = Schema.Struct({
  id: TrimmedNonEmptyString,
  title: TrimmedNonEmptyString,
  summary: TrimmedNonEmptyString,
  category: ChangelogEntryCategory,
  commitShas: Schema.Array(GitCommitSha).check(Schema.isMinLength(1)),
});
export type ChangelogEntry = typeof ChangelogEntry.Type;

export const ChangelogGroup = Schema.Struct({
  date: ChangelogDate,
  entries: Schema.Array(ChangelogEntry).check(Schema.isMinLength(1)),
});
export type ChangelogGroup = typeof ChangelogGroup.Type;

export const GeneratedChangelogEntry = Schema.Struct({
  title: Schema.String,
  summary: Schema.String,
  category: ChangelogEntryCategory,
  commitShas: Schema.Array(Schema.String),
});
export type GeneratedChangelogEntry = typeof GeneratedChangelogEntry.Type;

export const GeneratedChangelogGroup = Schema.Struct({
  date: Schema.String,
  entries: Schema.Array(GeneratedChangelogEntry),
});
export type GeneratedChangelogGroup = typeof GeneratedChangelogGroup.Type;

export const GeneratedChangelogResponse = Schema.Struct({
  groups: Schema.Array(GeneratedChangelogGroup),
});
export type GeneratedChangelogResponse = typeof GeneratedChangelogResponse.Type;

export const ChangelogBatchProvenance = Schema.Struct({
  generatedAt: IsoDateTime,
  promptVersion: TrimmedNonEmptyString,
  fromExclusiveCommit: Schema.NullOr(GitCommitSha),
  toInclusiveCommit: GitCommitSha,
  commitShas: Schema.Array(GitCommitSha).check(Schema.isMinLength(1)),
  commitCount: Schema.Int.check(Schema.isGreaterThan(0)),
  model: TrimmedNonEmptyString,
  mcpDisabled: Schema.Boolean,
});
export type ChangelogBatchProvenance = typeof ChangelogBatchProvenance.Type;

export const ChangelogCacheFile = Schema.Struct({
  version: Schema.Literal(1),
  generatedAt: IsoDateTime,
  lastProcessedCommit: Schema.NullOr(GitCommitSha),
  rebuiltFromScratch: Schema.Boolean,
  rebuildCommitLimit: Schema.Int.check(Schema.isGreaterThan(0)),
  promptVersion: TrimmedNonEmptyString,
  uiOutputPath: TrimmedNonEmptyString,
  groups: Schema.Array(ChangelogGroup),
  batches: Schema.Array(
    Schema.Struct({
      provenance: ChangelogBatchProvenance,
      groups: Schema.Array(ChangelogGroup),
    }),
  ),
});
export type ChangelogCacheFile = typeof ChangelogCacheFile.Type;

export const ChangelogAssetFile = Schema.Struct({
  version: Schema.Literal(1),
  generatedAt: IsoDateTime,
  lastProcessedCommit: Schema.NullOr(GitCommitSha),
  groups: Schema.Array(ChangelogGroup),
  provenance: Schema.Struct({
    rebuiltFromScratch: Schema.Boolean,
    rebuildCommitLimit: Schema.Int.check(Schema.isGreaterThan(0)),
    promptVersion: TrimmedNonEmptyString,
    batches: Schema.Array(ChangelogBatchProvenance),
  }),
});
export type ChangelogAssetFile = typeof ChangelogAssetFile.Type;
