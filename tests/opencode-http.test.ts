import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { createOpencodeClient } from "@opencode-ai/sdk/v2";
import { afterEach, describe, expect, it } from "vitest";

import { AppError } from "../src/errors.js";
import type { PreparedImage } from "../src/imaging.js";
import { analyzeWithClient, doctorWithClient } from "../src/opencode.js";

type RecordedRequest = {
  method: string;
  path: string;
  directory: string | null;
  body?: unknown;
};

type FakeResponse = {
  status?: number;
  body: unknown;
};

type Responder = (
  request: RecordedRequest,
) => FakeResponse | Promise<FakeResponse>;

const servers: Array<ReturnType<typeof createServer>> = [];

async function requestBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : undefined;
}

function sendJson(response: ServerResponse, result: FakeResponse): void {
  response.statusCode = result.status ?? 200;
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(result.body));
}

async function fakeServer(responder: Responder) {
  const requests: RecordedRequest[] = [];
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const recorded: RecordedRequest = {
        method: request.method ?? "GET",
        path: url.pathname,
        directory: url.searchParams.get("directory"),
        body: await requestBody(request),
      };
      requests.push(recorded);
      sendJson(response, await responder(recorded));
    } catch {
      sendJson(response, {
        status: 500,
        body: { name: "FakeServerError", data: { message: "Fake server failed." } },
      });
    }
  });
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  return {
    client: createOpencodeClient({ baseUrl }),
    requests,
  };
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    ),
  );
});

function providerPayload() {
  return {
    all: [
      {
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
      },
    ],
    default: {},
    connected: ["opencode-go"],
  };
}

const image: PreparedImage = {
  path: "D:\\private\\screen.png",
  bytes: Buffer.from("image"),
  mime: "image/png",
  width: 1,
  height: 1,
  originalWidth: 1,
  originalHeight: 1,
};

