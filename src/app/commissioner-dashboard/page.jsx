import CommissionerDashboardClient from "./CommissionerDashboardClient";

export const metadata = {
  title: "Commissioner League Health Dashboard | The Fantasy Arsenal",
  description: "Audit Sleeper league activity, lineup participation, competitive balance, settings, orphan quality, and review signals.",
};

export default function CommissionerDashboardPage() {
  return <CommissionerDashboardClient />;
}
