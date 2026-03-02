// Cloudflare Pages Functions advanced entrypoint.
//
// next-on-pages will generate the worker that runs your Next.js app.
// Exporting Durable Object classes from this file is the standard way to register
// them for bindings in Pages.

export { DraftRegistry } from "../src/durable/DraftRegistryDO";

// ---------------------------------------------------------------------------
// Cron bootstrap (no UI "kick" required)
// ---------------------------------------------------------------------------
// Durable Object alarms only run after the DO has been instantiated at least once.
// If nobody hits the DO after a deploy, your 15s registry refresh + notifications
// loop never starts.
//
// Add a Cloudflare Cron Trigger (e.g. every 1 minute) that pings /tick.
// The DO will self-arm its 15s alarm and continue running independently.
//
// Cloudflare Pages: Dashboard → Pages → Settings → Functions → Cron Triggers.
// Suggested schedule: * * * * *
export async function scheduled(event, env, ctx) {
  ctx.waitUntil(
    (async () => {
      try {
        if (!env?.DRAFT_REGISTRY) {
          console.log("[cron] missing DRAFT_REGISTRY binding");
          return;
        }

        const id = env.DRAFT_REGISTRY.idFromName("master");
        const stub = env.DRAFT_REGISTRY.get(id);

        // /tick keeps behavior consistent with the DO alarm loop.
        const res = await stub.fetch("https://do.internal/tick");
        console.log("[cron] ping /tick ->", res.status);
      } catch (err) {
        console.log("[cron] error pinging registry DO:", err?.message || String(err));
      }
    })()
  );
}
