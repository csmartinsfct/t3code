import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Effect, Schema } from "effect";

import { DEFAULT_MODEL_BY_PROVIDER } from "./model";
import { BASE_PROVIDER_KINDS, type BaseProviderKind } from "./orchestration";
import {
  TicketCreateInput,
  TicketId,
  TicketModelSelection,
  TicketUpdateInput,
  type TicketModelSelection as TicketModelSelectionType,
} from "./ticketing";

const decodeTicketModelSelection = Schema.decodeUnknownEffect(TicketModelSelection);
const decodeTicketCreateInput = Schema.decodeUnknownEffect(TicketCreateInput);
const decodeTicketUpdateInput = Schema.decodeUnknownEffect(TicketUpdateInput);

const selectionForProvider = (provider: BaseProviderKind): TicketModelSelectionType => {
  const model = DEFAULT_MODEL_BY_PROVIDER[provider];

  switch (provider) {
    case "claudeAgent":
      return { provider, profileId: "metric", model };
    case "gemini":
      return { provider, profileId: "default", model };
    case "codex":
      return { provider, model };
  }
};

it.effect("ticket model overrides accept every canonical base provider", () =>
  Effect.gen(function* () {
    for (const provider of BASE_PROVIDER_KINDS) {
      const parsed = yield* decodeTicketModelSelection(selectionForProvider(provider));
      assert.strictEqual(parsed.provider, provider);
    }
  }),
);

it.effect("ticket create input accepts Gemini implementer and reviewer overrides", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeTicketCreateInput({
      projectId: "project-gemini-overrides",
      title: "Gemini override ticket",
      implementerModelOverride: {
        provider: "gemini",
        profileId: "default",
        model: "gemini-3.1-pro-preview",
      },
      reviewerModelOverride: {
        provider: "gemini",
        profileId: "reviewer",
        model: "gemini-2.5-flash",
      },
    });

    assert.strictEqual(parsed.implementerModelOverride?.provider, "gemini");
    assert.strictEqual(parsed.reviewerModelOverride?.provider, "gemini");
  }),
);

it.effect("ticket update input accepts Gemini implementer and reviewer overrides", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeTicketUpdateInput({
      id: TicketId.makeUnsafe("ticket-gemini-overrides"),
      implementerModelOverride: {
        provider: "gemini",
        profileId: "default",
        model: "gemini-3.1-pro-preview",
      },
      reviewerModelOverride: {
        provider: "gemini",
        profileId: "reviewer",
        model: "gemini-2.5-flash",
      },
    });

    assert.strictEqual(parsed.implementerModelOverride?.provider, "gemini");
    assert.strictEqual(parsed.reviewerModelOverride?.provider, "gemini");
  }),
);
