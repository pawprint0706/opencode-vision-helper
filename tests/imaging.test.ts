import { mkdir, mkdtemp, realpath, rm, symlink, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";

import { AppError } from "../src/errors.js";
import {
  imageDataUrl,
  MAX_IMAGE_PIXELS,
  MAX_INPUT_BYTES,
  prepareImage,
  prepareImageBuffer,
} from "../src/imaging.js";

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "opencode-vision-helper-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

describe("image preparation", () => {
  it("downscales and normalizes an image without changing the source", async () => {
    const directory = await temporaryDirectory();
    const imagePath = join(directory, "wide.png");
    await sharp({
      create: { width: 2000, height: 1000, channels: 3, background: "white" },
    })
      .png()
      .toFile(imagePath);

    const prepared = await prepareImage(imagePath, { maxLongEdge: 500 });

    expect(prepared.originalWidth).toBe(2000);
    expect(prepared.width).toBe(500);
    expect(prepared.height).toBe(250);
    expect(prepared.mime).toBe("image/png");
    expect(imageDataUrl(prepared)).toMatch(/^data:image\/png;base64,/);
    expect((await sharp(imagePath).metadata()).width).toBe(2000);
  });

  it("canonicalizes an image reached through a directory symlink or junction", async () => {
    const directory = await temporaryDirectory();
    const realDirectory = join(directory, "real");
    const linkedDirectory = join(directory, "linked");
    const imagePath = join(realDirectory, "shot.png");
    await mkdir(realDirectory);
    await sharp({ create: { width: 10, height: 10, channels: 3, background: "white" } })
      .png()
      .toFile(imagePath);
    await symlink(
      realDirectory,
      linkedDirectory,
      process.platform === "win32" ? "junction" : "dir",
    );

    const prepared = await prepareImage(join(linkedDirectory, "shot.png"));

    expect(prepared.path).toBe(await realpath(imagePath));
  });

  it("rejects a corrupt image", async () => {
    const directory = await temporaryDirectory();
    const imagePath = join(directory, "broken.png");
    await writeFile(imagePath, "not an image");
    await expect(prepareImage(imagePath)).rejects.toBeInstanceOf(AppError);
  });

  it("validates the resize bound", async () => {
    const directory = await temporaryDirectory();
    const imagePath = join(directory, "small.png");
    await sharp({ create: { width: 10, height: 10, channels: 4, background: "red" } })
      .png()
      .toFile(imagePath);
    await expect(prepareImage(imagePath, { maxLongEdge: 0 })).rejects.toThrow(/64 to 8192/);
  });

  it("normalizes an in-memory message attachment without a temporary file", async () => {
    const input = await sharp({
      create: { width: 20, height: 10, channels: 4, background: "blue" },
    })
      .webp()
      .toBuffer();
    const prepared = await prepareImageBuffer(input, "desktop-upload.webp");
    expect(prepared).toMatchObject({
      path: "desktop-upload.webp",
      width: 20,
      height: 10,
      mime: "image/png",
    });
  });

  it.each(["C:\\private\\desktop-upload.webp", "/private/desktop-upload.webp"])(
    "removes either platform's directory syntax from attachment names",
    async (filename) => {
      const input = await sharp({
        create: { width: 10, height: 10, channels: 3, background: "blue" },
      })
        .webp()
        .toBuffer();

      const prepared = await prepareImageBuffer(input, filename);

      expect(prepared.path).toBe("desktop-upload.webp");
    },
  );

  it("rejects a file larger than the encoded-size limit before decoding", async () => {
    const directory = await temporaryDirectory();
    const imagePath = join(directory, "oversized.png");
    await writeFile(imagePath, "");
    await truncate(imagePath, MAX_INPUT_BYTES + 1);

    await expect(prepareImage(imagePath)).rejects.toThrow(/too large/);
  });

  it("rejects decoded dimensions above the pixel limit", async () => {
    const png = await sharp({
      create: { width: 1, height: 1, channels: 3, background: "white" },
    })
      .png()
      .toBuffer();
    const dimension = Math.floor(Math.sqrt(MAX_IMAGE_PIXELS)) + 1;
    png.writeUInt32BE(dimension, 16);
    png.writeUInt32BE(dimension, 20);
    png.writeUInt32BE(crc32(png.subarray(12, 29)), 29);

    await expect(prepareImageBuffer(png, "pixel-bomb.png")).rejects.toThrow(/Cannot decode image/);
  });

  it("rejects animated images in an otherwise supported format", async () => {
    const raw = Buffer.alloc(10 * 20 * 4, 255);
    for (let offset = 0; offset < 10 * 10 * 4; offset += 4) {
      raw[offset + 1] = 0;
      raw[offset + 2] = 0;
    }
    const multipageTiff = await sharp(raw, {
      raw: { width: 10, height: 20, channels: 4, pageHeight: 10 },
    })
      .tiff()
      .toBuffer();
    const animatedWebp = await sharp(multipageTiff, { pages: -1 })
      .webp({ loop: 0, delay: [100, 100] })
      .toBuffer();

    await expect(prepareImageBuffer(animatedWebp, "animated.webp")).rejects.toThrow(
      /Animated or multi-page/,
    );
  });

  it("applies EXIF orientation before reporting and resizing dimensions", async () => {
    const jpeg = await sharp({
      create: { width: 20, height: 10, channels: 3, background: "white" },
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();

    const prepared = await prepareImageBuffer(jpeg, "rotated.jpg");

    expect(prepared).toMatchObject({
      originalWidth: 10,
      originalHeight: 20,
      width: 10,
      height: 20,
    });
  });

  it("uses JPEG for a large opaque normalized image", async () => {
    const input = await sharp({
      create: { width: 1500, height: 1000, channels: 3, background: "white" },
    })
      .png()
      .toBuffer();

    const prepared = await prepareImageBuffer(input, "large.png", {
      maxLongEdge: 2000,
    });

    expect(prepared.mime).toBe("image/jpeg");
  });

  it("preserves dimensions when resizing is disabled", async () => {
    const input = await sharp({
      create: { width: 2000, height: 1000, channels: 3, background: "white" },
    })
      .png()
      .toBuffer();

    const prepared = await prepareImageBuffer(input, "original.png", {
      maxLongEdge: 64,
      resize: false,
    });

    expect(prepared.width).toBe(2000);
    expect(prepared.height).toBe(1000);
  });

  it("rejects formats outside PNG, JPEG, and WebP", async () => {
    const gif = await sharp({
      create: { width: 10, height: 10, channels: 3, background: "white" },
    })
      .gif()
      .toBuffer();

    await expect(prepareImageBuffer(gif, "unsupported.gif")).rejects.toThrow(
      /Unsupported image format 'gif'/,
    );
  });
});
