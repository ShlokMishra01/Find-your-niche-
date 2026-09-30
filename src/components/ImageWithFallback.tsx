"use client";
import { useEffect, useState } from "react";
import Image from "next/image";

type ImageDomain = "movie" | "tv" | "book" | "music" | "code";
type Props = {
  src?: string | null;
  title: string;
  domain: ImageDomain;
  kind?: string;
  subtitle?: string;
  alt?: string;
  className?: string;
  sizes?: string;
  priority?: boolean;
};

const labels: Record<ImageDomain, string> = { movie: "CINEMA", tv: "SERIES", book: "FIELD NOTES", music: "MUSIC", code: "CODE" };

export function ImageWithFallback({ src, title, domain, kind = "", subtitle, alt, className = "", sizes = "100vw", priority = false }: Props) {
  const [failed, setFailed] = useState(!src);
  useEffect(() => setFailed(!src), [src]);
  const imageAlt = alt ?? `${title} ${domain === "book" ? "book cover" : domain === "music" ? "album or track artwork" : domain === "code" ? "repository preview" : "poster"}`;
  return <div className={`media-art media-art--${domain} ${className}`}>
    {!failed && src ? <Image src={src} alt={imageAlt} fill sizes={sizes} priority={priority} unoptimized onError={() => setFailed(true)} /> : <div className="media-art-fallback" role="img" aria-label={`${imageAlt}. Artwork unavailable.`}>
      <span>{labels[domain]}</span><strong>{title}</strong>{subtitle && <small>{subtitle}</small>}{kind && <i>{kind}</i>}
    </div>}
  </div>;
}
