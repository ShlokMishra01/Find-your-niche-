import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "Find Your Niche — Explore what moves you", description: "A living map of your taste across film, books, music and ideas." };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
