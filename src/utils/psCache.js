// somewhere central (e.g., a tiny util)
export function clearPlayerStockSessionCache() {
  if (typeof window === "undefined") return;
  const keys = Object.keys(sessionStorage);
  for (const k of keys) {
    if (k.startsWith("ps:")) sessionStorage.removeItem(k);
  }
}
