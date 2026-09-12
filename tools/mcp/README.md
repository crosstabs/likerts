# Likerts MCP server

Operate the free, MIT-licensed Likerts survey platform from an MCP client. The server exposes the same typed operations and authorization boundaries as the HTTP API and CLI.

The hosted server is listed in the [official MCP registry](https://registry.modelcontextprotocol.io/v0.1/servers/io.github.crosstabs%2Flikerts/versions/latest) as `io.github.crosstabs/likerts`. Configure your workspace ID and scoped service credential in your MCP client. The listing does not make workspace data public.

## Install

Download the MCP npm tarball from the [community release](https://github.com/crosstabs/likerts/releases). Install the downloaded file with `npm install --global /absolute/path/to/the-mcp-package.tgz`. Node.js 22 or newer is required. This package is not yet published to the npm registry.

Configure your MCP client to run `likerts-mcp` over stdio. Set `LIKERTS_API_URL` to your API origin and supply a scoped `LIKERTS_TOKEN` through your environment or secret manager. The local API defaults to `http://127.0.0.1:8080`. Collection operations use `LIKERTS_COLLECTION_TOKEN` separately; keep management credentials out of embedded apps and tool arguments.

For a source checkout:

```sh
npm ci --prefix tools/mcp
npm run build --prefix tools/mcp
node tools/mcp/dist/main.js
```

Launch the command from an MCP client; stdout is reserved for protocol messages. Authentication and permission checks remain enforced by your API.

## Remote connection

The optional hosted endpoint is `https://likerts-mcp.onrender.com/mcp/{workspaceId}`. It requires the workspace's scoped service credential. Self-hosters use their own remote host.

[Setup for Codex and Claude](https://github.com/crosstabs/likerts/blob/main/tools/README.md) · [Quickstart](https://likerts.com/docs) · [API reference](https://likerts.com/docs/api)
