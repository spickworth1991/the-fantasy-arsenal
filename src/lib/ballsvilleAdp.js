const clean = (value) => String(value ?? "").trim();

export const normalizeBallsvillePlayerName = (value) =>
  clean(value)
    .replace(/\b(jr\.?|sr\.?|ii|iii|iv|v)\b/gi, "")
    .replace(/[.'’\-]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

export const ballsvilleAdpProxyUrl = (key) => {
  const normalized = clean(key).replace(/^\/+/, "");
  return normalized ? `/api/ballsville-adp?key=${encodeURIComponent(normalized)}` : "";
};

export const normalizeBallsvilleModes = (payload, fallbackSeason) =>
  (Array.isArray(payload?.rows) ? payload.rows : Array.isArray(payload) ? payload : [])
    .map((row) => {
      const modeSlug = clean(row?.modeSlug || row?.slug || row?.id)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
      if (!modeSlug) return null;
      return {
        modeSlug,
        title: clean(row?.title || row?.name || modeSlug),
        subtitle: clean(row?.subtitle || row?.blurb),
        season: Number(row?.year || row?.season || fallbackSeason),
        order: Number(row?.order || 999),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));

export function aggregateBallsvilleAdp(payload) {
  const leagues = [
    ...(Array.isArray(payload?.perLeague?.sideA) ? payload.perLeague.sideA : []),
    ...(Array.isArray(payload?.perLeague?.sideB) ? payload.perLeague.sideB : []),
    ...(Array.isArray(payload?.leagues) ? payload.leagues : []),
  ];
  const totals = new Map();

  const add = (rawKey, rawPlayer, leagueId = "") => {
    const player = rawPlayer && typeof rawPlayer === "object" ? rawPlayer : {};
    const [keyName = "", keyPosition = ""] = String(rawKey).split("|||");
    const name = clean(player.name || keyName);
    const position = clean(player.position || keyPosition).toUpperCase();
    const adp = Number(player.modeOverallPick ?? player.avgOverallPick ?? player.adp ?? player.avgPick);
    if (!name || !Number.isFinite(adp) || adp <= 0) return;
    const key = `${normalizeBallsvillePlayerName(name)}|||${position}`;
    const row = totals.get(key) || { name, position, sum: 0, samples: 0, leagues: new Set() };
    if (leagueId && row.leagues.has(leagueId)) return;
    if (leagueId) row.leagues.add(leagueId);
    const weight = leagueId ? 1 : Math.max(1, Number(player.count || player.leagueCount || 1));
    row.sum += adp * weight;
    row.samples += weight;
    totals.set(key, row);
  };

  leagues.forEach((league, index) => {
    const leagueId = clean(league?.leagueId || league?.draftId || league?.id || league?.name || index);
    Object.entries(league?.players || {}).forEach(([key, player]) => add(key, player, leagueId));
  });
  if (!totals.size) Object.entries(payload?.players || {}).forEach(([key, player]) => add(key, player));

  return new Map(
    [...totals.entries()].map(([key, row]) => [
      key,
      {
        name: row.name,
        position: row.position,
        avgOverallPick: row.samples ? row.sum / row.samples : 0,
        sampleCount: row.samples,
      },
    ])
  );
}

export function resolveBallsvilleAdp(map, name, position = "") {
  const normalizedName = normalizeBallsvillePlayerName(name);
  const normalizedPosition = clean(position).toUpperCase();
  if (!normalizedName || !(map instanceof Map)) return null;
  return (
    map.get(`${normalizedName}|||${normalizedPosition}`) ||
    [...map.entries()].find(([key]) => key.startsWith(`${normalizedName}|||`))?.[1] ||
    null
  );
}
