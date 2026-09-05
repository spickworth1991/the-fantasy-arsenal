import TrustCenterClient from "./TrustCenterClient";

export const metadata = {
  title: "Trust & Accuracy Center",
  description: "Inspect source freshness, coverage, disagreement, projection accuracy, model confidence, and the evidence behind Fantasy Arsenal calculations.",
  alternates: { canonical: "/trust-center" },
};

export default function TrustCenterPage() {
  return <TrustCenterClient />;
}
