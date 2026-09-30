"use client";
import { OrbGallery } from "@/shaders/orb-gallery/OrbGallery";

export function ExplorationSphere() {
  return <div className="shader-frame shader-frame--immersive" aria-label="The taste universe, shown as an interactive orb gallery">
    <OrbGallery />
  </div>;
}
