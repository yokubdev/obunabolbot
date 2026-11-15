import { Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { useEffect } from "react";
import ChannelPage from "./pages/ChannelPage";
import MySubs from "./pages/MySubs";
import OwnerLayout from "./pages/owner/OwnerLayout";
import Overview from "./pages/owner/Overview";
import Subscribers from "./pages/owner/Subscribers";
import Plans from "./pages/owner/Plans";
import Kassa from "./pages/owner/Kassa";
import Platform from "./pages/Platform";
import Rules from "./pages/Rules";
import Offer from "./pages/Offer";

/** t.me/<bot>?startapp=<slug>[_<PROMO>] opens the Mini App root with start_param set: one tap to the channel page. */
function Home() {
  const nav = useNavigate();
  useEffect(() => {
    const start = (window as any).Telegram?.WebApp?.initDataUnsafe?.start_param as string | undefined;
    const m = start?.match(/^([a-z0-9-]{3,40})(?:_([A-Za-z0-9_]{3,20}))?$/);
    nav(m ? `/c/${m[1]}${m[2] ? `?promo=${encodeURIComponent(m[2].toUpperCase())}` : ""}` : "/my", { replace: true });
  }, [nav]);
  return null;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/c/:slug" element={<ChannelPage />} />
      <Route path="/my" element={<MySubs />} />
      <Route path="/owner" element={<OwnerLayout />}>
        <Route index element={<Overview />} />
        <Route path="subscribers" element={<Subscribers />} />
        <Route path="plans" element={<Plans />} />
        <Route path="kassa" element={<Kassa />} />
      </Route>
      <Route path="/platform" element={<Platform />} />
      <Route path="/rules" element={<Rules />} />
      <Route path="/offer" element={<Offer />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
