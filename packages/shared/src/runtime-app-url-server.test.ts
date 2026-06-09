import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const storedSettings = vi.hoisted(() => new Map<string, string | undefined>());

vi.mock("./system-settings", () => ({
  getSystemSettingString: vi.fn(async (key: string) => storedSettings.get(key)),
}));

const ENV_KEYS = [
  "APP_URL",
  "BETTER_AUTH_URL",
  "NEXT_PUBLIC_APP_URL",
  "VERCEL_URL",
] as const;

const previousEnv = new Map<string, string | undefined>();

beforeEach(() => {
  storedSettings.clear();
  previousEnv.clear();
  for (const key of ENV_KEYS) {
    previousEnv.set(key, process.env[key]);
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = previousEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("getRuntimePublicAppUrl", () => {
  it("lets env APP_URL override stale stored auth/build URLs", async () => {
    storedSettings.set("BETTER_AUTH_URL", "http://localhost:3000");
    storedSettings.set("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
    process.env.APP_URL = "https://image.example.test/";

    const { getRuntimePublicAppUrl } = await import("./runtime-app-url-server");

    await expect(getRuntimePublicAppUrl()).resolves.toBe(
      "https://image.example.test"
    );
  });

  it("still lets stored APP_URL win when explicitly configured", async () => {
    storedSettings.set("APP_URL", "https://stored.example.test/");
    process.env.APP_URL = "https://env.example.test";

    const { getRuntimePublicAppUrl } = await import("./runtime-app-url-server");

    await expect(getRuntimePublicAppUrl()).resolves.toBe(
      "https://stored.example.test"
    );
  });
});
