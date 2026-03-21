export function metricModeFromSourceKey(sourceKey) {
  return String(sourceKey || "").startsWith("proj:") ? "projections" : "values";
}

export function projectionSourceFromKey(sourceKey) {
  const key = String(sourceKey || "").toLowerCase();
  if (key === "proj:espn") return "ESPN";
  if (key === "proj:cbs") return "CBS";
  return "CSV";
}

export function valueSourceFromKey(sourceKey) {
  const key = String(sourceKey || "").toLowerCase();
  if (key === "val:keeptradecut") return "KeepTradeCut";
  if (key === "val:dynastyprocess") return "DynastyProcess";
  if (key === "val:fantasynav") return "FantasyNavigator";
  if (key === "val:idynastyp") return "IDynastyP";
  if (key === "val:idpshow") return "IDPShow";
  if (key === "val:thefantasyarsenal") return "TheFantasyArsenal";
  return "FantasyCalc";
}
