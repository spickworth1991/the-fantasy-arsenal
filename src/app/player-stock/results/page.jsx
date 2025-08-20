// app/player-stock/results/page.jsx  (SERVER)
import ClientResults from "./ClientResults";

export default function Page({ searchParams }) {
  // Static shell; no server data, no CF function call.
  return <ClientResults initialSearchParams={searchParams} />;
}

