// Cloudflare Pages Functions advanced entrypoint.
//
// next-on-pages will generate the worker that runs your Next.js app.
// Exporting Durable Object classes from this file is the standard way to register
// them for bindings in Pages.

export { DraftRegistry } from "../src/durable/DraftRegistryDO";
