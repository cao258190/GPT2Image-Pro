function normalizeBaseUrl(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed.replace(/\/+$/, "") : undefined;
}

/**
 * Resolve the public application URL from process environment variables.
 *
 * `APP_URL` is intentionally preferred over `NEXT_PUBLIC_APP_URL`: it is a
 * server/runtime setting and is not inlined by Next.js during image builds.
 */
export function getPublicAppUrlFromEnv(fallback = "http://localhost:3000") {
  return (
    normalizeBaseUrl(process.env.APP_URL) ||
    normalizeBaseUrl(process.env.BETTER_AUTH_URL) ||
    normalizeBaseUrl(process.env.NEXT_PUBLIC_APP_URL) ||
    normalizeBaseUrl(
      process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined
    ) ||
    fallback
  );
}
