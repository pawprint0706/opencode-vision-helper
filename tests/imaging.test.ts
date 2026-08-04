import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";

import { AppError } from "../src/errors.js";
import { imageDataUrl, prepareImage } from "../src/imaging.js";

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "opencode-vision-helper-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});
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
});
