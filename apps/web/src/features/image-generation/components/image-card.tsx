"use client";

import { buildStorageThumbnailUrl } from "@repo/shared/storage/signed-url";
import { formatDateInTimeZone } from "@repo/shared/time-zone";
import { Badge } from "@repo/ui/components/badge";
import { Card } from "@repo/ui/components/card";
import { Clock, ImageIcon } from "lucide-react";
import Image from "next/image";
import { useLocale } from "next-intl";

export interface ImageCardProps {
  id: string;
  prompt: string;
  imageUrl: string | null;
  thumbnailUrl?: string | null;
  model: string;
  size: string;
  creditsConsumed: number;
  createdAt: string;
  status: "pending" | "completed" | "failed";
  badge?: string;
  timeZone?: string;
  onClick?: () => void;
}

function formatCreatedDate(
  iso: string,
  locale: string,
  timeZone?: string
): string {
  try {
    return formatDateInTimeZone(
      iso,
      locale,
      {
        month: "short",
        day: "2-digit",
        year: "numeric",
      },
      timeZone
    );
  } catch {
    return iso;
  }
}

export function ImageCard({
  prompt,
  imageUrl,
  thumbnailUrl: sourceThumbnailUrl,
  model,
  status,
  createdAt,
  badge,
  timeZone,
  onClick,
}: ImageCardProps) {
  const locale = useLocale();
  const clickable = Boolean(onClick);
  // 列表缩略图:优先使用服务端给出的同源存储 URL(/api/storage),再请求按需缩放后
  // 的小图(w=640)。这样原图可继续走 RustFS/S3 直连,列表不会下载完整原图。
  // 宽度走"路径段"(而非 ?w= 查询参数),以绕过 Cloudflare 忽略 query 的边缘缓存键。
  const thumbnailUrl =
    buildStorageThumbnailUrl(sourceThumbnailUrl || imageUrl, 640) ||
    sourceThumbnailUrl ||
    imageUrl;

  return (
    <Card
      onClick={onClick}
      className={`group overflow-hidden rounded-lg border border-border bg-background shadow-none transition-all duration-200 ${
        clickable ? "cursor-pointer hover:-translate-y-0.5 hover:shadow-md" : ""
      }`}
    >
      <div className="relative aspect-square w-full overflow-hidden bg-muted">
        {thumbnailUrl && status === "completed" ? (
          <Image
            src={thumbnailUrl}
            alt={prompt}
            fill
            sizes="(max-width: 768px) 50vw, (max-width: 1024px) 33vw, 25vw"
            className="object-contain transition-transform duration-300 group-hover:scale-[1.02]"
            unoptimized
            // 低优先级:与导航 RSC 共用同一条 HTTP/2 连接时,让浏览器优先把带宽给
            // 用户点击触发的导航请求,避免一屏缩略图把切页/切 Tab 拖住。
            fetchPriority="low"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground">
            <ImageIcon className="h-10 w-10" strokeWidth={1.2} />
          </div>
        )}
        {badge && (
          <div className="absolute left-2 top-2">
            <Badge className="rounded-full bg-background/90 px-2 py-0.5 text-[10px] font-medium text-foreground shadow-sm">
              {badge}
            </Badge>
          </div>
        )}
      </div>
      <div className="space-y-2 p-3">
        <p className="line-clamp-2 text-sm leading-snug text-foreground">
          {prompt}
        </p>
        <div className="flex items-center justify-between gap-2">
          <Badge
            variant="outline"
            className="rounded-full border-border font-normal text-[10px] uppercase tracking-wide"
          >
            {model}
          </Badge>
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <Clock className="h-3 w-3" />
            {formatCreatedDate(createdAt, locale, timeZone)}
          </span>
        </div>
      </div>
    </Card>
  );
}
