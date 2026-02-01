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
import { Sidebar } from "./components/Sidebar";
import { PaperTradingBanner } from "./components/PaperTradingBanner";

function Router() {
  const [location] = useLocation();
  const isAdminRoute = location.startsWith('/admin');

  // Admin routes don't use the sidebar layout
  if (isAdminRoute) {
    return (
      <Switch>
        <Route path="/admin" component={AdminDashboard} />
        <Route path="/admin/users" component={AdminUsers} />
        <Route path="/admin/:rest*" component={AdminDashboard} />
      </Switch>
    );
  }

  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex-1 overflow-auto relative">
        <PaperTradingBanner />
        <Switch>
          <Route path={"/"} component={Home} />
          <Route path={"/settings"} component={Settings} />
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
