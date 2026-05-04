import { DiffsHighlighter, getSharedHighlighter, SupportedLanguages } from "@pierre/diffs";
import { CheckIcon, CopyIcon } from "lucide-react";
import React, {
  Children,
  Suspense,
  isValidElement,
  use,
  useCallback,
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Components } from "react-markdown";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { openInPreferredEditor } from "../editorPreferences";
import { resolveDiffThemeName, type DiffThemeName } from "../lib/diffRendering";
import { fnv1a32 } from "../lib/diffRendering";
import { LRUCache } from "../lib/lruCache";
import { useTheme } from "../hooks/useTheme";
import { isProposeActionBlock, parseProposeActionPayload } from "../lib/proposeActionParser";
import { stripDynamicChatUiFencesFromMarkdown } from "@t3tools/shared/dynamicChatUi";
import {
  isDynamicChatUiBlock,
  isDynamicChatUiStatusBlock,
  parseDynamicChatUiPayload,
  parseDynamicChatUiStatusPayload,
  type DynamicChatUiPayload,
} from "../lib/dynamicChatUiParser";
import {
  isProposeScheduledTaskBlock,
  parseProposeScheduledTaskPayload,
} from "../lib/proposeScheduledTaskParser";
import { parseInternalLinkTarget, unwrapBacktickedTicketLinks } from "../lib/internalLinkTargets";
import { resolveMarkdownFileLinkTarget } from "../markdown-links";
import { readNativeApi } from "../nativeApi";
import { splitPathAndPosition } from "../terminal-links";
import ProposeActionCard from "./chat/ProposeActionCard";
import ProposeScheduledTaskCard from "./chat/ProposeScheduledTaskCard";
import { DynamicChatUiArtifact } from "./chat/DynamicChatUiArtifact";
import { DynamicChatUiStatusCard } from "./chat/DynamicChatUiStatusCard";
import { TicketIdentifierBadge } from "./TicketIdentifierBadge";

class CodeHighlightErrorBoundary extends React.Component<
  { fallback: ReactNode; children: ReactNode },
  { hasError: boolean }
> {
  constructor(props: { fallback: ReactNode; children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  override render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}

import type { DeclaredService, ProjectScriptIcon } from "@t3tools/contracts";

export interface ProposeActionEvent {
  action: "accept" | "reject";
  name: string;
  command: string;
  icon: ProjectScriptIcon;
  services?: DeclaredService[];
}

export interface ProposeScheduledTaskEvent {
  action: "accept" | "reject";
  name: string;
  description: string | null;
  cronExpression: string;
  projectId: string;
  skillIds?: string[];
  prompt?: string;
  autoSend: boolean;
}

interface ChatMarkdownProps {
  text: string;
  cwd: string | undefined;
  isStreaming?: boolean;
  onProposeAction?: (event: ProposeActionEvent) => void;
  onProposeScheduledTask?: (event: ProposeScheduledTaskEvent) => void;
  resolveProjectName?: (projectId: string) => string;
  onOpenFileLink?: (absolutePath: string, line?: number, column?: number) => void;
  onOpenTicketLink?: (identifier: string) => void | Promise<void>;
  onDynamicChatUiResize?: () => void;
  dynamicChatUiArtifacts?: ReadonlyArray<DynamicChatUiPayload>;
}

const CODE_FENCE_LANGUAGE_REGEX = /(?:^|\s)language-([^\s]+)/;
const MAX_HIGHLIGHT_CACHE_ENTRIES = 500;
const MAX_HIGHLIGHT_CACHE_MEMORY_BYTES = 50 * 1024 * 1024;
const highlightedCodeCache = new LRUCache<string>(
  MAX_HIGHLIGHT_CACHE_ENTRIES,
  MAX_HIGHLIGHT_CACHE_MEMORY_BYTES,
);
const highlighterPromiseCache = new Map<string, Promise<DiffsHighlighter>>();

function extractFenceLanguage(className: string | undefined): string {
  const match = className?.match(CODE_FENCE_LANGUAGE_REGEX);
  const raw = match?.[1] ?? "text";
  // Shiki doesn't bundle a gitignore grammar; ini is a close match (#685)
  return raw === "gitignore" ? "ini" : raw;
}

function nodeToPlainText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map((child) => nodeToPlainText(child)).join("");
  }
  if (isValidElement<{ children?: ReactNode }>(node)) {
    return nodeToPlainText(node.props.children);
  }
  return "";
}

