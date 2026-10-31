import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import fs from "node:fs";
import path from "node:path";
import axios from "axios";
import { DATA_DIR } from "../db";

// Local mirror of the ludusavi save-location manifest.
//
// ludusavi (bundled in the launcher) needs this manifest to know where each
// game stores its saves. Its usual source (cdn.losbroxas.org) sits behind
// Cloudflare, which is throttled/blocked in some regions, so a launcher on a
// blocked network cannot back up saves at all. This server — which may have a
// VPN egress the clients lack — fetches the manifest once, caches it, and
// serves it over the LAN, so clients never depend on the upstream CDN.

const MANIFEST_CACHE = path.join(DATA_DIR, "ludusavi-manifest.yaml");
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // refresh at most once a day

// Tried in order. GitHub first (canonical, often reachable where Cloudflare is
// not), then the Hydra CDN mirror.
const UPSTREAM_SOURCES = [
  "https://raw.githubusercontent.com/mtkennerly/ludusavi-manifest/master/data/manifest.yaml",
  "https://cdn.losbroxas.org/manifest.yaml",
];

function cacheAgeMs(): number | null {
  try {
    return Date.now() - fs.statSync(MANIFEST_CACHE).mtimeMs;
  } catch {
    return null; // no cache yet
  }
}

async function refreshCache(): Promise<boolean> {
  for (const url of UPSTREAM_SOURCES) {
    try {
      const res = await axios.get<string>(url, {
        timeout: 30000,
        responseType: "text",
        // Manifests are a few MB of YAML; guard against a runaway body.
        maxContentLength: 128 * 1024 * 1024,
      });
      if (typeof res.data === "string" && res.data.includes(":")) {
        await fs.promises.writeFile(`${MANIFEST_CACHE}.tmp`, res.data);
        await fs.promises.rename(`${MANIFEST_CACHE}.tmp`, MANIFEST_CACHE);
        return true;
      }
    } catch {
      // try next source
    }
  }
  return false;
}

export async function ludusaviRoutes(app: FastifyInstance) {
  app.get(
    "/ludusavi/manifest.yaml",
    async (_req: FastifyRequest, reply: FastifyReply) => {
      const age = cacheAgeMs();

      // Refresh if we have no cache or it is stale. A failed refresh is not
      // fatal as long as we still have a (possibly stale) cached copy.
      if (age === null || age > CACHE_TTL_MS) {
        const ok = await refreshCache();
        if (!ok && age === null) {
          return reply.code(503).send({
            error:
              "ludusavi manifest is unavailable upstream and the server has no cached copy",
          });
        }
      }

      return reply
        .type("text/yaml; charset=utf-8")
        .header("Cache-Control", "public, max-age=3600")
        .send(fs.createReadStream(MANIFEST_CACHE));
    }
  );

  // Lightweight status for debugging: is the mirror populated and how old.
  app.get("/ludusavi/manifest-status", async () => {
    const age = cacheAgeMs();
    return {
      cached: age !== null,
      ageSeconds: age === null ? null : Math.floor(age / 1000),
      stale: age !== null && age > CACHE_TTL_MS,
    };
  });
}
