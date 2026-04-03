/**
 * ComposerCodeSnippets — renders code-snippet reference chips above the
 * composer input when the user has pasted selections from the file editor.
 */
import { XIcon } from "lucide-react";
import { memo } from "react";

import { getVscodeIconUrlForEntry } from "~/vscode-icons";
import type { ComposerCodeSnippetAttachment } from "../composerDraftStore";

interface ComposerCodeSnippetsProps {
  snippets: ComposerCodeSnippetAttachment[];
  onRemove: (snippetId: string) => void;
}

export const ComposerCodeSnippets = memo(function ComposerCodeSnippets({
  snippets,
  onRemove,
}: ComposerCodeSnippetsProps) {
  if (snippets.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5 px-3 pb-1 pt-2">
      {snippets.map((snippet) => {
        const fileName = snippet.relativePath.split("/").pop() ?? snippet.relativePath;
        const iconUrl = getVscodeIconUrlForEntry(fileName, "file", "dark");
        const lineRange =
          snippet.startLine === snippet.endLine
            ? `${snippet.startLine}`
            : `${snippet.startLine}–${snippet.endLine}`;

        return (
          <div
            key={snippet.id}
            className="flex items-center gap-1.5 rounded-md border border-border/70 bg-accent/30 px-2 py-1 text-xs transition-colors"
            title={`${snippet.relativePath}:${lineRange}`}
          >
            <img src={iconUrl} alt="" aria-hidden className="size-3 shrink-0" />
            <span className="font-mono text-foreground">
              {fileName}
              <span className="text-muted-foreground">:{lineRange}</span>
            </span>
            <button
              type="button"
              aria-label={`Remove ${fileName} snippet`}
              className="ml-0.5 flex size-3.5 items-center justify-center rounded-sm text-muted-foreground/72 transition-colors hover:bg-foreground/8 hover:text-foreground"
              onClick={() => onRemove(snippet.id)}
            >
              <XIcon className="size-2.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
});
