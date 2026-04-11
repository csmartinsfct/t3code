import type { ComponentPropsWithoutRef, ReactNode } from "react";

import { Badge } from "./ui/badge";

const TICKET_BADGE_CLASS_NAME =
  "font-mono !text-inherit !no-underline decoration-transparent hover:!text-inherit hover:!no-underline hover:decoration-transparent";

export function buildTicketHref(identifier: string): string {
  return `t3://ticket/${encodeURIComponent(identifier)}`;
}

interface TicketIdentifierBadgeProps extends Omit<
  ComponentPropsWithoutRef<typeof Badge>,
  "children"
> {
  identifier: string;
  title?: string | undefined;
  children?: ReactNode;
  onOpen?: ((identifier: string) => void | Promise<void>) | undefined;
}

export function TicketIdentifierBadge({
  identifier,
  title,
  children,
  onOpen,
  className,
  variant = "outline",
  size = "sm",
  ...props
}: TicketIdentifierBadgeProps) {
  const href = buildTicketHref(identifier);

  return (
    <Badge
      {...props}
      variant={variant}
      size={size}
      className={[TICKET_BADGE_CLASS_NAME, className].filter(Boolean).join(" ")}
      title={title ?? identifier}
      render={
        onOpen ? (
          <a
            href={href}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void onOpen(identifier);
            }}
          />
        ) : undefined
      }
    >
      {children ?? identifier}
    </Badge>
  );
}
