import test from "node:test";
import assert from "node:assert/strict";
import { getCrossDomainInspiration, getInspiration, inspirationSuggestions } from "../src/lib/inspiration";

test("a one-word RAG prompt produces cross-domain details and follow-up ideas", () => {
  const items = getCrossDomainInspiration("RAG");
  assert.ok(items.length >= 5);
  assert.ok(items.some(item => item.domain === "code"));
  assert.ok(items.some(item => item.domain === "book"));
  assert.ok(items.some(item => /retrieval|data systems/i.test(item.description)));
  assert.ok(inspirationSuggestions("RAG").some(item => /GraphRAG/i.test(item)));
});

test("discovery outage fallback returns curated results for the requested domain", () => {
  const items = getInspiration("RAG", [], "code");
  assert.ok(items.length >= 3);
  assert.ok(items.every(item => item.domain === "code"));
  assert.ok(items.every(item => item.url?.startsWith("https://")));
});

test("a single genre word can branch into several related media recommendations", () => {
  const items = getCrossDomainInspiration("crime");
  assert.ok(items.some(item => item.domain === "movie"));
  assert.ok(items.some(item => item.domain === "book"));
  assert.ok(inspirationSuggestions("crime").some(item => /if you like/i.test(item)));
});

test("similar seed fallbacks omit the seed and show credible neighboring titles", () => {
  const heat = getInspiration("movies like Heat", [], "movie");
  assert.ok(heat.length >= 3);
  assert.ok(!heat.some(item => item.title === "Heat"));
  assert.ok(heat.some(item => /Departed|Collateral|Thief/.test(item.title)));
  const radiohead = getInspiration("songs like Radiohead", [], "music");
  assert.ok(radiohead.some(item => /Portishead/.test(item.description ?? "")));
  assert.ok(radiohead.every(item => item.domain === "music"));
  assert.ok(radiohead.every(item => item.type === "track"));
  assert.ok(radiohead.some(item => item.title === "Roads"));
  assert.ok(heat.find(item => item.title === "The Departed")?.image);
});
