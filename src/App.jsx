import { Routes, Route } from "react-router-dom";
import Navbar from "./components/Navbar";
import HomePage from "./pages/HomePage";
import TradeAnalyzer from "./pages/TradeAnalyzer";
import PlayerStock from "./pages/PlayerStock";
import PlayerAvailability from "./pages/PlayerAvailability";
import LoadingScreen from "./components/LoadingScreen";
import { useSleeper } from "./context/SleeperContext";

export default function App() {
  const { loading, progress } = useSleeper();

  return (
    <div className="text-white min-h-screen relative">
      {/* ✅ Show NFL-themed loading screen when loading */}
      {loading && <LoadingScreen progress={progress} text="Loading your leagues..." />}
      <Navbar />
      <div className="pt-24">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/trade" element={<TradeAnalyzer />} />
          <Route path="/player-stock" element={<PlayerStock />} />
          <Route path="/player-availability" element={<PlayerAvailability />} />
        </Routes>
      </div>
    </div>
  );
}
