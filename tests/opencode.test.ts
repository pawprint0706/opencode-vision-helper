import type { OpencodeClient, Provider } from "@opencode-ai/sdk/v2";
import { describe, expect, it } from "vitest";

import type { PreparedImage } from "../src/imaging.js";
import {
  analyzeWithClient,
  doctorWithClient,
} from "../src/opencode.js";

function visionProvider(): Provider {
  return {
    id: "opencode-go",
    name: "OpenCode Go",
    source: "api",
    env: [],
    options: {},
    models: {
      vision: {
        id: "vision",
        providerID: "opencode-go",
        api: { id: "test", url: "https://example.invalid", npm: "test" },
        name: "Vision",
        capabilities: {
          temperature: true,
          reasoning: false,
          attachment: true,
          toolcall: true,
          input: { text: true, audio: false, image: true, video: false, pdf: false },
          output: { text: true, audio: false, image: false, video: false, pdf: false },
          interleaved: false,
        },
        cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
        limit: { context: 10_000, output: 1_000 },
        status: "active",
        options: {},
        headers: {},
        release_date: "2026-01-01",
      },
    },
  };
}

const image: PreparedImage = {
  path: "C:\\tmp\\screen.png",
  bytes: Buffer.from("image"),
  mime: "image/png",
  width: 1,
  height: 1,
  originalWidth: 1,
  originalHeight: 1,
};

function fakeClient(structured: boolean) {
  const calls: Record<string, unknown> = {};
  const client = {
    global: {
      health: async () => ({ data: { healthy: true, version: "1.18.12" } }),
    },
    provider: {
      list: async () => ({
        data: {
          all: [visionProvider()],
          default: {},
          connected: ["opencode-go"],
        },
      }),
    },
    tool: {
      ids: async () => ({ data: ["bash", "vision_analyze"] }),
    },
    session: {
      create: async (parameters: unknown) => {
        calls.create = parameters;
        return { data: { id: "session-1" } };
      },
      prompt: async (parameters: unknown) => {
        calls.prompt = parameters;
        return {
          data: {
            info: {
              cost: 0.001,
              structured: structured ? { summary: "Looks good", issues: [] } : undefined,
            },
            parts: structured
              ? []
              : [{ type: "text", text: "  custom result  " }],
          },
        };
      },
      delete: async (parameters: unknown) => {
        calls.delete = parameters;
        return { data: true };
      },
    },
  } as unknown as OpencodeClient;
  return { calls, client };
}

describe("OpenCode SDK contract", () => {
  it("reports only connected OpenCode image models", async () => {
    const { client } = fakeClient(true);
    await expect(doctorWithClient(client, "C:\\project")).resolves.toEqual({
      opencode_version: "1.18.12",
      connected_providers: ["opencode-go"],
      image_models: ["opencode-go/vision"],
      ok: true,
    });
  });

  it("constructs an isolated structured request and deletes the session", async () => {
    const { calls, client } = fakeClient(true);
    const result = await analyzeWithClient(client, {
      directory: "C:\\project",
      image,
      model: "opencode-go/vision",
      prompt: "Inspect the UI.",
      structured: true,
      uploadApproved: true,
    });

    expect(result).toEqual({
      model: "opencode-go/vision",
      cost: 0.001,
      report: { summary: "Looks good", issues: [] },
    });
    expect(calls.create).toMatchObject({
      permission: [{ permission: "*", pattern: "*", action: "deny" }],
    });
    expect(calls.prompt).toMatchObject({
      sessionID: "session-1",
      tools: { bash: false, vision_analyze: false },
      format: { type: "json_schema", retryCount: 1 },
      parts: [
        { type: "text" },
        { type: "file", mime: "image/png" },
      ],
    });
    const prompt = calls.prompt as {
      parts: Array<{ url?: string }>;
      format: { schema?: unknown };
    };
    expect(prompt.parts[1]?.url).toBe("data:image/png;base64,aW1hZ2U=");
    expect(calls.prompt).toMatchObject({
      parts: [{ type: "text" }, { filename: "screen.png" }],
    });
    expect(prompt.format.schema).toBeDefined();
    expect(calls.delete).toEqual({
      sessionID: "session-1",
      directory: "C:\\project",
    });
  });

  it("returns custom-prompt text and can retain the isolated session", async () => {
    const { calls, client } = fakeClient(false);
    await expect(
      analyzeWithClient(client, {
        directory: "C:\\project",
        image,
        model: "opencode-go/vision",
        prompt: "Read the visible heading.",
        structured: false,
        uploadApproved: true,
        keepSession: true,
      }),
    ).resolves.toEqual({
      model: "opencode-go/vision",
      cost: 0.001,
      session_id: "session-1",
      text: "  custom result  ",
    });
    expect(calls.delete).toBeUndefined();
  });

  it("rejects an unapproved core upload before making SDK calls", async () => {
    const { calls, client } = fakeClient(true);
    await expect(
      analyzeWithClient(client, {
        directory: "C:\\project",
        image,
        model: "opencode-go/vision",
        prompt: "Inspect the UI.",
        structured: true,
        uploadApproved: false,
      }),
    ).rejects.toMatchObject({ code: "UPLOAD_NOT_APPROVED" });
    expect(calls).toEqual({});
  });
});
