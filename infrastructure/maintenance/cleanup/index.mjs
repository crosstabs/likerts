import { makeHandler } from './handler.mjs';
export default makeHandler('cleanup', new URL('./', import.meta.url));
