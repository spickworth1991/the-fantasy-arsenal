"use client";

import { useEffect, useState } from "react";
import { SleeperProvider, useSleeper } from "../context/SleeperContext";
import LoadingScreen from "../components/LoadingScreen";

function GlobalOverlay() {
  const { loading, progress } = useSleeper();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!loading) {
      setVisible(false);
      return undefined;
    }

    const timer = setTimeout(() => {
      setVisible(true);
    }, 180);

    return () => clearTimeout(timer);
  }, [loading]);

  if (!loading || !visible) return null;
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
