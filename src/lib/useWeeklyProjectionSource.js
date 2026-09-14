"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSleeper } from "../context/SleeperContext";
import { PROJECTION_DATA_SEASON } from "./projectionSeason";

// Tool-local choices load weekly data even when the global source is a value feed.
export function useWeeklyProjectionSource(source, { enabled = true, season = PROJECTION_DATA_SEASON } = {}) {
  const { preloadWeeklyProjections, getWeeklyProjectionDetails } = useSleeper();
  const loader = useRef(preloadWeeklyProjections);
  loader.current = preloadWeeklyProjections;
  const [loaded, setLoaded] = useState(null);
  const key = `${season}:${source}`;
  useEffect(() => {
    if (!enabled) return undefined;
    let active = true;
    loader.current(source, season).then((data) => {
      if (active) setLoaded({ key, data });
    }).catch(() => { if (active) setLoaded({ key, data: null }); });
    return () => { active = false; };
  }, [enabled, key, source, season]);
  const data = loaded?.key === key ? loaded.data : null;
  const details = useCallback((player, week, options = {}) =>
    getWeeklyProjectionDetails(player, source, week, { ...options, season, data }),
  [getWeeklyProjectionDetails, source, season, data]);
  const getPoints = useCallback((player, week, options = {}) => details(player, week, options).points ?? 0, [details]);
  return { getPoints, details, loading: enabled && loaded?.key !== key, ready: Boolean(data?.index || data?.weeklyIndex) };
}
