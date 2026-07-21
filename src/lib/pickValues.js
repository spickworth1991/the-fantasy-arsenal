import { getPickSyntheticPlayerId } from "./picks";

const positive = (value) => {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

export function getMarketPickValue({ players, valueFor, season, round, slot = 0, teams = 12 }) {
  const year = Number(season);
  const pickRound = Number(round);
  const draftSlot = Number(slot);
  if (!year || !pickRound || typeof valueFor !== "function") return { value: 0, basis: "unavailable" };
  const candidates = [];
  if (draftSlot > 0) {
    candidates.push({ id:getPickSyntheticPlayerId({ year, round:pickRound, slot:draftSlot, kind:"exact" }), basis:"exact pick", requireYear:true });
    const third = Math.max(1, Number(teams) || 12) / 3;
    const bucket = draftSlot <= third ? "early" : draftSlot <= third * 2 ? "mid" : "late";
    candidates.push({ id:getPickSyntheticPlayerId({ year, round:pickRound, bucket, kind:"bucket" }), basis:`${bucket} round value` });
  } else {
    candidates.push({ id:getPickSyntheticPlayerId({ year, round:pickRound, bucket:"mid", kind:"bucket" }), basis:"mid-round proxy" });
  }
  candidates.push({ id:getPickSyntheticPlayerId({ year, round:pickRound, kind:"generic" }), basis:"generic round value" });
  for (const candidate of candidates) {
    const player = players?.[candidate.id];
    if (!player || (candidate.requireYear && !String(player.full_name || "").includes(String(year)))) continue;
    const value = positive(valueFor(player));
    if (value) return { value:Math.round(value), basis:candidate.basis, playerId:candidate.id };
  }
  return { value:0, basis:"not supplied by this source" };
}
