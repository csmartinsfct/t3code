export interface InlineDirective {
  readonly name: string;
  readonly attributes: string;
  readonly start: number;
  readonly end: number;
  readonly raw: string;
}

const DIRECTIVE_NAME = /[A-Za-z0-9_-]/;

function decodeAttributeEscapes(attributes: string): string {
  let decoded = "";

  for (let index = 0; index < attributes.length; index += 1) {
    const character = attributes[index];
    if (character === "\\" && (attributes[index + 1] === "\\" || attributes[index + 1] === '"')) {
      decoded += attributes[index + 1];
      index += 1;
    } else {
      decoded += character;
    }
  }

  return decoded;
}

type DirectiveBodyScan =
  | { readonly kind: "complete"; readonly closeBrace: number }
  | { readonly kind: "restart"; readonly start: number }
  | { readonly kind: "unterminated" };

function findOpenBrace(text: string, start: number): number {
  let nameEnd = start + 2;
  while (nameEnd < text.length && DIRECTIVE_NAME.test(text[nameEnd] ?? "")) {
    nameEnd += 1;
  }

  return nameEnd > start + 2 && text[nameEnd] === "{" ? nameEnd : -1;
}

function scanDirectiveBody(text: string, openBrace: number): DirectiveBodyScan {
  let quoted = false;
  let escaped = false;

  for (let index = openBrace + 1; index < text.length; index += 1) {
    const character = text[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (quoted && character === "\\") {
      escaped = true;
      continue;
    }

    if (character === '"') {
      quoted = !quoted;
    } else if (character === "}" && !quoted) {
      return { kind: "complete", closeBrace: index };
    } else if (
      !quoted &&
      character === ":" &&
      text[index + 1] === ":" &&
      findOpenBrace(text, index) !== -1
    ) {
      return { kind: "restart", start: index };
    }
  }

  return { kind: "unterminated" };
}

export function parseInlineDirectives(text: string): InlineDirective[] {
  const directives: InlineDirective[] = [];
  let searchFrom = 0;

  while (searchFrom < text.length - 2) {
    const start = text.indexOf("::", searchFrom);
    if (start === -1) break;

    const openBrace = findOpenBrace(text, start);
    if (openBrace === -1) {
      searchFrom = start + 2;
      continue;
    }

    const body = scanDirectiveBody(text, openBrace);
    if (body.kind === "unterminated") break;
    if (body.kind === "restart") {
      searchFrom = body.start;
      continue;
    }

    const end = body.closeBrace + 1;
    directives.push({
      name: text.slice(start + 2, openBrace),
      attributes: decodeAttributeEscapes(text.slice(openBrace + 1, body.closeBrace)),
      start,
      end,
      raw: text.slice(start, end),
    });

    searchFrom = end;
  }

  return directives;
}
