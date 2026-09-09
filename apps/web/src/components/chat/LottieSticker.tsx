import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

/**
 * Player for a Telegram `.tgs` sticker: gzipped Lottie JSON.
 *
 * Decompression uses the platform's own `DecompressionStream` rather than a
 * bundled inflate, so the only cost this adds is the renderer itself - which
 * is loaded on demand, the first time an animated sticker is actually on
 * screen, and never for a workspace that has none.
 */
export function LottieSticker({
  src,
  className,
}: {
  src: string;
  className?: string;
}) {
  const { t } = useTranslation();
  const container = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let animation: { destroy: () => void } | null = null;

    async function play() {
      try {
        const [response, lottie] = await Promise.all([
          fetch(src),
          import("lottie-web"),
        ]);
        if (!response.ok) throw new Error("sticker fetch failed");
        // A .tgs is always gzipped; a server that already decompressed it
        // would hand us plain JSON, so both shapes are accepted.
        const raw = new Uint8Array(await response.arrayBuffer());
        const isGzip = raw[0] === 0x1f && raw[1] === 0x8b;
        const json = isGzip
          ? await new Response(
              new Blob([raw as BlobPart])
                .stream()
                .pipeThrough(new DecompressionStream("gzip")),
            ).text()
          : new TextDecoder().decode(raw);
        if (cancelled || !container.current) return;
        animation = lottie.default.loadAnimation({
          container: container.current,
          renderer: "svg",
          loop: true,
          autoplay: true,
          animationData: JSON.parse(json),
        });
      } catch {
        if (!cancelled) setFailed(true);
      }
    }

    void play();
    return () => {
      cancelled = true;
      // Lottie keeps a rAF loop per animation; leaving it running would burn
      // a frame budget for every sticker ever scrolled past.
      animation?.destroy();
    };
  }, [src]);

  if (failed) {
    return (
      <div className="flex size-40 items-center justify-center rounded-lg bg-black/10 text-sm text-current/60 dark:bg-white/[0.06]">
        {t("chat.stickerUnavailable", "Sticker unavailable")}
      </div>
    );
  }

  return (
    <div
      ref={container}
      className={className}
      role="img"
      aria-label={t("chat.mediaTypes.sticker", "Sticker")}
    />
  );
}
