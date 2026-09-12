import ProjectionCenterClient from "./ProjectionCenterClient";

export const metadata = {
  title: "Fantasy Football Projection Center",
  description:
    "Rank weekly fantasy football projections, inspect player forecasts, and audit The Fantasy Arsenal model accuracy.",
  alternates: { canonical: "/projection-center" },
};

export default function ProjectionCenterPage() {
  return <ProjectionCenterClient />;
}
