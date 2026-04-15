import type { TicketId } from "@t3tools/contracts";
import { Debouncer } from "@tanstack/react-pacer";
import { EditorContent, useEditor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Underline from "@tiptap/extension-underline";
import Placeholder from "@tiptap/extension-placeholder";
import { Markdown } from "tiptap-markdown";
import type { MarkdownStorage } from "tiptap-markdown";

/** Access the tiptap-markdown storage which isn't on the core `Storage` interface. */
function getMarkdownText(storage: Record<string, unknown>): string {
  return (storage.markdown as MarkdownStorage).getMarkdown();
}
import {
  BoldIcon,
  CodeIcon,
  Heading1Icon,
  Heading2Icon,
  ItalicIcon,
  LinkIcon,
  ListIcon,
  ListOrderedIcon,
  QuoteIcon,
  StrikethroughIcon,
  UnderlineIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef } from "react";

interface TicketDescriptionEditorProps {
  ticketId: TicketId;
  initialContent: string | null;
  onSave: (markdown: string | null) => Promise<void>;
}

const DEBOUNCE_MS = 1000;

export function TicketDescriptionEditor({
  ticketId,
  initialContent,
  onSave,
}: TicketDescriptionEditorProps) {
  const lastSavedMarkdown = useRef<string | null>(initialContent);
  const isExternalUpdate = useRef(false);
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  const debouncedSave = useMemo(
    () =>
      new Debouncer(
        (markdown: string | null) => {
          lastSavedMarkdown.current = markdown;
          void onSaveRef.current(markdown);
        },
        { wait: DEBOUNCE_MS },
      ),
    [],
  );

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { rel: "noopener noreferrer nofollow" },
      }),
      Underline,
      Placeholder.configure({
        placeholder: "Add a description...",
      }),
      Markdown,
    ],
    content: initialContent ?? "",
    autofocus: false,
    editorProps: {
      attributes: {
        class: "ticket-markdown text-[13px] leading-relaxed outline-none",
      },
    },
    onUpdate: ({ editor }) => {
      if (isExternalUpdate.current) return;
      const md = getMarkdownText(editor.storage as unknown as Record<string, unknown>);
      const nextValue = md.trim() || null;
      if (nextValue === lastSavedMarkdown.current) return;
      debouncedSave.maybeExecute(nextValue);
    },
    onBlur: () => {
      debouncedSave.cancel();
      if (!editor) return;
      const md = getMarkdownText(editor.storage as unknown as Record<string, unknown>);
      const nextValue = md.trim() || null;
      if (nextValue === lastSavedMarkdown.current) return;
      lastSavedMarkdown.current = nextValue;
      void onSaveRef.current(nextValue);
    },
  });

  // Reset editor content when switching tickets.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    isExternalUpdate.current = true;
    editor.commands.setContent(initialContent ?? "");
    lastSavedMarkdown.current = initialContent;
    isExternalUpdate.current = false;
  }, [ticketId, editor]);

  // Handle external content updates (e.g. agent updates the description).
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    if (initialContent === lastSavedMarkdown.current) return;
    // Only apply if the editor doesn't have focus (avoid overwriting user edits).
    if (editor.isFocused) return;
    isExternalUpdate.current = true;
    editor.commands.setContent(initialContent ?? "");
    lastSavedMarkdown.current = initialContent;
    isExternalUpdate.current = false;
  }, [initialContent, editor]);

  // Cleanup debouncer on unmount.
  useEffect(() => {
    return () => {
      debouncedSave.cancel();
    };
  }, [debouncedSave]);

  const toggleLink = useCallback(() => {
    if (!editor) return;
    if (editor.isActive("link")) {
      editor.chain().focus().unsetLink().run();
      return;
    }
    const url = window.prompt("URL:");
    if (url) {
      editor.chain().focus().setLink({ href: url }).run();
    }
  }, [editor]);

  if (!editor) return null;

  return (
    <div className="ticket-description-editor">
      <BubbleMenu editor={editor} options={{ placement: "top-start" }}>
        <div className="flex items-center gap-0.5 rounded-md border border-border bg-popover p-1 shadow-sm">
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
            active={editor.isActive("heading", { level: 1 })}
            title="Heading 1"
          >
            <Heading1Icon className="size-3.5" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
            active={editor.isActive("heading", { level: 2 })}
            title="Heading 2"
          >
            <Heading2Icon className="size-3.5" />
          </ToolbarButton>

          <ToolbarSeparator />

          <ToolbarButton
            onClick={() => editor.chain().focus().toggleBold().run()}
            active={editor.isActive("bold")}
            title="Bold"
          >
            <BoldIcon className="size-3.5" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleItalic().run()}
            active={editor.isActive("italic")}
            title="Italic"
          >
            <ItalicIcon className="size-3.5" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleStrike().run()}
            active={editor.isActive("strike")}
            title="Strikethrough"
          >
            <StrikethroughIcon className="size-3.5" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleUnderline().run()}
            active={editor.isActive("underline")}
            title="Underline"
          >
            <UnderlineIcon className="size-3.5" />
          </ToolbarButton>

          <ToolbarSeparator />

          <ToolbarButton onClick={toggleLink} active={editor.isActive("link")} title="Link">
            <LinkIcon className="size-3.5" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleCode().run()}
            active={editor.isActive("code")}
            title="Inline code"
          >
            <CodeIcon className="size-3.5" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
            active={editor.isActive("blockquote")}
            title="Blockquote"
          >
            <QuoteIcon className="size-3.5" />
          </ToolbarButton>

          <ToolbarSeparator />

          <ToolbarButton
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            active={editor.isActive("bulletList")}
            title="Bullet list"
          >
            <ListIcon className="size-3.5" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            active={editor.isActive("orderedList")}
            title="Ordered list"
          >
            <ListOrderedIcon className="size-3.5" />
          </ToolbarButton>
        </div>
      </BubbleMenu>

      <EditorContent editor={editor} />
    </div>
  );
}

function ToolbarButton({
  onClick,
  active,
  title,
  children,
}: {
  onClick: () => void;
  active: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      data-active={active || undefined}
      className="flex size-6 items-center justify-center rounded-sm text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground data-[active]:bg-accent data-[active]:text-foreground"
    >
      {children}
    </button>
  );
}

function ToolbarSeparator() {
  return <div className="mx-0.5 h-4 w-px bg-border" />;
}
