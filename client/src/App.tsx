import { Toaster } from "@/components/ui/sonner";
import { PullToRefresh } from "./components/PullToRefresh";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch, useLocation } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { AccountProvider } from "./contexts/AccountContext";
import Home from "./pages/Home";
import Settings from "./pages/Settings";
import Subscription from "./pages/Subscription";
import CSPDashboard from "./pages/CSPDashboard";
import CCDashboard from "./pages/CCDashboard";
import PMCCDashboard from "./pages/PMCCDashboard";
import IronCondorDashboard from "./pages/IronCondorDashboard";
import GtcOrders from "./pages/GtcOrders";
import Performance from "./pages/Performance";
import StrategyAdvisorPage from "./pages/StrategyAdvisorPage";
import PortfolioAdvisor from "./pages/PortfolioAdvisor";
import AutomationDashboard from './pages/AutomationDashboard';
// WorkingOrdersPage and OpenPositionsPage replaced by tabs on AutomationDashboard
import PortfolioCommandCenter from "./pages/PortfolioCommandCenter";
import StockScreener from "./pages/StockScreener";

import { Redirect } from "wouter";
import PendingApproval from "./pages/PendingApproval";
import InviteAccept from "./pages/InviteAccept";
import { AdminDashboard } from "./pages/AdminDashboard";
import { AdminUsers } from "./pages/AdminUsers";
import { AdminBroadcasts } from "./pages/AdminBroadcasts";
import { AdminFeedback } from "./pages/AdminFeedback";
import AdminChats from "./pages/AdminChats";
import Inbox from "./pages/Inbox";
import { Sidebar } from "./components/Sidebar";
import { PaperTradingBanner } from "./components/PaperTradingBanner";
import { TrialStatusBanner } from "./components/TrialStatusBanner";
import { SupportWidget } from "./components/SupportWidget";
import { TradingActivityLog } from "./components/TradingActivityLog";
import { LegalAcceptanceModal } from "./components/LegalAcceptanceModal";
import { SupportProvider } from "./contexts/SupportContext";
import { TrialExpirationModal } from "./components/TrialExpirationModal";
import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { useHeartbeat } from "@/hooks/useHeartbeat";

function Router() {
  const [location] = useLocation();
  const isAdminRoute = location.startsWith('/admin');
  const [showLegalModal, setShowLegalModal] = useState(false);
  const [showTrialModal, setShowTrialModal] = useState(false);
  const { data: user, refetch } = trpc.auth.me.useQuery();
  const subscriptionStatus = trpc.stripe.getSubscriptionStatus.useQuery(undefined, { enabled: !!user });

  // Portfolio Safety: fetch violation count for browser tab title badge
  const { data: violationData } = trpc.iraSafety.scanViolations.useQuery(
    undefined,
    {
      enabled: !!user,
      refetchInterval: 5 * 60 * 1000, // refresh every 5 minutes
      staleTime: 4 * 60 * 1000,
    }
  );
  const totalViolations = violationData
    ? (violationData.criticalCount ?? 0) + (violationData.warningCount ?? 0)
    : 0;

  // Update browser tab title with violation count
  useEffect(() => {
    const appTitle = import.meta.env.VITE_APP_TITLE || 'Prosper Trading Dashboard';
    if (totalViolations > 0) {
      document.title = `(${totalViolations}) ${appTitle}`;
    } else {
      document.title = appTitle;
    }
  }, [totalViolations]);

  // Enable heartbeat in development to prevent sandbox hibernation
  const isDevelopment = import.meta.env.DEV;
  useHeartbeat(isDevelopment);

  useEffect(() => {
    if (user && !user.acceptedTermsAt && !user.acceptedRiskDisclosureAt) {
      setShowLegalModal(true);
    }
  }, [user]);

  // Show trial expiration modal when trial is expiring or expired
  // VIP users bypass this modal entirely
  useEffect(() => {
    if (!subscriptionStatus.data) return;
    
    const { tier, trialEndsAt, isVipActive } = subscriptionStatus.data;
    if (tier !== 'free_trial' || !trialEndsAt || isVipActive) return;

    const now = new Date();
    const trialEnd = new Date(trialEndsAt);
    const daysRemaining = Math.ceil((trialEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    // Show modal if trial expires in 3 days or less, or has expired
    if (daysRemaining <= 3) {
      setShowTrialModal(true);
    }
  }, [subscriptionStatus.data]);

  const handleLegalAccepted = () => {
    setShowLegalModal(false);
    refetch();
  };

  // Check if user is approved (admins bypass this check)
  const isApproved = user?.isApproved || user?.role === 'admin';
  const isPendingApprovalRoute = location === '/pending-approval';
  const isInviteRoute = location.startsWith('/invite/');

  // Allow invite routes without approval check
  if (isInviteRoute) {
    return (
      <Switch>
        <Route path="/invite/:code" component={InviteAccept} />
      </Switch>
    );
  }

  // Redirect unapproved users to pending approval page
  if (user && !isApproved && !isAdminRoute && !isPendingApprovalRoute) {
    return <PendingApproval />;
  }

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
      <TrialExpirationModal 
        open={showTrialModal && !subscriptionStatus.data?.isVipActive} 
        daysRemaining={subscriptionStatus.data?.trialEndsAt ? Math.max(0, Math.ceil((new Date(subscriptionStatus.data.trialEndsAt).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24))) : 0}
        onClose={() => setShowTrialModal(false)}
      />
      <div className="flex h-screen">
        <Sidebar />
        <div className="flex-1 overflow-auto relative">
          <TrialStatusBanner />
          <PaperTradingBanner />
          <SupportWidget />
          <TradingActivityLog />
        <Switch>
          <Route path={"/"} component={Home} />
          <Route path={"/screener"} component={StockScreener} />
          <Route path={"/portfolio"} component={PortfolioCommandCenter} />
          <Route path={"/settings"} component={Settings} />
          <Route path={"/subscription"} component={Subscription} />
          <Route path="/inbox" component={Inbox} />
          {/* /action-items and /portfolio-advisor now live inside Portfolio Command Center tabs */}
          <Route path="/action-items"><Redirect to="/portfolio" /></Route>
          <Route path="/portfolio-advisor"><Redirect to="/portfolio" /></Route>
          <Route path="/strategy-advisor" component={StrategyAdvisorPage} />
          <Route path="/automation" component={AutomationDashboard} />
          <Route path="/working-orders"><Redirect to="/automation?tab=working-orders" /></Route>
          <Route path="/open-positions"><Redirect to="/automation?tab=open-positions" /></Route>
          <Route path={"/csp"} component={CSPDashboard} />
          <Route path={"/cc"} component={CCDashboard} />
          <Route path={"/iron-condor"} component={IronCondorDashboard} />
          <Route path={"/gtc-orders"} component={GtcOrders} />
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
        <SupportProvider>
          <AccountProvider>
            <TooltipProvider>
              <PullToRefresh />
              <Toaster position="bottom-left" />
              <Router />
            </TooltipProvider>
          </AccountProvider>
        </SupportProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
