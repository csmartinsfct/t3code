import { describe, expect, it } from "vitest";

import {
  TICKET_CHAT_LINK_REMINDER,
  TICKET_TOOL_NAMES_WITH_CHAT_LINK_REMINDER,
  withTicketChatLinkReminder,
} from "./http";

describe("withTicketChatLinkReminder", () => {
  it("appends the chat-link reminder to ticket tool descriptions", () => {
    expect(withTicketChatLinkReminder("List tickets.")).toBe(
      `List tickets. ${TICKET_CHAT_LINK_REMINDER}`,
    );
  });

  it("keeps the reminder wording stable", () => {
    expect(TICKET_CHAT_LINK_REMINDER).toContain("[ZBD-7](t3://ticket/ZBD-7)");
  });

  it("limits the reminder to the intended ticket tools", () => {
    expect(TICKET_TOOL_NAMES_WITH_CHAT_LINK_REMINDER).toEqual([
      "list_tickets",
      "get_ticket",
      "create_ticket",
      "update_ticket",
      "search_tickets",
      "get_ticket_tree",
      "create_comment",
    ]);
  });
});
