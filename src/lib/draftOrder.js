export function getDraftSlotForPick(pickNo, teams, draftType = "snake", reversalRound = 0) {
  const teamCount = Number(teams || 0);
  const overall = Number(pickNo || 0);
  if (teamCount <= 0 || overall <= 0) return 0;
  const round = Math.floor((overall - 1) / teamCount) + 1;
  const index = (overall - 1) % teamCount;
  if (String(draftType || "snake").toLowerCase() === "linear") return index + 1;
  let reverse = round % 2 === 0;
  const reversal = Number(reversalRound || 0);
  if (reversal > 0 && round >= reversal) reverse = !reverse;
  return reverse ? teamCount - index : index + 1;
}
