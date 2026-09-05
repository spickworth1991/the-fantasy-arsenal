import CommissionerDashboardClient from "./CommissionerDashboardClient";

export const metadata = {
  title: "Commissioner League Health Dashboard",
  description: "Audit Sleeper league activity, lineup participation, competitive balance, settings, orphan quality, and review signals.",
  alternates: { canonical: "/commissioner-dashboard" },
};

export default function CommissionerDashboardPage() {
  return <CommissionerDashboardClient />;
}
