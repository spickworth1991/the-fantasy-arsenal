export const runtime = "edge";

const json = (body, status) =>
  Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });

async function dispatchUpdate(request) {
  const secret = process.env.CRON_TRIGGER_SECRET;
  const token = process.env.GITHUB_ACTIONS_TOKEN;
  const authorization = request.headers.get("authorization") || "";

  if (!secret || !token) {
    return json({ ok: false, error: "Update automation is not configured." }, 503);
  }
  if (authorization !== `Bearer ${secret}`) {
    return json({ ok: false, error: "Unauthorized." }, 401);
  }

  const repository =
    process.env.GITHUB_REPOSITORY || "spickworth1991/the-fantasy-arsenal";
  const workflow =
    process.env.GITHUB_VALUES_WORKFLOW || "update-values.yml";
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
    const requestId = response.headers.get("x-github-request-id");
    console.error("Unable to dispatch values workflow", {
      status: response.status,
      requestId,
    });
    return json(
      {
        ok: false,
        error: "GitHub did not accept the update request.",
        status: response.status,
        request_id: requestId,
      },
      502,
    );
  }

  return json(
    {
      ok: true,
      message: "Daily values and projections update queued.",
      workflow,
      ref,
    },
    202,
  );
}

export async function POST(request) {
  return dispatchUpdate(request);
}

export async function GET(request) {
  return dispatchUpdate(request);
}
