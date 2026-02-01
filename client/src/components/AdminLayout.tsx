import { Link, useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { 
  LayoutDashboard, 
  Users, 
  MessageSquare, 
  Send, 
  BarChart3,
  Trophy,
  UserCog,
  Layers,
  Flag,
  FileText,
  Settings,
  LogOut,
  ArrowLeft
} from "lucide-react";
import { cn } from "@/lib/utils";

interface AdminLayoutProps {
  children: React.ReactNode;
}

export function AdminLayout({ children }: AdminLayoutProps) {
  const [location] = useLocation();
  const { user, logout } = useAuth();

  // Redirect if not admin
  if (user?.role !== 'admin') {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-4">Access Denied</h1>
          <p className="text-muted-foreground mb-4">You don't have permission to access the admin panel.</p>
          <Link href="/">
            <Button>Go to Dashboard</Button>
          </Link>
        </div>
      </div>
    );
  }

  const navigation = [
    {
      title: "Overview",
      items: [
        { name: "Dashboard", href: "/admin", icon: LayoutDashboard },
      ],
    },
    {
      title: "Management",
      items: [
        { name: "Users", href: "/admin/users", icon: Users },
        { name: "Feedback", href: "/admin/feedback", icon: MessageSquare },
        { name: "Broadcasts", href: "/admin/broadcasts", icon: Send },
      ],
    },
    {
      title: "Analytics",
      items: [
        { name: "Overview", href: "/admin/analytics", icon: BarChart3 },
      ],
    },
    {
      title: "Phase 2 Features",
      items: [
        { name: "Gamification", href: "/admin/gamification", icon: Trophy, badge: "Soon" },
        { name: "User Impersonation", href: "/admin/impersonation", icon: UserCog, badge: "Soon" },
        { name: "Cohort Analysis", href: "/admin/cohorts", icon: Layers, badge: "Soon" },
        { name: "Feature Flags", href: "/admin/feature-flags", icon: Flag, badge: "Soon" },
        { name: "Audit Log", href: "/admin/audit-log", icon: FileText, badge: "Soon" },
      ],
    },
  ];

  return (
    <div className="flex h-screen bg-background">
      {/* Sidebar */}
      <aside className="w-64 border-r bg-card flex flex-col">
        {/* Header */}
        <div className="p-6 border-b">
          <h1 className="text-xl font-bold">Admin Panel</h1>
          <p className="text-sm text-muted-foreground mt-1">{user?.name}</p>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto p-4 space-y-6">
          {navigation.map((section) => (
            <div key={section.title}>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                {section.title}
              </h3>
              <div className="space-y-1">
                {section.items.map((item) => {
                  const Icon = item.icon;
                  const isActive = location === item.href;
                  
                  return (
                    <Link 
                      key={item.name} 
                      href={item.href}
                      className={cn(
                        "flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors",
                        isActive
                          ? "bg-primary text-primary-foreground"
                          : "hover:bg-accent hover:text-accent-foreground"
                      )}
                    >
                      <Icon className="h-4 w-4" />
                      <span className="flex-1">{item.name}</span>
                      {('badge' in item) && item.badge && (
                        <span className="text-xs bg-yellow-500/20 text-yellow-600 dark:text-yellow-400 px-2 py-0.5 rounded">
                          {item.badge}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Footer */}
        <div className="p-4 border-t space-y-1">
          <Link 
            href="/"
            className="flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium bg-primary/10 hover:bg-primary/20 text-primary transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>Back to App</span>
          </Link>
          <Link 
            href="/settings"
            className="flex items-center gap-3 px-3 py-2 rounded-md text-sm hover:bg-accent hover:text-accent-foreground transition-colors"
          >
            <Settings className="h-4 w-4" />
            <span>Settings</span>
          </Link>
          <button
            onClick={logout}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm hover:bg-accent hover:text-accent-foreground transition-colors"
          >
            <LogOut className="h-4 w-4" />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  );
}
