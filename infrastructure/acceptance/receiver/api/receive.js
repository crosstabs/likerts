import { receive } from '../lib/receiver.mjs';

// Web-standard Request preserves the exact bytes; never use a parsed body helper.
export default { fetch: receive };
