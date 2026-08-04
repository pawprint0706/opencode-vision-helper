import { pathToFileURL } from "node:url";

import type { Part } from "@opencode-ai/sdk/v2";
import { describe, expect, it } from "vitest";

import { selectMessageImage } from "../src/attachment.js";

function filePart(overrides: Partial<Extract<Part, { type: "file" }>> = {}) {
  return {
    id: "part-1",
    sessionID: "session-1",
    messageID: "message-1",
    type: "file" as const,
    mime: "image/png",
    filename: "shot.png",
    url: "data:image/png;base64,aW1hZ2U=",
    ...overrides,
  } satisfies Extract<Part, { type: "file" }>;
}

describe("current-message image attachments", () => {
  it("prefers an explicit local file source", () => {
    expect(
      selectMessageImage([
        filePart({
          source: {
            type: "file",
            path: "screens/shot.png",
            text: { value: "", start: 0, end: 0 },
          },
        }),
      ]),
    ).toEqual({ kind: "path", path: "screens/shot.png", filename: "shot.png" });
  });

  it("accepts file URLs and strict base64 image data URLs", () => {
    const localPath = pathToFileURL("D:/screens/shot.png").href;
    expect(selectMessageImage([filePart({ url: localPath })])).toMatchObject({
      kind: "path",
    });
    expect(selectMessageImage([filePart()])).toEqual({
      kind: "data",
      bytes: Buffer.from("image"),
      filename: "shot.png",
    });
  });

  it("rejects missing, multiple, remote, and malformed image attachments", () => {
    expect(() => selectMessageImage([])).toThrow(/No image attachment/);
    expect(() => selectMessageImage([filePart(), filePart({ id: "part-2" })])).toThrow(
      /Multiple image attachments/,
    );
    expect(() => selectMessageImage([filePart({ url: "https://example.invalid/shot.png" })]))
      .toThrow(/local path or supported data URL/);
    expect(() => selectMessageImage([filePart({ url: "data:image/png;base64,%%%" })]))
      .toThrow(/supported base64 image data URL/);
  });
});