function extractCodeBlock(
  children: ReactNode,
): { className: string | undefined; code: string } | null {
  const childNodes = Children.toArray(children);
  if (childNodes.length !== 1) {
    return null;
  }

  const onlyChild = childNodes[0];
  if (
    !isValidElement<{ className?: string; children?: ReactNode }>(onlyChild) ||
    onlyChild.type !== "code"
  ) {
    return null;
  }

  return {
    className: onlyChild.props.className,
    code: nodeToPlainText(onlyChild.props.children),
  };
}

function createHighlightCacheKey(code: string, language: string, themeName: DiffThemeName): string {
  return `${fnv1a32(code).toString(36)}:${code.length}:${language}:${themeName}`;
}

function estimateHighlightedSize(html: string, code: string): number {
  return Math.max(html.length * 2, code.length * 3);
}

function getHighlighterPromise(language: string): Promise<DiffsHighlighter> {
  const cached = highlighterPromiseCache.get(language);
  if (cached) return cached;

  const promise = getSharedHighlighter({
    themes: [resolveDiffThemeName("dark"), resolveDiffThemeName("light")],
    langs: [language as SupportedLanguages],
    preferredHighlighter: "shiki-js",
  }).catch((err) => {
    highlighterPromiseCache.delete(language);
    if (language === "text") {
      // "text" itself failed — Shiki cannot initialize at all, surface the error
      throw err;
    }
    // Language not supported by Shiki — fall back to "text"
    return getHighlighterPromise("text");
  });
  highlighterPromiseCache.set(language, promise);
  return promise;
}

