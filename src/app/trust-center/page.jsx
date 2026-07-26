import TrustCenterClient from "./TrustCenterClient";

export const metadata = {
  title: "Trust & Accuracy Center | The Fantasy Arsenal",
  description: "Inspect source freshness, coverage, disagreement, projection accuracy, model confidence, and the evidence behind Fantasy Arsenal calculations.",
};

export default function TrustCenterPage() {
  return <TrustCenterClient />;
}
