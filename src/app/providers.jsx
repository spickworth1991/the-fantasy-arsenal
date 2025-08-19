"use client";

import { SleeperProvider, useSleeper } from "../context/SleeperContext";
import LoadingScreen from "../components/LoadingScreen";

function GlobalOverlay() {
  const { loading, progress } = useSleeper();
  if (!loading) return null;
  return <LoadingScreen progress={progress} text="Loading your leagues..." />;
}

export default function Providers({ children }) {
  return (
    <SleeperProvider>
      <GlobalOverlay />
      {children}
    </SleeperProvider>
  );
}
