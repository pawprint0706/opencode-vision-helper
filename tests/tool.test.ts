import { resolve } from "node:path";

import type { PluginInput, ToolContext } from "@opencode-ai/plugin";
import type { OpencodeClient, Part } from "@opencode-ai/sdk/v2";
import { describe, expect, it, vi } from "vitest";

import type { PreparedImage } from "../src/imaging.js";
import { VisionHelperPlugin } from "../src/plugin.js";
import { createVisionAnalyzeTool } from "../src/tool.js";

const image: PreparedImage = {
  path: resolve("project", "screen.png"),
  bytes: Buffer.from("image"),
  mime: "image/png",
  width: 1,
  height: 1,
  originalWidth: 1,
  originalHeight: 1,
};

function context(directory: string, worktree = directory) {
  const ask = vi.fn(async () => undefined);
  const metadata = vi.fn();
  const value: ToolContext = {
    sessionID: "parent-session",
    messageID: "message-1",
    agent: "build",
    directory,
    worktree,
    abort: new AbortController().signal,
    ask,
    metadata,
  };
  return { ask, metadata, value };
}

describe("vision_analyze native tool", () => {
  it("registers against the OpenCode server that loaded the plugin", async () => {
    const directory = resolve("project");
    const hooks = await VisionHelperPlugin(
      {
        serverUrl: new URL("http://127.0.0.1:4096"),
        directory,
        worktree: directory,
      } as PluginInput,
      { model: "opencode-go/vision" },
    );
    expect(hooks.tool).toHaveProperty("vision_analyze");
  });

  it("uses the approved core and returns a formatted report", async () => {
    const directory = resolve("project");
    const toolContext = context(directory);
    const analyze = vi.fn(async () => ({
      model: "opencode-go/vision",
      cost: 0.001,
      report: { summary: "Looks good", issues: [] },
    }));
    const definition = createVisionAnalyzeTool(
      {} as OpencodeClient,
      {
        canonicalize: async (path) => resolve(path),
        prepareImage: async () => image,
        analyze,
      },
      { defaultModel: "opencode-go/vision" },
    );

    await expect(
      definition.execute({ image: "screen.png" }, toolContext.value),
    ).resolves.toMatchObject({
      title: "Vision analysis",
      output: "Summary: Looks good\nIssues: none",
      metadata: { model: "opencode-go/vision", cost: 0.001 },
    });
    expect(toolContext.ask).not.toHaveBeenCalled();
    expect(analyze).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        directory,
        structured: true,
        uploadApproved: true,
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("asks for external-directory permission after resolving symlinks", async () => {
    const directory = resolve("project");
    const external = resolve("outside", "screen.png");
    const toolContext = context(directory);
    const definition = createVisionAnalyzeTool({} as OpencodeClient, {
      canonicalize: async (path) =>
        path === resolve(directory, "link.png") ? external : resolve(path),
      prepareImage: async () => image,
      analyze: async () => ({ model: "opencode/vision", text: "  exact text  " }),
    });

    await expect(
      definition.execute(
        {
          image: "link.png",
          prompt: "Read the heading.",
          model: "opencode/vision",
        },
        toolContext.value,
      ),
    ).resolves.toMatchObject({ output: "  exact text  " });
    expect(toolContext.ask).toHaveBeenCalledWith(
      expect.objectContaining({
        permission: "external_directory",
        patterns: [external],
      }),
    );
  });

  it("uses the current message's sole data attachment when image is omitted", async () => {
    const directory = resolve("project");
    const prepareImageBuffer = vi.fn(async () => image);
    const messageParts = vi.fn(
      async (): Promise<Part[]> => [
        {
          id: "part-1",
          sessionID: "parent-session",
          messageID: "message-1",
          type: "file",
          mime: "image/png",
          filename: "attached.png",
          url: "data:image/png;base64,aW1hZ2U=",
        },
      ],
    );
    const definition = createVisionAnalyzeTool(
      {} as OpencodeClient,
      {
        messageParts,
        prepareImageBuffer,
        analyze: async () => ({ model: "opencode-go/vision", text: "attached result" }),
      },
      { defaultModel: "opencode-go/vision" },
    );

    await expect(
      definition.execute({ prompt: "Read it." }, context(directory).value),
    ).resolves.toMatchObject({ output: "attached result" });
    expect(messageParts).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ sessionID: "parent-session", messageID: "message-1" }),
      expect.any(AbortSignal),
    );
    expect(prepareImageBuffer).toHaveBeenCalledWith(Buffer.from("image"), "attached.png");
  });

  it("follows an assistant tool-call message to its parent user attachment", async () => {
    const directory = resolve("project");
    const message = vi.fn(async ({ messageID }: { messageID: string }) => ({
      data:
        messageID === "message-1"
          ? {
              info: { role: "assistant", parentID: "user-message" },
              parts: [],
            }
          : {
              info: { role: "user" },
              parts: [
                {
                  id: "part-1",
                  sessionID: "parent-session",
                  messageID: "user-message",
                  type: "file",
                  mime: "image/png",
                  filename: "parent.png",
                  url: "data:image/png;base64,aW1hZ2U=",
                },
              ],
            },
    }));
    const client = { session: { message } } as unknown as OpencodeClient;
    const definition = createVisionAnalyzeTool(
      client,
      {
        prepareImageBuffer: async () => image,
        analyze: async () => ({ model: "opencode-go/vision", text: "parent result" }),
      },
      { defaultModel: "opencode-go/vision" },
    );

    await expect(
      definition.execute({ prompt: "Read it." }, context(directory).value),
    ).resolves.toMatchObject({ output: "parent result" });
    expect(message).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ messageID: "user-message" }),
      expect.objectContaining({ throwOnError: true }),
    );
  });

  it("returns the stable error contract when no model is configured", async () => {
    const previous = process.env.OPENCODE_VISION_MODEL;
    delete process.env.OPENCODE_VISION_MODEL;
    try {
      const definition = createVisionAnalyzeTool({} as OpencodeClient);
      const result = await definition.execute(
        { image: "screen.png" },
        context(resolve("project")).value,
      );
      expect(JSON.parse(result as string)).toMatchObject({
        status: "error",
        error_code: "CONFIGURATION",
        retryable: false,
      });
    } finally {
      if (previous === undefined) {
        delete process.env.OPENCODE_VISION_MODEL;
      } else {
        process.env.OPENCODE_VISION_MODEL = previous;
      }
    }
  });
});
