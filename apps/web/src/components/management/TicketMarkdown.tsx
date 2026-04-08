import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface TicketMarkdownProps {
  children: string;
}

export function TicketMarkdown({ children }: TicketMarkdownProps) {
  return (
    <div className="ticket-markdown text-xs leading-relaxed">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}
