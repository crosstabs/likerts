import {createRemoteMcpHttpServer, remoteConfigFromEnvironment} from './remote.js';

const port = Number.parseInt(process.env.LIKERTS_MCP_PORT ?? '8090', 10);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('LIKERTS_MCP_PORT must be a valid TCP port');
const host = process.env.LIKERTS_MCP_BIND_ADDRESS ?? '127.0.0.1';
const server = createRemoteMcpHttpServer(remoteConfigFromEnvironment());
server.listen(port, host, () => console.error(`Likerts remote MCP listening on ${host}:${port}`));

for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => server.close(() => process.exit(0)));
