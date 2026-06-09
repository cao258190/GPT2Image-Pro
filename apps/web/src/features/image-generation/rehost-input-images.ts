/**
 * 输入图 re-host（转存）到我方对象存储。
 *
 * 职责：在确定走 api 后端（pool-api）后、构造 chat/responses 请求之前，确保每张
 * 输入图都是"我方可控的 URL"，避免把第三方外链交给上游——上游下载外链会被图床
 * 限流返回 "failed download file 429" 导致整单失败。
 *
 * 使用方：service.ts 的 generateImage / editImage / generateChatImage 在 pool-api
 * 分支执行前调用（见 rehostApiBackendInputImages）。
 * 关键依赖：
 * - @repo/shared/storage/providers getStorageProvider().putObject
 * - @repo/shared/storage/signed-url parseStorageImageUrl / buildSignedStorageImageUrl
 * - @repo/shared/system-settings getRuntimeSettingString（取存储桶/启用判定）
 * - external-api/safe-image-fetch fetchPublicImage（带 SSRF 防护 + 429/5xx 重试）
 *
 * 失败语义：任何失败都不抛出、不中断主流程，仅 logWarn 记录——有字节则保留字节
 * （交给 getInputImageUrl 走 base64），无字节则保留原 url（best-effort）。
 */
import { logWarn } from "@repo/shared/logger";
import { getStorageProvider } from "@repo/shared/storage/providers";
import {
  buildSignedStorageImageUrl,
  parseStorageImageUrl,
} from "@repo/shared/storage/signed-url";
import { getRuntimeSettingString } from "@repo/shared/system-settings";
import {
  fetchPublicImage,
  readResponseBytesWithLimit,
} from "../external-api/safe-image-fetch";
import {
  DEFAULT_MAX_IMAGE_BYTES,
  getImagePublicBaseUrl,
} from "./request-utils";
import type { ImageInputFile } from "./types";

const OPENAI_INPUT_IMAGE_URL_EXPIRES_SECONDS = 60 * 60;

function toAbsoluteStorageUrl(url: string | null | undefined, baseUrl?: string) {
  if (!url) return null;
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  if (!baseUrl) return url;
  try {
    return new URL(url, baseUrl).toString();
  } catch {
    return url;
  }
}

function buildInAppFallbackUrl(
  key: string,
  bucket: string,
  publicBaseUrl?: string
) {
  try {
    return toAbsoluteStorageUrl(
      buildSignedStorageImageUrl(
        key,
        bucket,
        OPENAI_INPUT_IMAGE_URL_EXPIRES_SECONDS
      ),
      publicBaseUrl
    );
  } catch {
    return null;
  }
}

/**
 * 根据 MIME 类型推断对象存储文件扩展名（与 request-utils 保持一致）。
 */
function extensionForType(type: string): string {
  if (type === "image/jpeg") return "jpg";
  if (type === "image/webp") return "webp";
  return "png";
}

/**
 * 把外链字节流读入 Buffer，受 DEFAULT_MAX_IMAGE_BYTES 上限保护。
 *
 * @returns 读取到的字节与最终 MIME 类型；下载失败或非图片时抛出由调用方兜底。
 */
async function downloadImageBytes(
  url: string,
  signal?: AbortSignal
): Promise<{ data: Buffer; type: string }> {
  const response = await fetchPublicImage(url, { signal });
  if (!response.ok) {
    throw new Error(
      `Input image download failed with status ${response.status}`
    );
  }
  const type = response.headers.get("content-type") || "image/png";
  const data = await readResponseBytesWithLimit(
    response,
    DEFAULT_MAX_IMAGE_BYTES,
    () => {
      throw new Error("Input image exceeds the maximum allowed size.");
    }
  );
  return { data, type };
}

export type RehostContext = {
  /** 请求用户 id，用作对象存储 key 前缀（隔离不同用户）。 */
  userId: string;
  /** 本次生成 id，参与 key 命名以保证唯一。 */
  generationId: string;
  /** key 命名作用域，默认 "rehost"。 */
  scope?: string;
  /** 第几张图，参与 key 命名避免同一生成内冲突。 */
  index?: number;
  /** 透传给下载的 abort 信号。 */
  signal?: AbortSignal;
};

