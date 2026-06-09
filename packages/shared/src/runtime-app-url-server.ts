import { getPublicAppUrlFromEnv } from "./runtime-app-url";
import { getSystemSettingString } from "./system-settings";

function normalizeBaseUrl(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed.replace(/\/+$/, "") : undefined;
}

/**
 * Resolve the public application URL from database-backed runtime settings
 * and process environment variables.
 *
 * `APP_URL` is the server/runtime override for container deployments, so the
 * process value must win over stale database values such as localhost
 * BETTER_AUTH_URL/NEXT_PUBLIC_APP_URL imported from an older image.
 */
export async function getRuntimePublicAppUrl(
  fallback = "http://localhost:3000"
) {
  const [storedAppUrl, storedBetterAuthUrl, storedNextPublicAppUrl] =
    await Promise.all([
      getSystemSettingString("APP_URL"),
      getSystemSettingString("BETTER_AUTH_URL"),
      getSystemSettingString("NEXT_PUBLIC_APP_URL"),
    ]);

  return (
    normalizeBaseUrl(storedAppUrl) ||
    normalizeBaseUrl(process.env.APP_URL) ||
    normalizeBaseUrl(storedBetterAuthUrl) ||
    normalizeBaseUrl(process.env.BETTER_AUTH_URL) ||
    normalizeBaseUrl(storedNextPublicAppUrl) ||
    normalizeBaseUrl(process.env.NEXT_PUBLIC_APP_URL) ||
    getPublicAppUrlFromEnv(fallback)
  );
}
