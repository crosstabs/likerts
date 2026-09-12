#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { LikertsClient } from './client.js';
import { createServer } from './server.js';
const client = new LikertsClient(process.env.LIKERTS_API_URL ?? 'http://127.0.0.1:8080', process.env.LIKERTS_TOKEN, process.env.LIKERTS_COLLECTION_TOKEN, fetch, process.env.LIKERTS_WORKSPACE_ID);
await createServer(client).connect(new StdioServerTransport());
