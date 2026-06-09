/**
 * 存储 URL 签名工具
 *
 * 为 generations 桶的图像 URL 提供短时签名机制，防止未授权访问。
 * 使用 HMAC-SHA256 签名，签名密钥为 BETTER_AUTH_SECRET 环境变量。
 *
 * 签名覆盖内容：bucket + "/" + key + ":" + expiresAt（unix epoch 秒）
 * 验证使用 crypto.timingSafeEqual 防止时序攻击。
 *
 * 纯函数，不依赖数据库。供 API 路由与 URL 构建层使用。
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export type StorageImageReference = {
  bucket: string;
  key: string;
};

/**
 * 不需要签名的公开桶名集合。
 * 头像桶始终公开（OAuth 头像等场景无 cookie/token 可用）。
 */
const PUBLIC_BUCKETS = new Set([
  process.env.NEXT_PUBLIC_AVATARS_BUCKET_NAME || "avatars",
]);

/**
 * 判断桶是否为公开桶（不需要签名验证）
 */
export function isPublicBucket(bucket: string): boolean {
  return PUBLIC_BUCKETS.has(bucket);
}

/**
 * 获取签名密钥。
 * 使用 BETTER_AUTH_SECRET，与 auth 系统共享密钥以避免引入新环境变量。
 */
function getSigningSecret(): string {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) {
    throw new Error(
      "BETTER_AUTH_SECRET is required for storage URL signing"
    );
  }
  return secret;
}

/**
 * 构建签名消息（被签名的原始文本）。
 * 格式：bucket/key:expiresAt
 */
function buildSignatureMessage(
  bucket: string,
  key: string,
  expiresAt: number
): string {
  return `${bucket}/${key}:${expiresAt}`;
}

/**
 * 计算 HMAC-SHA256 签名，返回 hex 字符串。
 */
function computeHmac(message: string, secret: string): string {
  return createHmac("sha256", secret).update(message).digest("hex");
}

/**
 * 生成带签名的图像 URL 查询参数。
 *
 * @param bucket - 存储桶名
 * @param key - 文件键名
 * @param expiresInSeconds - 签名有效期（秒），默认 3600（1 小时）
 * @returns 包含 sig 和 exp 的对象，用于拼接 URL 查询参数
 *
 * @example
 * ```ts
 * const { sig, exp } = generateSignedImageParams("generations", "user-1/abc.png");
 * const url = `/api/storage/generations/user-1/abc.png?sig=${sig}&exp=${exp}`;
 * ```
 */
export function generateSignedImageParams(
  bucket: string,
  key: string,
  expiresInSeconds = 3600
): { sig: string; exp: number } {
  const secret = getSigningSecret();
  const expiresAt = Math.floor(Date.now() / 1000) + expiresInSeconds;
  const message = buildSignatureMessage(bucket, key, expiresAt);
  const sig = computeHmac(message, secret);
  return { sig, exp: expiresAt };
}

/**
 * 生成带签名的完整相对 URL。
 *
 * @param bucket - 存储桶名
 * @param key - 文件键名
 * @param expiresInSeconds - 签名有效期（秒），默认 3600
 * @returns 带 sig 和 exp 查询参数的相对 URL
 */
export function generateSignedImageUrl(
  bucket: string,
  key: string,
  expiresInSeconds = 3600
): string {
  if (isPublicBucket(bucket)) {
    return `/api/storage/${bucket}/${key}`;
  }
  const { sig, exp } = generateSignedImageParams(
    bucket,
    key,
    expiresInSeconds
  );
  return `/api/storage/${bucket}/${key}?sig=${sig}&exp=${exp}`;
}

