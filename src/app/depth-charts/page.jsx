import DepthChartClient from "./DepthChartClient";

export const metadata = {
  title:"NFL Depth-Chart Explorer | The Fantasy Arsenal",
  description:"Explore every NFL depth chart with fantasy values, projections, injuries, competition, handcuffs, and portfolio exposure.",
};

export default function DepthChartPage() {
  return <DepthChartClient />;
}
