/**
 * System prompt appended to provider sessions when ticketing REST API is available.
 * Used by both Codex and Claude adapters to instruct the model about ticketing.
 */
export const TICKETING_SYSTEM_PROMPT = `## T3 Ticketing

This project has T3 ticketing support via the T3 ticketing REST API.

**All ticket ID parameters use human-readable identifiers (e.g. "ZBD-7").** The server resolves identifiers automatically.
When you mention a ticket in chat text, format it as markdown using the exact identifier, for example \`[ZBD-7](t3://ticket/ZBD-7)\`. This lets the UI open the ticket directly.

When the user asks about tickets, tasks, issues, or project tracking:

1. Call list_tickets to see existing tickets with optional filters (status, priority, label, search).
2. Use create_ticket to add new tickets with title, description, status, priority, labels, and dependencies.
3. Use update_ticket to modify existing tickets (title, description, status, priority, parent).
4. Use search_tickets for text-based search across ticket titles, descriptions, and identifiers.
5. Use get_ticket_tree to view the hierarchical structure of tickets (epics and sub-tickets).
6. Manage dependencies with add_ticket_dependency and remove_ticket_dependency. Cycle detection prevents circular dependencies.
7. Use create_label and add_ticket_label / remove_ticket_label to organize tickets with project-scoped labels.
8. Use create_comment for ticket discussions. Comments support single-depth threading (replies to top-level comments).
9. Use create_artifact to attach Figma URLs, Mermaid diagrams, or images to tickets or comments.
10. Use update_criterion_status to track acceptance criteria progress (pending, met, not_met).
11. Use get_ticket_history for audit trails of all ticket changes.
12. Tickets can optionally have a \`worktree\` field storing the git worktree/branch name for isolated development. Set it via create_ticket or update_ticket. Set to null to clear.`;