/**
 * 把已签名的站内存储图 URL 改写成"按路径段携带宽度"的缩略图 URL。
 *
 * WHY 用路径段而非 `?w=` 查询参数:线上 Cloudflare 对 `/api/storage/*` 的边缘缓存
 * 键忽略 query(含 w),导致所有 `?w=` 缩略图请求都命中并吐回被缓存的整张原图(几百
 * KB~1.5MB),把浏览器↔CF 的单条 HTTP/2 连接带宽占满、饿死同连接上的导航 RSC 请求,
 * 表现为"加载图片时点侧边栏没反应"。把宽度放进 bucket 之后的路径段
 * (`/api/storage/<bucket>/w<width>/<key>`)后:CF 按路径区分各宽度、且是全新路径形态,
 * 不会命中旧的原图缓存键 → 边缘真正缓存源站返回的小 webp。
 *
 * 签名仅覆盖 `bucket/key`,宽度段不参与签名(由读取路由在验签前剥离),故 sig/exp 不变。
 * 仅改写本站 `/api/storage/` 相对 URL;其它(第三方/绝对/空)原样返回。
 *
 * @param signedUrl - generateSignedImageUrl 产出的 `/api/storage/<bucket>/<key>?sig=&exp=`
 * @param width - 目标宽度像素(正整数);非法或非本站 URL 时原样返回入参
 */
export function buildStorageThumbnailUrl(
  signedUrl: string | null | undefined,
  width: number
): string | null | undefined {
  if (!signedUrl || !signedUrl.startsWith("/api/storage/")) {
    return signedUrl;
  }
  if (!Number.isInteger(width) || width <= 0) {
    return signedUrl;
  }
  const prefix = "/api/storage/";
  const qIndex = signedUrl.indexOf("?");
  const pathname = qIndex === -1 ? signedUrl : signedUrl.slice(0, qIndex);
  const query = qIndex === -1 ? "" : signedUrl.slice(qIndex);
  const rest = pathname.slice(prefix.length); // <bucket>/<...key>
  const slash = rest.indexOf("/");
  // 必须同时有 bucket 段与至少一个 key 段,否则不是可改写的图片 URL。
  if (slash <= 0 || slash >= rest.length - 1) {
    return signedUrl;
  }
  const bucket = rest.slice(0, slash);
  const keyPath = rest.slice(slash + 1);
  return `${prefix}${bucket}/w${width}/${keyPath}${query}`;
}

/**
 * 从数据库存储键名构造站内图像读取 URL。
 *
 * 业务层从 storageKey/storageBucket 还原图片 URL 时统一走这里：
 * - generations 等非公开桶自动追加 sig/exp，供浏览器、外接 API 客户端、
 *   OAI/第三方上游等无 cookie 场景读取；
 * - avatars 等公开桶保持普通公开路径；
 * - 空 key 返回 null，调用方可继续回退到旧 imageUrl。
 */
export function buildSignedStorageImageUrl(
  storageKey: string | null | undefined,
  storageBucket?: string | null,
  expiresInSeconds = 3600
): string | null {
  const key = storageKey?.trim();
  if (!key) return null;
  const bucket =
    storageBucket?.trim() ||
    process.env.NEXT_PUBLIC_GENERATIONS_BUCKET_NAME?.trim() ||
    "generations";
  return generateSignedImageUrl(bucket, key, expiresInSeconds);
}

/**
 * 解析本站 /api/storage/<bucket>/<key> 图片 URL。
 *
 * 只接受相对 URL，或与 publicBaseUrl 同源的绝对 URL；第三方对象存储/预签名
 * URL 不会被误判。返回的 key 已解码并做基础路径安全校验。
 */