describe("OpenCode SDK HTTP boundary", () => {
  it("runs doctor through the generated SDK routes", async () => {
    const directory = "D:\\workspace with spaces";
    const { client, requests } = await fakeServer((request) => {
      if (request.path === "/global/health") {
        return { body: { healthy: true, version: "1.18.12" } };
      }
      if (request.path === "/provider") {
        return { body: providerPayload() };
      }
      return { status: 404, body: {} };
    });

    await expect(doctorWithClient(client, directory)).resolves.toMatchObject({
      opencode_version: "1.18.12",
      connected_providers: ["opencode-go"],
      image_models: ["opencode-go/vision"],
      ok: true,
    });
    expect(requests).toEqual([
      { method: "GET", path: "/global/health", directory: null },
      { method: "GET", path: "/provider", directory, body: undefined },
    ]);
  });

  it("cancels an in-flight doctor provider check", async () => {
    const controller = new AbortController();
    let markProviderStarted: (() => void) | undefined;
    const providerStarted = new Promise<void>((resolve) => {
      markProviderStarted = resolve;
    });
    const { client } = await fakeServer(async (request) => {
      if (request.path === "/global/health") {
        return { body: { healthy: true, version: "1.18.12" } };
      }
      markProviderStarted?.();
      await new Promise((resolve) => setTimeout(resolve, 100));
      return { body: providerPayload() };
    });
    const checking = doctorWithClient(
      client,
      "D:\\workspace",
      controller.signal,
    );

    await providerStarted;
    controller.abort(new AppError("ANALYSIS_ABORTED", "Doctor canceled by test."));

    await expect(checking).rejects.toMatchObject({
      code: "ANALYSIS_ABORTED",
      message: "Doctor canceled by test.",
    });
  });

  it("serializes an isolated image request and deletes its session", async () => {
    const directory = "D:\\workspace";
    const { client, requests } = await fakeServer((request) => {
      if (request.path === "/provider") {
        return { body: providerPayload() };
      }
      if (request.path === "/experimental/tool/ids") {
        return { body: ["bash", "vision_analyze"] };
      }
      if (request.method === "POST" && request.path === "/session") {
        return { body: { id: "session-http" } };
      }
      if (request.path === "/session/session-http/message") {
        return {
          body: {
            info: {
              cost: 0.002,
              structured: { summary: "HTTP result", issues: [] },
            },
            parts: [],
          },
        };
      }
      if (request.method === "DELETE" && request.path === "/session/session-http") {
        return { body: true };
      }
      return { status: 404, body: {} };
    });

    await expect(
      analyzeWithClient(client, {
        directory,
        image,
        model: "opencode-go/vision",
        prompt: "Inspect the UI.",
        structured: true,
        uploadApproved: true,
      }),
    ).resolves.toEqual({
      model: "opencode-go/vision",
      cost: 0.002,
      report: { summary: "HTTP result", issues: [] },
    });

    expect(requests.map(({ method, path }) => `${method} ${path}`)).toEqual([
      "GET /provider",
      "GET /experimental/tool/ids",
      "POST /session",
      "POST /session/session-http/message",
      "DELETE /session/session-http",
    ]);
    expect(requests.every((request) => request.directory === directory)).toBe(true);
    expect(requests[2]?.body).toMatchObject({
      model: { providerID: "opencode-go", id: "vision" },
      permission: [{ permission: "*", pattern: "*", action: "deny" }],
      metadata: { service: "opencode-vision-helper" },
    });
    expect(requests[3]?.body).toMatchObject({
      tools: { bash: false, vision_analyze: false },
      format: {
        type: "json_schema",
        retryCount: 1,
        schema: {
          additionalProperties: false,
          required: ["summary", "issues"],
        },
      },
      parts: [
        { type: "text" },
        {
          type: "file",
          mime: "image/png",
          filename: "screen.png",
          url: "data:image/png;base64,aW1hZ2U=",
        },
      ],
    });
  });

  it("sanitizes an HTTP prompt failure before aborting and deleting the session", async () => {
    const { client, requests } = await fakeServer((request) => {
      if (request.path === "/provider") {
        return { body: providerPayload() };
      }
      if (request.path === "/experimental/tool/ids") {
        return { body: ["bash"] };
      }
      if (request.method === "POST" && request.path === "/session") {
        return { body: { id: "session-failed" } };
      }
      if (request.path === "/session/session-failed/message") {
        return {
          status: 503,
          body: {
            name: "APIError",
            data: { message: "secret upstream response", isRetryable: false },
          },
        };
      }
      if (request.path === "/session/session-failed/abort") {
        return { body: true };
      }
      if (request.method === "DELETE" && request.path === "/session/session-failed") {
        return { body: true };
      }
      return { status: 404, body: {} };
    });

    await expect(
      analyzeWithClient(client, {
        directory: "D:\\workspace",
        image,
        model: "opencode-go/vision",
        prompt: "Inspect the UI.",
        structured: true,
        uploadApproved: true,
      }),
    ).rejects.toMatchObject({
      code: "PROVIDER_ERROR",
      retryable: false,
      message: "OpenCode provider request failed.",
    });
    expect(requests.map(({ method, path }) => `${method} ${path}`)).toEqual([
      "GET /provider",
      "GET /experimental/tool/ids",
      "POST /session",
      "POST /session/session-failed/message",
      "POST /session/session-failed/abort",
      "DELETE /session/session-failed",
    ]);
  });

  it("maps an SDK-wrapped provider authentication response", async () => {
    const { client, requests } = await fakeServer(() => ({
      status: 401,
      body: {
        name: "ProviderAuthError",
        data: { message: "secret authentication detail" },
      },
    }));

    await expect(
      analyzeWithClient(client, {
        directory: "D:\\workspace",
        image,
        model: "opencode-go/vision",
        prompt: "Inspect the UI.",
        structured: true,
        uploadApproved: true,
      }),
    ).rejects.toMatchObject({
      code: "PROVIDER_NOT_CONNECTED",
      message: "The selected OpenCode provider could not authenticate.",
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.path).toBe("/provider");
  });

  it("propagates an explicit cancellation through an in-flight SDK request", async () => {
    const controller = new AbortController();
    let markRequestStarted: (() => void) | undefined;
    const requestStarted = new Promise<void>((resolve) => {
      markRequestStarted = resolve;
    });
    const { client } = await fakeServer(async () => {
      markRequestStarted?.();
      await new Promise((resolve) => setTimeout(resolve, 100));
      return { body: providerPayload() };
    });
    const analysis = analyzeWithClient(client, {
      directory: "D:\\workspace",
      image,
      model: "opencode-go/vision",
      prompt: "Inspect the UI.",
      structured: true,
      uploadApproved: true,
      signal: controller.signal,
    });

    await requestStarted;
    controller.abort(new AppError("ANALYSIS_ABORTED", "Canceled by test."));

    await expect(analysis).rejects.toMatchObject({
      code: "ANALYSIS_ABORTED",
      message: "Canceled by test.",
    });
  });
});
