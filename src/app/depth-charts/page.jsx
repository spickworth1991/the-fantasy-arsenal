import DepthChartClient from "./DepthChartClient";

export const metadata = {
  title:"NFL Depth-Chart Explorer",
  description:"Explore every NFL depth chart with fantasy values, projections, injuries, competition, handcuffs, and portfolio exposure.",
  alternates: { canonical: "/depth-charts" },
};

export default function DepthChartPage() {
  return <DepthChartClient />;
}
