import { resolve } from "node:path";

import type { PluginInput, ToolContext } from "@opencode-ai/plugin";
import type { OpencodeClient, Part } from "@opencode-ai/sdk/v2";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppError } from "../src/errors.js";
import type { PreparedImage } from "../src/imaging.js";
import { VisionHelperPlugin } from "../src/plugin.js";
import { adaptPluginClient } from "../src/plugin-client.js";
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

function context(directory: string, worktree = directory, abort = new AbortController().signal) {
  const ask = vi.fn(async () => undefined);
  const metadata = vi.fn();
  const value: ToolContext = {
    sessionID: "parent-session",
    messageID: "message-1",
    agent: "build",
    directory,
    worktree,
    abort,
    ask,
    metadata,
  };
  return { ask, metadata, value };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("vision_analyze native tool", () => {
  it("registers against the OpenCode server that loaded the plugin", async () => {
    const directory = resolve("project");
    const client = {} as PluginInput["client"];
    const hooks = await VisionHelperPlugin(
      {
        client,
        serverUrl: new URL("http://127.0.0.1:4096"),
        directory,
        worktree: directory,
      } as PluginInput,
      { model: "opencode-go/vision" },
    );
    expect(hooks.tool).toHaveProperty("vision_analyze");
  });

  it("adapts the supplied plugin client without creating another connection", async () => {
    const providerList = vi.fn(async () => ({ data: { all: [], connected: [] } }));
    const toolIds = vi.fn(async () => ({ data: ["read"] }));
    const sessionCreate = vi.fn(async () => ({ data: { id: "analysis-session" } }));
    const sessionDelete = vi.fn(async () => ({ data: true }));
    const sessionAbort = vi.fn(async () => ({ data: true }));
    const sessionPrompt = vi.fn(async () => ({ data: {} }));
    const sessionMessage = vi.fn(async () => ({ data: {} }));
    const pluginClient = {
      provider: { list: providerList },
      tool: { ids: toolIds },
      session: {
        create: sessionCreate,
        delete: sessionDelete,
        abort: sessionAbort,
        prompt: sessionPrompt,
        message: sessionMessage,
      },
    } as unknown as PluginInput["client"];
    const client = adaptPluginClient(pluginClient);
    const signal = new AbortController().signal;

    await client.provider.list({ directory: "project" }, { throwOnError: true, signal });
    await client.tool.ids({ directory: "project" }, { throwOnError: true });
    await client.session.create(
      { directory: "project", title: "analysis", metadata: { service: "vision" } },
      { throwOnError: true },
    );
    await client.session.prompt(
      { sessionID: "session", directory: "project", parts: [] },
      { throwOnError: true },
    );
    await client.session.message(
      { sessionID: "session", messageID: "message", directory: "project" },
      { throwOnError: true },
    );

    expect(providerList).toHaveBeenCalledWith({
      throwOnError: true,
      signal,
      query: { directory: "project" },
    });
    expect(toolIds).toHaveBeenCalledWith({
      throwOnError: true,
      query: { directory: "project" },
    });
    expect(sessionCreate).toHaveBeenCalledWith({
      throwOnError: true,
      body: { title: "analysis", metadata: { service: "vision" } },
      query: { directory: "project" },
    });
    expect(sessionPrompt).toHaveBeenCalledWith({
      throwOnError: true,
      body: { parts: [] },
      path: { id: "session" },
      query: { directory: "project" },
    });
    expect(sessionMessage).toHaveBeenCalledWith({
      throwOnError: true,
      path: { id: "session", messageID: "message" },
      query: { directory: "project" },
    });
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
    expect(toolContext.ask).toHaveBeenCalledWith({
      permission: "vision_analyze",
      patterns: ["opencode-go/vision"],
      always: ["opencode-go/vision"],
      metadata: {
        reason: "Upload the selected image for cloud vision analysis",
        image: image.path,
        model: "opencode-go/vision",
      },
    });
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
    expect(toolContext.ask).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        permission: "external_directory",
        patterns: [external],
      }),
    );
    expect(toolContext.ask).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        permission: "vision_analyze",
        patterns: ["opencode/vision"],
      }),
    );
  });

  it("does not treat an in-worktree name beginning with dots as external", async () => {
    const directory = resolve("project");
    const toolContext = context(directory);
    const definition = createVisionAnalyzeTool(
      {} as OpencodeClient,
      {
        canonicalize: async (path) => resolve(path),
        prepareImage: async () => image,
        analyze: async () => ({ model: "opencode-go/vision", text: "result" }),
      },
      { defaultModel: "opencode-go/vision" },
    );

    await definition.execute({ image: "..screens/shot.png" }, toolContext.value);

    expect(toolContext.ask).toHaveBeenCalledTimes(1);
    expect(toolContext.ask).toHaveBeenCalledWith(
      expect.objectContaining({ permission: "vision_analyze" }),
    );
  });

  it("does not upload when vision permission is denied", async () => {
    const directory = resolve("project");
    const toolContext = context(directory);
    toolContext.ask.mockRejectedValue(new Error("Permission denied"));
    const analyze = vi.fn();
    const definition = createVisionAnalyzeTool(
      {} as OpencodeClient,
      {
        canonicalize: async (path) => resolve(path),
        prepareImage: async () => image,
        analyze,
      },
      { defaultModel: "opencode-go/vision" },
    );

    const result = await definition.execute({ image: "screen.png" }, toolContext.value);

    expect(JSON.parse(result as string)).toMatchObject({
      status: "error",
      error_code: "UPLOAD_NOT_APPROVED",
      retryable: false,
    });
    expect(analyze).not.toHaveBeenCalled();
  });

  it("rejects an unsupported model before reading an image or message", async () => {
    const directory = resolve("project");
    const toolContext = context(directory);
    const canonicalize = vi.fn();
    const messageParts = vi.fn();
    const definition = createVisionAnalyzeTool({} as OpencodeClient, {
      canonicalize,
      messageParts,
    });

    const result = await definition.execute(
      { image: "screen.png", model: "openai/vision" },
      toolContext.value,
    );

    expect(JSON.parse(result as string)).toMatchObject({
      status: "error",
      error_code: "CONFIGURATION",
      retryable: false,
    });
    expect(canonicalize).not.toHaveBeenCalled();
    expect(messageParts).not.toHaveBeenCalled();
    expect(toolContext.ask).not.toHaveBeenCalled();
  });

  it("does not read or upload an external image when directory access is denied", async () => {
    const directory = resolve("project");
    const external = resolve("outside", "screen.png");
    const toolContext = context(directory);
    toolContext.ask.mockRejectedValueOnce(new Error("Permission denied"));
    const prepareImage = vi.fn();
    const analyze = vi.fn();
    const definition = createVisionAnalyzeTool(
      {} as OpencodeClient,
      {
        canonicalize: async (path) =>
          path === resolve(directory, "link.png") ? external : resolve(path),
        prepareImage,
        analyze,
      },
      { defaultModel: "opencode-go/vision" },
    );

    const result = await definition.execute({ image: "link.png" }, toolContext.value);

    expect(JSON.parse(result as string)).toMatchObject({
      status: "error",
      error_code: "UPLOAD_NOT_APPROVED",
      retryable: false,
      message: "OpenCode did not approve access to the external image.",
    });
    expect(prepareImage).not.toHaveBeenCalled();
    expect(analyze).not.toHaveBeenCalled();
    expect(toolContext.ask).toHaveBeenCalledTimes(1);
  });

  it("preserves cancellation while waiting for upload permission", async () => {
    const directory = resolve("project");
    const parent = new AbortController();
    const toolContext = context(directory, directory, parent.signal);
    toolContext.ask.mockImplementation(async () => {
      parent.abort(new AppError("ANALYSIS_ABORTED", "Canceled by caller."));
      throw new DOMException("aborted", "AbortError");
    });
    const analyze = vi.fn();
    const definition = createVisionAnalyzeTool(
      {} as OpencodeClient,
      {
        canonicalize: async (path) => resolve(path),
        prepareImage: async () => image,
        analyze,
      },
      { defaultModel: "opencode-go/vision" },
    );

    const result = await definition.execute({ image: "screen.png" }, toolContext.value);

    expect(JSON.parse(result as string)).toMatchObject({
      status: "error",
      error_code: "ANALYSIS_ABORTED",
      message: "Canceled by caller.",
    });
    expect(analyze).not.toHaveBeenCalled();
  });

  it("preserves timeout while waiting for upload permission", async () => {
    vi.useFakeTimers();
    const directory = resolve("project");
    const toolContext = context(directory);
    toolContext.ask.mockImplementation(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
      throw new DOMException("aborted", "AbortError");
    });
    const analyze = vi.fn();
    const definition = createVisionAnalyzeTool(
      {} as OpencodeClient,
      {
        canonicalize: async (path) => resolve(path),
        prepareImage: async () => image,
        analyze,
      },
      { defaultModel: "opencode-go/vision", timeoutMs: 1_000 },
    );

    const result = await definition.execute({ image: "screen.png" }, toolContext.value);

    expect(JSON.parse(result as string)).toMatchObject({
      status: "error",
      error_code: "ANALYSIS_TIMEOUT",
      retryable: true,
    });
    expect(analyze).not.toHaveBeenCalled();
  });

  it("does not read an image when the tool context is already canceled", async () => {
    const directory = resolve("project");
    const parent = new AbortController();
    parent.abort(new AppError("ANALYSIS_ABORTED", "Canceled before execution."));
    const toolContext = context(directory, directory, parent.signal);
    const canonicalize = vi.fn();
    const prepareImage = vi.fn();
    const definition = createVisionAnalyzeTool(
      {} as OpencodeClient,
      { canonicalize, prepareImage },
      { defaultModel: "opencode-go/vision" },
    );

    const result = await definition.execute({ image: "screen.png" }, toolContext.value);

    expect(JSON.parse(result as string)).toMatchObject({
      status: "error",
      error_code: "ANALYSIS_ABORTED",
      message: "Canceled before execution.",
    });
    expect(canonicalize).not.toHaveBeenCalled();
    expect(prepareImage).not.toHaveBeenCalled();
    expect(toolContext.ask).not.toHaveBeenCalled();
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
