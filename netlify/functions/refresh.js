/* Manueller Auslöser für den Update-Workflow.
 *
 * Frontend ruft POST /api/refresh auf. Wir POSTen
 * workflow_dispatch an die GitHub-API mit einem Token aus den
 * Netlify-Env-Variablen — der Token verlässt nie den Server.
 *
 * Rate-Limit: max. 1 Trigger pro 60 Sekunden (globally, via In-Memory).
 */

const REPO = "pwdrrr/container-tracker";
const WORKFLOW = "update.yml";
const COOLDOWN_MS = 60_000;

let lastTrigger = 0;

export default async (req) => {
  if (req.method !== "POST") {
    return json({ error: "POST only" }, 405);
  }

  const token = Netlify.env.get("GITHUB_TOKEN");
  if (!token) {
    return json({ error: "GITHUB_TOKEN nicht gesetzt." }, 500);
  }

  const now = Date.now();
  const elapsed = now - lastTrigger;
  if (elapsed < COOLDOWN_MS) {
    return json({
      error: "Cooldown aktiv",
      retry_in_s: Math.ceil((COOLDOWN_MS - elapsed) / 1000),
    }, 429);
  }

  const r = await fetch(
    `https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "container-tracker-refresh-function",
      },
      body: JSON.stringify({ ref: "main" }),
    }
  );

  if (r.status === 204) {
    lastTrigger = now;
    return json({ ok: true, dispatched_at: new Date().toISOString() });
  }

  const text = await r.text().catch(() => "");
  return json({ error: `GitHub ${r.status}`, details: text.slice(0, 300) }, 502);
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const config = {
  path: "/api/refresh",
};
