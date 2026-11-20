import assert from "node:assert/strict";
import test from "node:test";
import { TOOL_CATALOG, defaultToolsFor, toolsForRole } from "../lib/office/tools";

test("every Bot role can manually select email sending", () => {
  const entry = TOOL_CATALOG.find((tool) => tool.key === "email.send");
  assert.ok(entry);
  assert.equal(entry.label, "发送邮件");
  assert.equal(entry.group, "沟通");
  assert.equal(entry.gated, true);
  for (const role of ["head", "lead", "worker"] as const) {
    assert.ok(toolsForRole(role).some((tool) => tool.key === "email.send"));
  }
});

test("email sending is not enabled by default", () => {
  for (const role of ["head", "lead", "worker"] as const) {
    assert.equal(defaultToolsFor(role).includes("email.send"), false);
  }
});
