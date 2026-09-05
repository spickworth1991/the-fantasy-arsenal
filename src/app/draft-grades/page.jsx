export const metadata = {
  title: "Draft Grade Studio",
  description: "Grade every fantasy football draft pick and team using league settings, roster construction, positional need, opportunity cost, and current player markets.",
  alternates: { canonical: "/draft-grades" },
};

import DraftGradesClient from "./DraftGradesClient";
export default function DraftGradesPage() { return <DraftGradesClient />; }
