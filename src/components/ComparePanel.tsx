"use client";
import { useState } from "react";
import { ArrowRight, Copy, Link2, LoaderCircle, Shield } from "lucide-react";

export function ComparePanel() {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function createLink() {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/compare/share", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not create a comparison link.");
      setUrl(data.url); setMessage(data.localOnly ? `Local preview link ready · expires in ${data.expiresInDays} days. Add NEXT_PUBLIC_SITE_URL and deploy to share it with someone on another device.` : `Private link ready · expires in ${data.expiresInDays} days.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not create a comparison link."); }
    finally { setBusy(false); }
  }
  async function copyLink() {
    try { await navigator.clipboard.writeText(url); setMessage("Comparison link copied."); }
    catch { setMessage("Clipboard access was denied. Select and copy the link below."); }
  }
  async function revoke() {
    setBusy(true);
    try {
      const token = new URL(url).pathname.split("/").filter(Boolean).at(-1);
      const response = await fetch("/api/compare/share", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "Could not revoke the link.");
      setUrl(""); setMessage("Comparison link revoked. It can no longer be opened.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not revoke the link."); }
    finally { setBusy(false); }
  }
  return <div className="compare-panel">
    <div className="compare-panel-mark"><Link2 size={20}/></div>
    <div className="compare-panel-copy"><span className="eyebrow">FIND YOUR PEOPLE</span><h3>Compare your <i>niche.</i></h3><p>Share an expiring link to a short taste summary. It never includes your searches, skips, email, or private metadata.</p>
      {url&&<div className="share-url"><input aria-label="Comparison link" readOnly value={url}/><button onClick={copyLink} aria-label="Copy comparison link"><Copy size={15}/> Copy</button></div>}
      {message&&<p className="compare-status" role="status">{message}</p>}
      <div className="compare-actions">{url?<><a href={url}>Open comparison <ArrowRight size={14}/></a><button onClick={revoke} disabled={busy}>Revoke link</button></>:<button className="compare-create" onClick={createLink} disabled={busy}>{busy?<LoaderCircle className="spin" size={16}/>:<Shield size={15}/>} Generate comparison link <ArrowRight size={14}/></button>}</div>
    </div>
  </div>;
}
