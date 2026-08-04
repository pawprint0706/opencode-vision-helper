import { realpath, stat } from "node:fs/promises";
import { basename, resolve } from "node:path";

import sharp from "sharp";

import { AppError } from "./errors.js";

export const MAX_INPUT_BYTES = 50 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 80_000_000;
export const DEFAULT_MAX_LONG_EDGE = 1568;
const JPEG_PIXEL_THRESHOLD = 1_400_000;
const ALLOWED_FORMATS = new Set(["png", "jpeg", "webp"]);

export type PreparedImage = {
  path: string;
  bytes: Buffer;
  mime: "image/png" | "image/jpeg";
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
};

export type PrepareImageOptions = {
  maxLongEdge?: number;
  resize?: boolean;
};

export async function prepareImage(
  inputPath: string,
  options: PrepareImageOptions = {},
): Promise<PreparedImage> {
  const unresolvedPath = resolve(inputPath);
  let imagePath: string;
  try {
    imagePath = await realpath(unresolvedPath);
  } catch (error) {
    throw new AppError("BAD_REQUEST", `Image file does not exist: ${unresolvedPath}`, {
      cause: error,
    });
  }
  let info;
  try {
    info = await stat(imagePath);
  } catch (error) {
    throw new AppError("BAD_REQUEST", `Image file does not exist: ${imagePath}`, {
      cause: error,
    });
  }
  if (!info.isFile()) {
    throw new AppError("BAD_REQUEST", `Image path is not a file: ${imagePath}`);
  }
  if (info.size > MAX_INPUT_BYTES) {
    throw new AppError(
      "BAD_REQUEST",
      `Image is too large (${info.size} bytes; limit ${MAX_INPUT_BYTES}).`,
    );
  }

  return prepareImageSource(imagePath, imagePath, options);
}

export async function prepareImageBuffer(
  input: Uint8Array,
  filename = "attachment",
  options: PrepareImageOptions = {},
): Promise<PreparedImage> {
  const bytes = Buffer.from(input);
  if (bytes.length > MAX_INPUT_BYTES) {
    throw new AppError(
      "BAD_REQUEST",
      `Image is too large (${bytes.length} bytes; limit ${MAX_INPUT_BYTES}).`,
    );
  }
  const sourceName = basename(filename) || "attachment";
  return prepareImageSource(bytes, sourceName, options);
}

async function prepareImageSource(
  input: string | Buffer,
  sourceName: string,
  options: PrepareImageOptions,
): Promise<PreparedImage> {

  const maxLongEdge = options.maxLongEdge ?? DEFAULT_MAX_LONG_EDGE;
  if (!Number.isInteger(maxLongEdge) || maxLongEdge < 64 || maxLongEdge > 8192) {
    throw new AppError("BAD_REQUEST", "maxLongEdge must be an integer from 64 to 8192.");
  }

  try {
    const source = sharp(input, {
      animated: true,
      failOn: "error",
      limitInputPixels: MAX_IMAGE_PIXELS,
      sequentialRead: true,
    });
    const metadata = await source.metadata();
    if (!metadata.width || !metadata.height || !metadata.format) {
      throw new AppError("BAD_REQUEST", `Cannot determine image metadata: ${sourceName}`);
    }
    if (!ALLOWED_FORMATS.has(metadata.format)) {
      throw new AppError(
        "BAD_REQUEST",
        `Unsupported image format '${metadata.format}'. Use PNG, JPEG, or WebP.`,
      );
    }
    if ((metadata.pages ?? 1) > 1) {
      throw new AppError("BAD_REQUEST", "Animated or multi-page images are not supported in v1.");
    }
    if (metadata.width * metadata.height > MAX_IMAGE_PIXELS) {
      throw new AppError(
        "BAD_REQUEST",
        `Decoded image exceeds ${MAX_IMAGE_PIXELS} pixels.`,
      );
    }

    let pipeline = source.rotate();
    if (options.resize !== false) {
      pipeline = pipeline.resize({
        width: maxLongEdge,
        height: maxLongEdge,
        fit: "inside",
        withoutEnlargement: true,
      });
    }

    const oriented = metadata.orientation && metadata.orientation >= 5
      ? { width: metadata.height, height: metadata.width }
      : { width: metadata.width, height: metadata.height };
    const scale = options.resize === false
      ? 1
      : Math.min(1, maxLongEdge / Math.max(oriented.width, oriented.height));
    const estimatedPixels = Math.max(1, Math.round(oriented.width * scale)) *
      Math.max(1, Math.round(oriented.height * scale));
    const useJpeg = !metadata.hasAlpha && estimatedPixels > JPEG_PIXEL_THRESHOLD;

    const output = useJpeg
      ? await pipeline.jpeg({ quality: 90 }).toBuffer({ resolveWithObject: true })
      : await pipeline.png().toBuffer({ resolveWithObject: true });

    return {
      path: sourceName,
      bytes: output.data,
      mime: useJpeg ? "image/jpeg" : "image/png",
      width: output.info.width,
      height: output.info.height,
      originalWidth: oriented.width,
      originalHeight: oriented.height,
    };
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError("BAD_REQUEST", `Cannot decode image '${sourceName}'.`, {
      cause: error,
    });
  }
}
export function imageDataUrl(image: PreparedImage): string {
  return `data:${image.mime};base64,${image.bytes.toString("base64")}`;
}
