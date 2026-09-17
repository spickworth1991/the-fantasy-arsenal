export const runtime = "edge";

const respond = (body, status) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

async function dispatch(request) {
  const secret = process.env.CRON_TRIGGER_SECRET;
  const token = process.env.GITHUB_ACTIONS_TOKEN;
  if (!secret || !token)
    return respond({ ok: false, error: "Leaderboard automation is not configured." }, 503);
  if (request.headers.get("authorization") !== `Bearer ${secret}`)
    return respond({ ok: false, error: "Unauthorized." }, 401);

  const repository = process.env.GITHUB_REPOSITORY || "spickworth1991/the-fantasy-arsenal";
  const workflow = process.env.GITHUB_LEADERBOARD_WORKFLOW || "refresh-arsenal-leaderboard.yml";
  const ref = process.env.GITHUB_VALUES_REF || "main";
  const response = await fetch(
    `https://api.github.com/repos/${repository}/actions/workflows/${workflow}/dispatches`,
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "the-fantasy-arsenal-cron",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({ ref }),
    },
  );
  if (!response.ok) {
    let githubMessage = "";
    try { githubMessage = String((await response.json())?.message || ""); } catch {}
    return respond({ ok: false, error: "GitHub did not accept the leaderboard refresh.", status: response.status, github_message: githubMessage || null }, 502);
  }
  return respond({ ok: true, message: "Leaderboard refresh queued.", workflow, ref }, 202);
}

export const GET = dispatch;
export const POST = dispatch;
