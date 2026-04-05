import { describe, expect, it } from "vitest";

import { isProposeActionBlock, parseProposeActionPayload } from "./proposeActionParser";

describe("isProposeActionBlock", () => {
  it("returns true for the t3:propose-action language", () => {
    expect(isProposeActionBlock("language-t3:propose-action")).toBe(true);
  });

  it("returns true when language is part of a longer className", () => {
    expect(isProposeActionBlock("code language-t3:propose-action hljs")).toBe(true);
  });

  it("returns false for other languages", () => {
    expect(isProposeActionBlock("language-json")).toBe(false);
    expect(isProposeActionBlock("language-typescript")).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isProposeActionBlock(undefined)).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isProposeActionBlock("")).toBe(false);
  });
});

describe("parseProposeActionPayload", () => {
  it("parses valid JSON with all fields", () => {
    const result = parseProposeActionPayload(
      '{"name": "Dev Server", "command": "npm run dev", "icon": "play"}',
    );
    expect(result).toEqual({ name: "Dev Server", command: "npm run dev", icon: "play" });
  });

  it("parses valid JSON with different icon", () => {
    const result = parseProposeActionPayload(
      '{"name": "Run Tests", "command": "bun test", "icon": "test"}',
    );
    expect(result).toEqual({ name: "Run Tests", command: "bun test", icon: "test" });
  });

  it("defaults icon to play when missing", () => {
    const result = parseProposeActionPayload('{"name": "Build", "command": "bun run build"}');
    expect(result).toEqual({ name: "Build", command: "bun run build", icon: "play" });
  });

  it("defaults icon to play for invalid icon value", () => {
    const result = parseProposeActionPayload(
      '{"name": "Build", "command": "bun build", "icon": "invalid"}',
    );
    expect(result).toEqual({ name: "Build", command: "bun build", icon: "play" });
  });

  it("returns null for empty string", () => {
    expect(parseProposeActionPayload("")).toBeNull();
  });

  it("returns null for whitespace only", () => {
    expect(parseProposeActionPayload("   \n  ")).toBeNull();
  });

  it("returns null for incomplete JSON (streaming)", () => {
    expect(parseProposeActionPayload('{"name": "Dev')).toBeNull();
    expect(parseProposeActionPayload('{"name": "Dev", "command":')).toBeNull();
    expect(parseProposeActionPayload("{")).toBeNull();
  });

  it("returns null when name is missing", () => {
    expect(parseProposeActionPayload('{"command": "npm run dev"}')).toBeNull();
  });

  it("returns null when command is missing", () => {
    expect(parseProposeActionPayload('{"name": "Dev Server"}')).toBeNull();
  });

  it("returns null when name is empty", () => {
    expect(parseProposeActionPayload('{"name": "", "command": "npm run dev"}')).toBeNull();
  });

  it("returns null when command is empty", () => {
    expect(parseProposeActionPayload('{"name": "Dev Server", "command": ""}')).toBeNull();
  });

  it("returns null for non-object JSON", () => {
    expect(parseProposeActionPayload("[]")).toBeNull();
    expect(parseProposeActionPayload('"hello"')).toBeNull();
    expect(parseProposeActionPayload("42")).toBeNull();
    expect(parseProposeActionPayload("null")).toBeNull();
  });

  it("trims whitespace from name and command", () => {
    const result = parseProposeActionPayload(
      '{"name": "  Dev Server  ", "command": "  npm run dev  "}',
    );
    expect(result).toEqual({ name: "Dev Server", command: "npm run dev", icon: "play" });
  });

  it("handles whitespace around the JSON", () => {
    const result = parseProposeActionPayload('\n  {"name": "Dev", "command": "npm dev"}  \n');
    expect(result).toEqual({ name: "Dev", command: "npm dev", icon: "play" });
  });

  it("accepts all valid icon types", () => {
    for (const icon of ["play", "test", "lint", "configure", "build", "debug"]) {
      const result = parseProposeActionPayload(`{"name": "A", "command": "b", "icon": "${icon}"}`);
      expect(result?.icon).toBe(icon);
    }
  });
});
