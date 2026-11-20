import assert from "node:assert/strict";
import test from "node:test";
import { mergeThreadMessages, type ThreadMessageLike } from "../lib/chat/merge-thread";

const user: ThreadMessageLike = {
  id: "user-1",
  role: "user",
  parts: [{ type: "text", text: "hello" }],
};

const streamed: ThreadMessageLike = {
  id: "assistant-1",
  role: "assistant",
  parts: [{ type: "text", text: "streamed reply" }],
  metadata: { createdAt: "2026-11-20T04:00:00.000Z" },
};

test("a stale server snapshot does not remove a streamed reply", () => {
  const merged = mergeThreadMessages([user, streamed], [user]);

  assert.equal(merged.length, 2);
  assert.equal(merged[0], user);
  assert.equal(merged[1], streamed);
});

test("new persisted messages are appended without replacing existing message objects", () => {
  const report: ThreadMessageLike = {
    id: "assistant-2",
    role: "assistant",
    parts: [{ type: "text", text: "background report" }],
  };

  const merged = mergeThreadMessages([user, streamed], [user, streamed, report]);

  assert.deepEqual(merged.map((message) => message.id), ["user-1", "assistant-1", "assistant-2"]);
  assert.equal(merged[0], user);
  assert.equal(merged[1], streamed);
  assert.equal(merged[2], report);
});
