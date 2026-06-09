import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getPublicAppUrlFromEnv } from "./runtime-app-url";

const ENV_KEYS = [
  "APP_URL",
  "BETTER_AUTH_URL",
  "NEXT_PUBLIC_APP_URL",
  "VERCEL_URL",
] as const;

const previousEnv = new Map<string, string | undefined>();

beforeEach(() => {
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

describe("getPublicAppUrlFromEnv", () => {
  it("prefers APP_URL and strips trailing slashes", () => {
    process.env.APP_URL = "https://runtime.example.test///";
    process.env.BETTER_AUTH_URL = "https://auth.example.test";
    process.env.NEXT_PUBLIC_APP_URL = "https://build.example.test";

    expect(getPublicAppUrlFromEnv()).toBe("https://runtime.example.test");
  });

  it("falls back through auth, build-time, Vercel, and explicit fallback", () => {
    process.env.BETTER_AUTH_URL = "https://auth.example.test/";
    expect(getPublicAppUrlFromEnv()).toBe("https://auth.example.test");

    delete process.env.BETTER_AUTH_URL;
    process.env.NEXT_PUBLIC_APP_URL = "https://build.example.test/";
    expect(getPublicAppUrlFromEnv()).toBe("https://build.example.test");

    delete process.env.NEXT_PUBLIC_APP_URL;
    process.env.VERCEL_URL = "preview.example.test";
    expect(getPublicAppUrlFromEnv()).toBe("https://preview.example.test");

    delete process.env.VERCEL_URL;
    expect(getPublicAppUrlFromEnv("https://fallback.example.test")).toBe(
      "https://fallback.example.test"
    );
  });
});