function MarkdownCodeBlock({ code, children }: { code: string; children: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleCopy = useCallback(() => {
    if (typeof navigator === "undefined" || navigator.clipboard == null) {
      return;
    }
    void navigator.clipboard
      .writeText(code)
      .then(() => {
        if (copiedTimerRef.current != null) {
          clearTimeout(copiedTimerRef.current);
        }
        setCopied(true);
        copiedTimerRef.current = setTimeout(() => {
          setCopied(false);
          copiedTimerRef.current = null;
        }, 1200);
      })
      .catch(() => undefined);
  }, [code]);

  useEffect(
    () => () => {
      if (copiedTimerRef.current != null) {
        clearTimeout(copiedTimerRef.current);
        copiedTimerRef.current = null;
      }
    },
    [],
  );

  return (
    <div className="chat-markdown-codeblock">
      <button
        type="button"
        className="chat-markdown-copy-button"
        onClick={handleCopy}
        title={copied ? "Copied" : "Copy code"}
        aria-label={copied ? "Copied" : "Copy code"}
      >
        {copied ? <CheckIcon className="size-3" /> : <CopyIcon className="size-3" />}
      </button>
      {children}
    </div>
  );
}

interface SuspenseShikiCodeBlockProps {
  className: string | undefined;
  code: string;
  themeName: DiffThemeName;
  isStreaming: boolean;
}

function SuspenseShikiCodeBlock({
  className,
  code,
  themeName,
  isStreaming,
}: SuspenseShikiCodeBlockProps) {
  const language = extractFenceLanguage(className);
  const cacheKey = createHighlightCacheKey(code, language, themeName);
  const cachedHighlightedHtml = !isStreaming ? highlightedCodeCache.get(cacheKey) : null;

  if (cachedHighlightedHtml != null) {
    return (
      <div
        className="chat-markdown-shiki"
        dangerouslySetInnerHTML={{ __html: cachedHighlightedHtml }}
      />
    );
  }

  const highlighter = use(getHighlighterPromise(language));
  const highlightedHtml = useMemo(() => {
    try {
      return highlighter.codeToHtml(code, { lang: language, theme: themeName });
    } catch (error) {
      // Log highlighting failures for debugging while falling back to plain text
      console.warn(
        `Code highlighting failed for language "${language}", falling back to plain text.`,
        error instanceof Error ? error.message : error,
      );
      // If highlighting fails for this language, render as plain text
      return highlighter.codeToHtml(code, { lang: "text", theme: themeName });
    }
  }, [code, highlighter, language, themeName]);

  useEffect(() => {
    if (!isStreaming) {
      highlightedCodeCache.set(
        cacheKey,
        highlightedHtml,
        estimateHighlightedSize(highlightedHtml, code),
      );
    }
  }, [cacheKey, code, highlightedHtml, isStreaming]);

  return (
    <div className="chat-markdown-shiki" dangerouslySetInnerHTML={{ __html: highlightedHtml }} />
  );
}

function ChatMarkdown({
  text,
  cwd,
  isStreaming = false,
  onProposeAction,
  onProposeScheduledTask,
  resolveProjectName,
  onOpenFileLink,
  onOpenTicketLink,
  onDynamicChatUiResize,
  dynamicChatUiArtifacts = [],
}: ChatMarkdownProps) {
  const { resolvedTheme } = useTheme();
  const diffThemeName = resolveDiffThemeName(resolvedTheme);
  const onDynamicChatUiResizeRef = useRef(onDynamicChatUiResize);
  useEffect(() => {
    onDynamicChatUiResizeRef.current = onDynamicChatUiResize;
  }, [onDynamicChatUiResize]);
  const handleDynamicChatUiResize = useCallback(() => {
    onDynamicChatUiResizeRef.current?.();
  }, []);
  const markdownText =
    dynamicChatUiArtifacts.length > 0 ? stripDynamicChatUiFencesFromMarkdown(text) : text;
  const markdownComponents = useMemo<Components>(
    () => ({
      a({ node: _node, href, ...props }) {
        const internalTarget = parseInternalLinkTarget(href);
        if (internalTarget?.kind === "ticket") {
          if (!onOpenTicketLink) {
            return (
              <TicketIdentifierBadge identifier={internalTarget.identifier}>
                {props.children}
              </TicketIdentifierBadge>
            );
          }

          return (
            <TicketIdentifierBadge
              {...props}
              identifier={internalTarget.identifier}
              onOpen={onOpenTicketLink}
            >
              {props.children}
            </TicketIdentifierBadge>
          );
        }

        const targetPath = resolveMarkdownFileLinkTarget(href, cwd);
        if (!targetPath) {
          return <a {...props} href={href} target="_blank" rel="noopener noreferrer" />;
        }

        return (
          <a
            {...props}
            href={href}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              if (onOpenFileLink) {
                const { path, line, column } = splitPathAndPosition(targetPath);
                onOpenFileLink(
                  path,
                  line ? Number(line) : undefined,
                  column ? Number(column) : undefined,
                );
              } else {
                const api = readNativeApi();
                if (api) {
                  void openInPreferredEditor(api, targetPath);
                } else {
                  console.warn("Native API not found. Unable to open file in editor.");
                }
              }
            }}
          />
        );
      },
      pre({ node: _node, children, ...props }) {
        const codeBlock = extractCodeBlock(children);
        if (!codeBlock) {
          return <pre {...props}>{children}</pre>;
        }

        if (isProposeActionBlock(codeBlock.className)) {
          const payload = parseProposeActionPayload(codeBlock.code);
          if (payload && onProposeAction) {
            return (
              <ProposeActionCard
                name={payload.name}
                command={payload.command}
                icon={payload.icon}
                {...(payload.services ? { services: payload.services } : {})}
                isStreaming={isStreaming}
                onAccept={(data) => onProposeAction({ action: "accept", ...data })}
                onReject={() =>
                  onProposeAction({
                    action: "reject",
                    name: payload.name,
                    command: payload.command,
                    icon: payload.icon,
                  })
                }
              />
            );
          }
          // Incomplete JSON during streaming or no handler — render as raw code
          return <pre {...props}>{children}</pre>;
        }

        if (isProposeScheduledTaskBlock(codeBlock.className)) {
          const payload = parseProposeScheduledTaskPayload(codeBlock.code);
          if (payload && onProposeScheduledTask) {
            return (
              <ProposeScheduledTaskCard
                {...payload}
                projectName={resolveProjectName?.(payload.projectId) ?? payload.projectId}
                isStreaming={isStreaming}
                onAccept={(data) => onProposeScheduledTask({ action: "accept", ...data })}
                onReject={() => onProposeScheduledTask({ action: "reject", ...payload })}
              />
            );
          }
          return <pre {...props}>{children}</pre>;
        }

        if (isDynamicChatUiBlock(codeBlock.className)) {
          const payload = parseDynamicChatUiPayload(codeBlock.code);
          if (payload) {
            return (
              <DynamicChatUiArtifact
                artifact={payload}
                isStreaming={isStreaming}
                onResize={handleDynamicChatUiResize}
              />
            );
          }
          return <pre {...props}>{children}</pre>;
        }

        if (isDynamicChatUiStatusBlock(codeBlock.className)) {
          const payload = parseDynamicChatUiStatusPayload(codeBlock.code);
          if (payload) {
            return (
              <DynamicChatUiStatusCard title={payload.title} description={payload.description} />
            );
          }
          return <pre {...props}>{children}</pre>;
        }

        return (
          <MarkdownCodeBlock code={codeBlock.code}>
            <CodeHighlightErrorBoundary fallback={<pre {...props}>{children}</pre>}>
              <Suspense fallback={<pre {...props}>{children}</pre>}>
                <SuspenseShikiCodeBlock
                  className={codeBlock.className}
                  code={codeBlock.code}
                  themeName={diffThemeName}
                  isStreaming={isStreaming}
                />
              </Suspense>
            </CodeHighlightErrorBoundary>
          </MarkdownCodeBlock>
        );
      },
    }),
    [
      cwd,
      diffThemeName,
      handleDynamicChatUiResize,
      isStreaming,
      onOpenFileLink,
      onOpenTicketLink,
      onProposeAction,
      onProposeScheduledTask,
      resolveProjectName,
    ],
  );

  return (
    <div className="chat-markdown markdown-table w-full min-w-0 text-sm leading-relaxed text-foreground/80">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={markdownComponents}
        urlTransform={(value) =>
          typeof value === "string" && value.startsWith("t3://")
            ? value
            : defaultUrlTransform(value)
        }
      >
        {unwrapBacktickedTicketLinks(markdownText)}
      </ReactMarkdown>
      {dynamicChatUiArtifacts.map((artifact) => (
        <DynamicChatUiArtifact
          key={`${artifact.id}:${artifact.html.length}`}
          artifact={artifact}
          isStreaming={isStreaming}
          onResize={handleDynamicChatUiResize}
        />
      ))}
    </div>
  );
}

function areChatMarkdownPropsEqual(previous: ChatMarkdownProps, next: ChatMarkdownProps): boolean {
  return (
    previous.text === next.text &&
    previous.cwd === next.cwd &&
    previous.isStreaming === next.isStreaming &&
    Boolean(previous.onProposeAction) === Boolean(next.onProposeAction) &&
    Boolean(previous.onProposeScheduledTask) === Boolean(next.onProposeScheduledTask) &&
    Boolean(previous.resolveProjectName) === Boolean(next.resolveProjectName) &&
    Boolean(previous.onOpenFileLink) === Boolean(next.onOpenFileLink) &&
    Boolean(previous.onOpenTicketLink) === Boolean(next.onOpenTicketLink) &&
    Boolean(previous.onDynamicChatUiResize) === Boolean(next.onDynamicChatUiResize) &&
    previous.dynamicChatUiArtifacts === next.dynamicChatUiArtifacts
  );
}

export default memo(ChatMarkdown, areChatMarkdownPropsEqual);
