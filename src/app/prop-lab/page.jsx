import PropLabClient from "./PropLabClient";

export const metadata = {
  title: "Prop Lab | The Fantasy Arsenal",
  robots: { index: false, follow: false },
};

export default function PropLabPage() {
  return <PropLabClient />;
}
