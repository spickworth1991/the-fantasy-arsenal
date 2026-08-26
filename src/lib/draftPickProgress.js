const number = (value) => Number(value || 0);

export function occupiedDraftPickNumbers(picks = []) {
  return new Set(
    picks
      .map((pick) => number(pick?.pick_no))
      .filter((pickNo) => pickNo > 0),
  );
}

export function openDraftPickNumbers(picks = [], totalPicks = 0) {
  const occupied = occupiedDraftPickNumbers(picks);
  return Array.from({ length: Math.max(0, number(totalPicks)) }, (_, index) => index + 1)
    .filter((pickNo) => !occupied.has(pickNo));
}

export function nextOpenDraftPick(picks = [], totalPicks = 0) {
  return openDraftPickNumbers(picks, totalPicks)[0] || Math.max(0, number(totalPicks)) + 1;
}

export function isPreassignedDraftPick(pick, nextOpenPick, draftStatus = "") {
  if (!pick?.player_id) return false;
  if (pick.is_keeper === true || pick.is_keeper === 1 || String(pick.is_keeper).toLowerCase() === "true") return true;
  if (String(draftStatus).toLowerCase() === "pre_draft") return true;
  return number(pick.pick_no) > number(nextOpenPick);
}