/**
 * 确保单张输入图已 re-host 到我方存储（幂等、不抛出）。
 *
 * 决策：
 * - 已有 storageKey → 直接返回（已是我方对象，无需处理）；
 * - image.url 为第一方站内 URL → 直接返回（已可控）；
 * - 否则需转存：优先用 image.data 字节，无字节则下载 image.url；拿到字节后
 *   putObject 到 generations 桶并回填 storageKey/storageBucket/url（对象存储直连
 *   签名 URL 优先，站内签名 URL 兜底）。
 *
 * @param image 待处理输入图（不修改入参，返回新对象或原对象）。
 * @param ctx re-host 上下文（userId/generationId/scope/index/signal）。
 * @returns 处理后的 ImageInputFile；失败时按"有字节保留字节、无字节保留 url"兜底。
 * @remarks 失败只 logWarn，不抛出，保证主流程不中断。
 */
export async function ensureInputImageRehosted(
  image: ImageInputFile,
  ctx: RehostContext
): Promise<ImageInputFile> {
  // 已是我方存储对象。
  if (image.storageKey?.trim()) {
    const key = image.storageKey.trim();
    const bucket =
      image.storageBucket?.trim() ||
      (await getRuntimeSettingString("NEXT_PUBLIC_GENERATIONS_BUCKET_NAME")) ||
      "generations";
    const publicBaseUrl = await getImagePublicBaseUrl();
    try {
      const storage = await getStorageProvider();
      const url = await storage.getSignedUrl(
        key,
        bucket,
        OPENAI_INPUT_IMAGE_URL_EXPIRES_SECONDS
      );
      return {
        ...image,
        storageBucket: bucket,
        storageKey: key,
        url: toAbsoluteStorageUrl(url, publicBaseUrl) || url,
      };
    } catch (error) {
      logWarn("输入图存储 URL 刷新失败，回退到站内签名 URL", {
        userId: ctx.userId,
        generationId: ctx.generationId,
        index: ctx.index ?? 0,
        storageKey: key,
        error: error instanceof Error ? error.message : String(error),
      });
      const fallbackUrl = buildInAppFallbackUrl(key, bucket, publicBaseUrl);
      return fallbackUrl
        ? { ...image, storageBucket: bucket, storageKey: key, url: fallbackUrl }
        : image;
    }
  }

  const publicBaseUrl = await getImagePublicBaseUrl();
  const trimmedUrl = image.url?.trim();

  // 已是第一方站内 URL 时，解析出对象位置并刷新为对象存储直连 URL。
  const firstPartyStorageRef = parseStorageImageUrl(trimmedUrl, publicBaseUrl);
  if (firstPartyStorageRef) {
    return await ensureInputImageRehosted(
      {
        ...image,
        storageBucket: firstPartyStorageRef.bucket,
        storageKey: firstPartyStorageRef.key,
      },
      ctx
    );
  }

  const index = ctx.index ?? 0;
  const scope = ctx.scope || "rehost";

  try {
    let bytes = image.data?.length ? image.data : null;
    let contentType = image.type || "image/png";

    if (!bytes) {
      if (!trimmedUrl) {
        // 既无字节也无 url，无从转存，保持原样。
        return image;
      }
      const downloaded = await downloadImageBytes(trimmedUrl, ctx.signal);
      bytes = downloaded.data;
      contentType = downloaded.type;
    }

    const storage = await getStorageProvider();
    const bucket =
      (await getRuntimeSettingString("NEXT_PUBLIC_GENERATIONS_BUCKET_NAME")) ||
      "generations";
    const extension = extensionForType(contentType);
    const key = `${ctx.userId}/${scope}/${ctx.generationId}-${index}.${extension}`;

    await storage.putObject(key, bucket, bytes, contentType);
    const url = await storage
      .getSignedUrl(key, bucket, OPENAI_INPUT_IMAGE_URL_EXPIRES_SECONDS)
      .then(
        (signedUrl) => toAbsoluteStorageUrl(signedUrl, publicBaseUrl) || signedUrl
      )
      .catch((error) => {
        logWarn("输入图 re-host 直连签名 URL 生成失败，回退到站内签名 URL", {
          userId: ctx.userId,
          generationId: ctx.generationId,
          index,
          error: error instanceof Error ? error.message : String(error),
        });
        return buildInAppFallbackUrl(key, bucket, publicBaseUrl) || image.url;
      });

    return {
      ...image,
      data: bytes,
      type: contentType,
      storageBucket: bucket,
      storageKey: key,
      url,
    };
  } catch (error) {
    logWarn("输入图 re-host 失败，回退到字节/原 URL", {
      userId: ctx.userId,
      generationId: ctx.generationId,
      index,
      hasBytes: Boolean(image.data?.length),
      error: error instanceof Error ? error.message : String(error),
    });
    return image;
  }
}
