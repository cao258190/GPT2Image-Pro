import { logWarn } from "@repo/shared/logger";
import { getStorageProvider } from "@repo/shared/storage/providers";
import { buildSignedStorageImageUrl } from "@repo/shared/storage/signed-url";
import { getRuntimeSettingString } from "@repo/shared/system-settings";

async function resolveStoredImageBucket(storageBucket?: string | null) {
  return (
    storageBucket?.trim() ||
    (await getRuntimeSettingString("NEXT_PUBLIC_GENERATIONS_BUCKET_NAME")) ||
    "generations"
  );
}

/**
 * Build a readable image URL for a stored object, preferring provider-level
 * signed URLs so S3/RustFS images can be fetched directly.
 */
export async function buildStoredImageReadUrl(
  storageKey: string | null | undefined,
  storageBucket?: string | null,
  expiresInSeconds = 3600
) {
  const key = storageKey?.trim();
  if (!key) return null;
  const bucket = await resolveStoredImageBucket(storageBucket);

  try {
    const storage = await getStorageProvider();
    return await storage.getSignedUrl(key, bucket, expiresInSeconds);
  } catch (error) {
    logWarn("存储直连签名 URL 生成失败，回退到站内存储 URL", {
      bucket,
      storageKey: key,
      error: error instanceof Error ? error.message : String(error),
    });
    return buildSignedStorageImageUrl(key, bucket, expiresInSeconds);
  }
}

/**
 * Build a first-party storage URL for a stored object so list views can request
 * in-app resized thumbnails even when the full image uses RustFS/S3 direct URLs.
 */
export async function buildStoredImageProxyUrl(
  storageKey: string | null | undefined,
  storageBucket?: string | null,
  expiresInSeconds = 3600
) {
  const key = storageKey?.trim();
  if (!key) return null;
  const bucket = await resolveStoredImageBucket(storageBucket);
  return buildSignedStorageImageUrl(key, bucket, expiresInSeconds);
}

/**
 * Re-sign stored image references while preserving their metadata shape.
 */
export async function resolveStoredImageReadUrls<
  T extends {
    imageUrl: string;
    storageBucket?: string | null;
    storageKey?: string | null;
  },
>(images: T[]): Promise<T[]> {
  return Promise.all(
    images.map(async (image) => {
      const imageUrl =
        (await buildStoredImageReadUrl(
          image.storageKey,
          image.storageBucket
        )) || image.imageUrl;
      return { ...image, imageUrl };
    })
  );
}
