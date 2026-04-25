import { Loader2Icon } from "lucide-react";
import { Badge } from "../ui/badge";

interface DynamicChatUiStatusCardProps {
  title: string;
  description: string | null;
}

export function DynamicChatUiStatusCard({ title, description }: DynamicChatUiStatusCardProps) {
  return (
    <section className="my-2 w-full min-w-0 max-w-[800px] overflow-hidden rounded-2xl border border-border bg-card shadow-xs/5">
      <div className="min-w-0 px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-3">
          <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-card-foreground">
            {title}
          </h3>
          <Badge variant="warning" size="sm" className="shrink-0 gap-1">
            <Loader2Icon className="size-3 animate-spin" />
            Building
          </Badge>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {description ?? "Creating an interactive UI for this chat."}
        </p>
      </div>
    </section>
  );
}