export function parseStorageImageUrl(
  imageUrl: string | null | undefined,
  publicBaseUrl?: string | null
): StorageImageReference | null {
  const raw = imageUrl?.trim();
  if (!raw) return null;

  try {
    const base = publicBaseUrl?.trim() || "http://localhost";
    const parsed = new URL(raw, base);
    const isRelativeStorageUrl = raw.startsWith("/api/storage/");
    const isOwnStorageUrl =
      Boolean(publicBaseUrl?.trim()) &&
      parsed.origin === new URL(base).origin &&
      parsed.pathname.startsWith("/api/storage/");

    if (!(isRelativeStorageUrl || isOwnStorageUrl)) return null;

    const segments = parsed.pathname.split("/").filter(Boolean);
    const storageIndex = segments.indexOf("storage");
    const bucket = segments[storageIndex + 1];
    let keySegments = segments.slice(storageIndex + 2);
    if (storageIndex < 0 || !bucket || keySegments.length === 0) return null;
    if (
      keySegments.length > 1 &&
      /^w\d+$/.test(keySegments[0] || "")
    ) {
      keySegments = keySegments.slice(1);
    }

    const key = keySegments
      .map((segment) => decodeURIComponent(segment))
      .join("/");
    if (
      !key ||
      key.startsWith("/") ||
      key.includes("\\") ||
      key.includes("\0") ||
      key.split("/").some((segment) => segment === "." || segment === "..")
    ) {
      return null;
    }

    return {
      bucket: decodeURIComponent(bucket),
      key,
    };
  } catch {
    return null;
  }
}

function isOwnStorageImageUrl(raw: string, publicBaseUrl?: string | null) {
  try {
    const base = publicBaseUrl?.trim() || "http://localhost";
    const parsed = new URL(raw, base);
    return (
      raw.startsWith("/api/storage/") ||
      (Boolean(publicBaseUrl?.trim()) &&
        parsed.origin === new URL(base).origin &&
        parsed.pathname.startsWith("/api/storage/"))
    );
  } catch {
    return false;
  }
}

/**
 * 将图片 URL 规范化为对外可访问 URL。
 *
 * - 本站 /api/storage/... URL 会统一重签，避免旧裸 URL 被 OAI/外部客户端下载
 *   时返回 Missing signature；
 * - 第三方 http(s) URL 保持原样；
 * - 其他相对 URL 在提供 publicBaseUrl 时转绝对 URL。
 */
export function buildPublicImageUrl(
  imageUrl: string | null | undefined,
  publicBaseUrl?: string | null,
  expiresInSeconds = 3600
): string | undefined {
  const raw = imageUrl?.trim();
  if (!raw) return undefined;

  const storageReference = parseStorageImageUrl(raw, publicBaseUrl);
  if (storageReference) {
    const signedUrl =
      buildSignedStorageImageUrl(
        storageReference.key,
        storageReference.bucket,
        expiresInSeconds
      ) || raw;
    return publicBaseUrl?.trim()
      ? new URL(signedUrl, publicBaseUrl).toString()
      : signedUrl;
  }
  if (isOwnStorageImageUrl(raw, publicBaseUrl)) return undefined;

  if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
  if (!publicBaseUrl?.trim()) return raw;
  return new URL(raw, publicBaseUrl).toString();
}

/**
 * 验证签名 URL 的有效性。
 *
 * 使用 timingSafeEqual 进行常量时间比较，防止时序攻击。
 *
 * @param bucket - 存储桶名
 * @param key - 文件键名
 * @param signature - 请求中携带的签名（hex 字符串）
 * @param expiresAt - 签名到期时间（unix epoch 秒）
 * @returns 验证结果：valid 表示通过，expired 表示已过期，invalid 表示签名不匹配
 */
export function verifySignedImageUrl(
  bucket: string,
  key: string,
  signature: string,
  expiresAt: number
): "valid" | "expired" | "invalid" {
  // 先检查过期——过期检查不泄露签名信息，可提前返回。
  const now = Math.floor(Date.now() / 1000);
  if (now > expiresAt) {
    return "expired";
  }

  const secret = getSigningSecret();
  const message = buildSignatureMessage(bucket, key, expiresAt);
  const expected = computeHmac(message, secret);

  // 常量时间比较：两侧必须等长，否则 timingSafeEqual 会抛异常。
  // 将 hex 字符串转为 Buffer 进行安全比较。
  const sigBuffer = Buffer.from(signature, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");

  // 长度不匹配意味着签名格式非法或被篡改。
  // 为避免长度比较本身泄露信息，使用固定长度哈希再比较。
  if (sigBuffer.length !== expectedBuffer.length) {
    return "invalid";
  }

  if (!timingSafeEqual(sigBuffer, expectedBuffer)) {
    return "invalid";
  }

  return "valid";
}
