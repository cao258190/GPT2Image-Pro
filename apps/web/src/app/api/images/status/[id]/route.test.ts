import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/features/image-generation/storage-url", () => ({
  buildStoredImageReadUrl: vi.fn(
    async (key: string | null, bucket: string | null) =>
      key
        ? `https://rustfs.example.test/${bucket || "generations"}/${key}?X-Amz-Signature=${"a".repeat(
            64
          )}`
        : null
  ),
}));

import { getImageOutputs } from "../status-output";

const TEST_SECRET = "test-secret-for-image-status-tests";

describe("image status output URLs", () => {
  const originalSecret = process.env.BETTER_AUTH_SECRET;

  beforeEach(() => {
    process.env.BETTER_AUTH_SECRET = TEST_SECRET;
  });

  afterAll(() => {
    if (originalSecret === undefined) {
      delete process.env.BETTER_AUTH_SECRET;
    } else {
      process.env.BETTER_AUTH_SECRET = originalSecret;
    }
  });

  it("re-signs stored output images instead of returning stale metadata URLs", async () => {
    const outputs = await getImageOutputs(
      {
        outputImage: {
          imageOutputs: [
            {
              generationId: "gen_1",
              imageUrl: "/api/storage/generations/user/out.png",
              storageKey: "user/out.png",
              role: "final",
            },
          ],
        },
      },
      "generations"
    );

    expect(outputs).toHaveLength(1);
    const url = new URL(outputs[0]!.imageUrl!, "https://example.com");
    expect(url.origin).toBe("https://rustfs.example.test");
    expect(url.pathname).toBe("/generations/user/out.png");
    expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[a-f0-9]{64}$/);
  });
});
