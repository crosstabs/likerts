import assert from "node:assert/strict";
import test from "node:test";
import { SCOPE_PRESETS, connectionExamples } from "../public/workspace-state.js";

test("safe scope defaults and connection examples do not embed credentials", () => {
  assert.ok(SCOPE_PRESETS.read.every((scope) => scope.endsWith(":read")));
  for (const scope of ["responses:write", "identity:write", "webhooks:write", "exports:write"]) {
    assert.ok(!SCOPE_PRESETS.build.includes(scope));
  }
  const examples = connectionExamples("ws_test", "https://api.example.com");
  assert.match(examples.cli, /likerts call usage_get/);
  assert.match(examples.codex, /mcp\/ws_test/);
  assert.equal(JSON.parse(examples.claude).mcpServers.likerts.headers.Authorization, "Bearer ${LIKERTS_TOKEN}");
  assert.equal(JSON.stringify(examples).includes("lks_"), false);
});
