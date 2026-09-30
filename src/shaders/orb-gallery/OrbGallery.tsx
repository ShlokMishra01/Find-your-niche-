import { useEffect, useRef, useState, type CSSProperties } from "react";

import orbGallerySource from "./sources/orb-gallery.html?raw";

// The registered document is preserved verbatim; these host overrides expose
// only its authored interactive canvas when it is used as the product hero.
const immersiveSource = orbGallerySource.replace(
  "</head>",
  `<style>
    html,body{width:100%;height:100%;min-height:100%;overflow:hidden!important;background:#0b0d0e!important}
    body{display:block!important;position:relative!important}
    .stage{position:absolute!important;inset:0!important;width:100%!important;height:100%!important;min-height:100%!important;z-index:0!important}
    #orb{transform:scale(1.24);transform-origin:50% 50%;}
    .nav,.band,.hint{display:none!important}
    @media(max-width:900px){#orb{transform:scale(1.08)}}
    @media(prefers-reduced-motion:reduce){#orb{transform:none}}
  </style></head>`,
);

export type OrbGalleryProps = {
  className?: string;
  style?: CSSProperties;
};

export function OrbGallery({ className = "", style }: OrbGalleryProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [documentVisible, setDocumentVisible] = useState(() => (
    typeof document === "undefined" || !document.hidden
  ));
  const [hostVisible, setHostVisible] = useState(true);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || typeof IntersectionObserver === "undefined") return undefined;
    const observer = new IntersectionObserver(([entry]) => {
      setHostVisible(entry?.isIntersecting ?? true);
    }, { rootMargin: "80px" });
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const update = () => setDocumentVisible(!document.hidden);
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  const mounted = hostVisible && documentVisible;

  return (
    <div
      ref={hostRef}
      className={`threeui-background orb-gallery${className ? ` ${className}` : ""}`}
      role="group"
      aria-label="Interactive sphere of interface gallery cards"
      data-state={mounted ? "active" : "paused"}
      style={{
        position: "relative",
        overflow: "hidden",
        background: "#1f1f21",
        pointerEvents: "auto",
        ...style,
      }}
    >
      {mounted ? (
        <iframe
          title="Orb Gallery"
          srcDoc={immersiveSource}
          sandbox="allow-scripts"
          loading="eager"
          style={{
            position: "absolute",
            inset: 0,
            display: "block",
            width: "100%",
            height: "100%",
            border: 0,
            background: "#1f1f21",
            // External imagery inside the registered document may keep the
            // iframe load event pending; the canvas must remain visible while
            // those optional resources settle instead of disappearing forever.
            opacity: 1,
            pointerEvents: "auto",
          }}
        />
      ) : null}
    </div>
  );
}
