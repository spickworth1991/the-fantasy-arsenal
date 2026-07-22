import ManagerIntelligenceClient from "./ManagerIntelligenceClient";

export const metadata = {
  title: "Sleeper Manager Intelligence | The Fantasy Arsenal",
  description: "Explore public Sleeper manager history, shared leagues, player exposure, trade activity, and draft history.",
  alternates: { canonical: "/manager-intelligence" },
};

export default function Page() { return <ManagerIntelligenceClient />; }
