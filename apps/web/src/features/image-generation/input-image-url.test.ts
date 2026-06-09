import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ImageInputFile } from "./types";

const APP_URL = "https://app.example.test";

let previousRuntimeAppUrl: string | undefined;
let previousAppUrl: string | undefined;
let previousAuthUrl: string | undefined;
let previousSecret: string | undefined;

beforeEach(() => {
  previousRuntimeAppUrl = process.env.APP_URL;
  previousAppUrl = process.env.NEXT_PUBLIC_APP_URL;
  previousAuthUrl = process.env.BETTER_AUTH_URL;
  previousSecret = process.env.BETTER_AUTH_SECRET;
  delete process.env.APP_URL;
  process.env.NEXT_PUBLIC_APP_URL = APP_URL;
  process.env.BETTER_AUTH_SECRET = "test-secret";
});

afterEach(() => {
  if (previousRuntimeAppUrl === undefined) delete process.env.APP_URL;
  else process.env.APP_URL = previousRuntimeAppUrl;
  if (previousAppUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
  else process.env.NEXT_PUBLIC_APP_URL = previousAppUrl;
  if (previousAuthUrl === undefined) delete process.env.BETTER_AUTH_URL;
  else process.env.BETTER_AUTH_URL = previousAuthUrl;
  if (previousSecret === undefined) delete process.env.BETTER_AUTH_SECRET;
  else process.env.BETTER_AUTH_SECRET = previousSecret;
});

function makeImage(overrides: Partial<ImageInputFile>): ImageInputFile {
  return {
    data: Buffer.alloc(0),
    name: "image.png",
    type: "image/png",
    ...overrides,
  };
}

describe("getInputImageUrl", () => {
  it("uses an in-app signed storage URL when storageKey is present", async () => {
    const { getInputImageUrl } = await import("./input-image-url");
    const url = getInputImageUrl(
      makeImage({
        storageKey: "user-1/abc.png",
        storageBucket: "generations",
        data: Buffer.from([1, 2, 3]),
      })
    );
    expect(url).toContain(`${APP_URL}/api/storage/generations/user-1/abc.png`);
    expect(url).toContain("sig=");
  });

  it("prefers APP_URL over build-time NEXT_PUBLIC_APP_URL", async () => {
    process.env.APP_URL = "https://runtime.example.test";
    process.env.NEXT_PUBLIC_APP_URL = "https://build.example.test";
    const { getInputImageUrl } = await import("./input-image-url");
    const url = getInputImageUrl(
      makeImage({
        storageKey: "user-1/abc.png",
        storageBucket: "generations",
        data: Buffer.from([1, 2, 3]),
      })
    );

    expect(url).toContain(
      "https://runtime.example.test/api/storage/generations/user-1/abc.png"
    );
  });

  it("passes through a first-party storage url", async () => {
    const { getInputImageUrl } = await import("./input-image-url");
    const firstParty = `${APP_URL}/api/storage/generations/user-1/abc.png?sig=x&exp=1`;
    const url = getInputImageUrl(
      makeImage({ url: firstParty, data: Buffer.from([1, 2, 3]) })
    );
    expect(url).toBe(firstParty);
  });

  it("keeps an already signed in-app storage URL when storageKey is present", async () => {
    process.env.APP_URL = "https://runtime.example.test";
    process.env.NEXT_PUBLIC_APP_URL = "https://build.example.test";
    const { getInputImageUrl } = await import("./input-image-url");
    const signedUrl =
      "https://image.example.test/api/storage/generations/user-1/abc.png?sig=x&exp=1";
    const url = getInputImageUrl(
      makeImage({
        url: signedUrl,
        storageKey: "user-1/abc.png",
        storageBucket: "generations",
        data: Buffer.from([1, 2, 3]),
      })
    );
    expect(url).toBe(signedUrl);
  });

  it("prefers an object storage presigned url over the in-app storage route", async () => {
    const { getInputImageUrl } = await import("./input-image-url");
    const presigned =
      "https://rustfs.example.test/generations/user-1/abc.png?X-Amz-Signature=abc";
    const url = getInputImageUrl(
      makeImage({
        url: presigned,
        storageKey: "user-1/abc.png",
        storageBucket: "generations",
        data: Buffer.from([1, 2, 3]),
      })
    );
    expect(url).toBe(presigned);
  });

  it("returns base64 for an external url when bytes are available", async () => {
    const { getInputImageUrl } = await import("./input-image-url");
    const url = getInputImageUrl(
      makeImage({
        url: "https://cdn.thirdparty.example/photo.png",
        data: Buffer.from([1, 2, 3]),
        type: "image/png",
      })
    );
    expect(url).toBe(
      `data:image/png;base64,${Buffer.from([1, 2, 3]).toString("base64")}`
    );
  });

  it("falls back to passing the external url through when there are no bytes", async () => {
    const { getInputImageUrl } = await import("./input-image-url");
    const external = "https://cdn.thirdparty.example/history.png";
    const url = getInputImageUrl(makeImage({ url: external }));
    expect(url).toBe(external);
  });

  it("returns a data: url unchanged", async () => {
    const { getInputImageUrl } = await import("./input-image-url");
    const dataUrl = "data:image/png;base64,AAAA";
    const url = getInputImageUrl(makeImage({ url: dataUrl }));
    expect(url).toBe(dataUrl);
  });
});
