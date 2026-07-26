import PublicManagerProfile from "./PublicManagerProfile";

export const runtime = "edge";

export const metadata = {
  title: "Manager Profile | The Fantasy Arsenal",
  description: "A public Fantasy Arsenal manager profile with verified Sleeper portfolio performance.",
};

export default async function ManagerProfilePage({ params }) {
  const { accountId } = await params;
  return <PublicManagerProfile accountId={accountId} />;
}
