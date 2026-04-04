import { memo } from "react";
import { PlugIcon } from "lucide-react";

import { Button } from "../ui/button";
import { Menu, MenuPopup, MenuTrigger } from "../ui/menu";

/**
 * Read-only popover that lists the MCP server names available for the current
 * thread.  Returns `null` when no servers are configured so the button
 * disappears entirely from the composer footer.
 */
export const McpServersPicker = memo(function McpServersPicker(props: {
  serverNames: readonly string[];
  compact?: boolean;
}) {
  const hasServers = props.serverNames.length > 0;

  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            size="sm"
            variant="ghost"
            className="shrink-0 px-2 text-muted-foreground/70 hover:text-foreground/80"
            aria-label="MCP servers"
          />
        }
      >
        <PlugIcon aria-hidden="true" className="size-4" />
        {!props.compact ? <span className="sr-only sm:not-sr-only">MCP</span> : null}
      </MenuTrigger>
      <MenuPopup align="start">
        <div className="px-2 py-1.5 font-medium text-muted-foreground text-xs">MCP Servers</div>
        {hasServers ? (
          props.serverNames.map((name) => (
            <div key={name} className="px-2 py-1.5 text-sm">
              {name}
            </div>
          ))
        ) : (
          <div className="px-2 py-1.5 text-muted-foreground text-sm italic">None detected</div>
        )}
      </MenuPopup>
    </Menu>
  );
});
