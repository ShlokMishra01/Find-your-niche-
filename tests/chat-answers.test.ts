import test from "node:test";
import assert from "node:assert/strict";
import { offlineAnswer } from "../src/lib/chat-answers";

test("common taste-map technology prompt gets an informative offline answer", () => {
  const answer = offlineAnswer("What is RAG?");
  assert.ok(answer);
  assert.match(answer.answer, /retrieval-augmented generation/i);
  assert.match(answer.answer, /preserve metadata and permissions/i);
  assert.match(answer.answer, /hybrid retrieval/i);
  assert.match(answer.answer, /measure retrieval recall/i);
  assert.ok(answer.suggestions.length > 0);
});

test("offline answer recognizes vector database prompts", () => {
  const answer = offlineAnswer("What is a vector database?");
  assert.ok(answer);
  assert.match(answer.answer, /semantic search/i);
});

test("unrecognized questions can continue through the configured reasoning provider", () => {
  assert.equal(offlineAnswer("What is my strongest niche?"), null);
});
