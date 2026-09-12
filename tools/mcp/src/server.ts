import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { capabilities, LikertsClient, LikertsHttpError } from './client.js';
import { operationContracts } from './contract.js';

export function createServer(client: LikertsClient): Server {
  const server = new Server({name: 'likerts', version: '0.1.0'}, {capabilities: {tools: {}}});
  server.setRequestHandler(ListToolsRequestSchema, async () => ({tools: capabilities.map(capability => ({
    name: capability.name,
    description: capability.description,
    inputSchema: operationContracts.get(capability.name)!.inputSchema,
    outputSchema: operationContracts.get(capability.name)!.outputSchema,
    annotations: {readOnlyHint: capability.method === 'GET', destructiveHint: capability.method !== 'GET', openWorldHint: false}
  }))}));
  server.setRequestHandler(CallToolRequestSchema, async request => {
    const contract = operationContracts.get(request.params.name);
    const failure = (code: string, message: string) => ({isError: true, content: [{type: 'text' as const, text: JSON.stringify({error: {code, message}})}]});
    if (!contract) return failure('unknown_capability', 'Unknown Likerts capability');
    const input = request.params.arguments ?? {};
    if (!contract.validateInput(input)) return failure('invalid_request', 'Arguments do not match the published input schema');
    try {
      const data = await client.call(request.params.name, input);
      if (!contract.validateOutput({result: data})) return failure('invalid_response', 'Server response does not match the published output schema');
      return {content: [{type: 'text' as const, text: JSON.stringify(data)}], structuredContent: {result: data}};
    } catch (error) {
      if (error instanceof LikertsHttpError) return {isError: true, content: [{type: 'text', text: JSON.stringify({error: {code: 'http_error', message: error.message, status: error.status, operation: error.operation}})}]};
      return failure('request_failed', 'Likerts request failed');
    }
  });
  return server;
}
