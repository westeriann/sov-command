// The single-player build never reads files from disk: the world comes over
// fetch instead. These stand in for Node modules the server code imports.
export function readFileSync(): never { throw new Error('No file system in the browser.'); }
export function join(...parts: string[]) { return parts.join('/'); }
export default {};
