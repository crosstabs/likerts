export const SCOPE_PRESETS = {
  read: ["surveys:read", "responses:read", "usage:read", "exports:read"],
  build: ["surveys:read", "surveys:write", "collections:write", "responses:read", "usage:read", "exports:read"],
};

export function connectionExamples(workspaceId, apiOrigin) {
  const mcp = `https://likerts-mcp.onrender.com/mcp/${encodeURIComponent(workspaceId)}`;
  return {
    cli: `export LIKERTS_API_URL=${apiOrigin}\n# Supply LIKERTS_TOKEN through your secret manager.\nlikerts call usage_get`,
    api: `export LIKERTS_API_URL=${apiOrigin}\n# Supply LIKERTS_TOKEN through your secret manager.\nprintf 'header = "Authorization: Bearer %s"\\n' "$LIKERTS_TOKEN" | \\\n  curl --fail-with-body --config - "$LIKERTS_API_URL/v1/usage"`,
    codex: `# Supply LIKERTS_TOKEN to the Codex process through your secret manager.\ncodex mcp add likerts \\\n  --url "${mcp}" \\\n  --bearer-token-env-var LIKERTS_TOKEN`,
    claude: JSON.stringify({mcpServers: {likerts: {type: "http", url: mcp, headers: {Authorization: "Bearer ${LIKERTS_TOKEN}"}}}}, null, 2),
  };
}
