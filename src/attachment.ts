import { fileURLToPath } from "node:url";

import type { Part } from "@opencode-ai/sdk/v2";

import { AppError } from "./errors.js";
import { MAX_INPUT_BYTES } from "./imaging.js";

export type SelectedImageAttachment =
  | { kind: "path"; path: string; filename: string }
  | { kind: "data"; bytes: Buffer; filename: string };

const MAX_BASE64_LENGTH = Math.ceil(MAX_INPUT_BYTES / 3) * 4;

function decodeDataUrl(url: string, filename: string): SelectedImageAttachment {
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/]*={0,2})$/.exec(url);
  if (!match?.[1]?.startsWith("image/") || match[2] === undefined) {
    throw new AppError(
      "BAD_REQUEST",
      "The selected message attachment is not a supported base64 image data URL.",
    );
  }
  const payload = match[2];
  if (payload.length > MAX_BASE64_LENGTH || payload.length % 4 !== 0) {
    throw new AppError("BAD_REQUEST", "The selected message attachment is too large or malformed.");
  }
  const bytes = Buffer.from(payload, "base64");
  if (bytes.length > MAX_INPUT_BYTES) {
    throw new AppError(
      "BAD_REQUEST",
      `Image is too large (${bytes.length} bytes; limit ${MAX_INPUT_BYTES}).`,
    );
  }
  return { kind: "data", bytes, filename };
}

export function selectMessageImage(parts: Part[]): SelectedImageAttachment {
  const images = parts.filter(
    (part): part is Extract<Part, { type: "file" }> =>
      part.type === "file" && part.mime.startsWith("image/"),
  );
  if (images.length === 0) {
    throw new AppError(
      "BAD_REQUEST",
      "No image attachment was found in the current OpenCode message; pass image explicitly.",
    );
  }
  if (images.length > 1) {
    throw new AppError(
      "BAD_REQUEST",
      `Multiple image attachments were found (${images.length}); pass image explicitly.`,
    );
  }

  const part = images[0];
  if (!part) {
    throw new AppError("BAD_REQUEST", "The selected image attachment is unavailable.");
  }
  const filename = part.filename ?? "attachment";
  if (part.source?.type === "file") {
    return { kind: "path", path: part.source.path, filename };
  }
  if (part.url.startsWith("file:")) {
    try {
      return { kind: "path", path: fileURLToPath(part.url), filename };
    } catch (error) {
      throw new AppError("BAD_REQUEST", "The image attachment has an invalid file URL.", {
        cause: error,
      });
    }
  }
  if (part.url.startsWith("data:")) {
    return decodeDataUrl(part.url, filename);
  }
  throw new AppError(
    "BAD_REQUEST",
    "The image attachment does not expose a local path or supported data URL.",
  );
}
