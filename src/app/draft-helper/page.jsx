import DraftHelperClient from "./DraftHelperClient";

export const metadata = {
  title: "Sleeper Draft Helper & Live Draftboard | The Fantasy Arsenal",
  description: "A league-aware Sleeper draftboard with live picks, roster needs, pick ownership, and contextual player recommendations.",
  alternates: { canonical: "/draft-helper" },
};

export default function Page() {
  return <DraftHelperClient />;
}
