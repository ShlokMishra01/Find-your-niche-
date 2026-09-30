import type { NextConfig } from "next";
const nextConfig: NextConfig = { poweredByHeader: false, webpack(config) { config.module.rules.push({ test: /\.html$/i, resourceQuery: /raw/, type: "asset/source" }); return config; }, images: { remotePatterns: [
  { protocol: "https", hostname: "image.tmdb.org" },
  { protocol: "https", hostname: "covers.openlibrary.org" },
  { protocol: "https", hostname: "coverartarchive.org" },
  { protocol: "https", hostname: "is1-ssl.mzstatic.com" },
  { protocol: "https", hostname: "is2-ssl.mzstatic.com" },
  { protocol: "https", hostname: "is3-ssl.mzstatic.com" },
  { protocol: "https", hostname: "is4-ssl.mzstatic.com" },
  { protocol: "https", hostname: "is5-ssl.mzstatic.com" },
  { protocol: "https", hostname: "avatars.githubusercontent.com" },
  { protocol: "https", hostname: "www.gstatic.com" },
] } };
export default nextConfig;
