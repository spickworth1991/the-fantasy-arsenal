export const metadata = {
  title: "Arsenal Intelligence",
  description: "A personalized fantasy football decision center for lineup, waiver, trade, and roster priorities across every connected Sleeper league.",
  alternates: { canonical: "/intelligence" },
};
import IntelligenceClient from "./IntelligenceClient";
export default function IntelligencePage() { return <IntelligenceClient />; }
