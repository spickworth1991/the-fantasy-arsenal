// workers/draft-registry/index.js
export { DraftRegistry } from "../../src/durable/DraftRegistryDO.js";

export default {
  async fetch() {
    return new Response("draft-registry worker ok");
  },
};