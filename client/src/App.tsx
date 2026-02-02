import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch, useLocation } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { AccountProvider } from "./contexts/AccountContext";
import Home from "./pages/Home";
import Settings from "./pages/Settings";
import CSPDashboard from "./pages/CSPDashboard";
import CCDashboard from "./pages/CCDashboard";
import PMCCDashboard from "./pages/PMCCDashboard";
import Performance from "./pages/Performance";
import ActionItems from "./pages/ActionItems";
import { AdminDashboard } from "./pages/AdminDashboard";
import { AdminUsers } from "./pages/AdminUsers";
import { AdminBroadcasts } from "./pages/AdminBroadcasts";
import { AdminFeedback } from "./pages/AdminFeedback";
import AdminChats from "./pages/AdminChats";
import Inbox from "./pages/Inbox";
import { Sidebar } from "./components/Sidebar";
import { PaperTradingBanner } from "./components/PaperTradingBanner";
import { SupportWidget } from "./components/SupportWidget";
import { LegalAcceptanceModal } from "./components/LegalAcceptanceModal";
import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";

function Router() {
  const [location] = useLocation();
  const isAdminRoute = location.startsWith('/admin');
  const [showLegalModal, setShowLegalModal] = useState(false);
  const { data: user, refetch } = trpc.auth.me.useQuery();

  useEffect(() => {
    if (user && !user.acceptedTermsAt && !user.acceptedRiskDisclosureAt) {
      setShowLegalModal(true);
    }
  }, [user]);

  const handleLegalAccepted = () => {
    setShowLegalModal(false);
    refetch();
  };

  // Admin routes don't use the sidebar layout
  if (isAdminRoute) {
    return (
      <Switch>
        <Route path="/admin" component={AdminDashboard} />
        <Route path="/admin/users" component={AdminUsers} />
        <Route path="/admin/broadcasts" component={AdminBroadcasts} />
        <Route path="/admin/feedback" component={AdminFeedback} />
        <Route path="/admin/chats" component={AdminChats} />
        <Route path="/admin/:rest*" component={AdminDashboard} />
      </Switch>
    );
  }

  return (
    <>
      <LegalAcceptanceModal open={showLegalModal} onAccepted={handleLegalAccepted} />
      <div className="flex h-screen">
        <Sidebar />
        <div className="flex-1 overflow-auto relative">
          <PaperTradingBanner />
          <SupportWidget />
        <Switch>          <Route path={"/"} component={Home} />
          <Route path={"/settings"} component={Settings} />
          <Route path="/inbox" component={Inbox} />
          <Route path="/action-items" component={ActionItems} />
          <Route path={"/csp"} component={CSPDashboard} />
          <Route path={"/cc"} component={CCDashboard} />
          <Route path={"/pmcc"} component={PMCCDashboard} />
          <Route path={"/performance"} component={Performance} />
          <Route path={"/404"} component={NotFound} />
          {/* Final fallback route */}
          <Route component={NotFound} />
        </Switch>
      </div>
    </div>
    </>
  );
}

// NOTE: About Theme
// - First choose a default theme according to your design style (dark or light bg), than change color palette in index.css
//   to keep consistent foreground/background color across components
// - If you want to make theme switchable, pass `switchable` ThemeProvider and use `useTheme` hook

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider
        defaultTheme="dark"
        switchable
      >
        <AccountProvider>
          <TooltipProvider>
            <Toaster position="bottom-left" />
            <Router />
          </TooltipProvider>
        </AccountProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
