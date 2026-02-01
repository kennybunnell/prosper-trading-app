import { Link } from "wouter";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface Breadcrumb {
  label: string;
  href?: string;
}

interface AdminPageHeaderProps {
  title: string;
  description?: string;
  breadcrumbs: Breadcrumb[];
  actions?: React.ReactNode;
}

export function AdminPageHeader({ title, description, breadcrumbs, actions }: AdminPageHeaderProps) {
  return (
    <div className="border-b bg-card/50 backdrop-blur-sm sticky top-0 z-10">
      <div className="px-8 py-6">
        {/* Breadcrumbs */}
        <div className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
          {breadcrumbs.map((crumb, index) => (
            <div key={index} className="flex items-center gap-2">
              {crumb.href ? (
                <Link 
                  href={crumb.href}
                  className="hover:text-foreground transition-colors"
                >
                  {crumb.label}
                </Link>
              ) : (
                <span className="text-foreground font-medium">{crumb.label}</span>
              )}
              {index < breadcrumbs.length - 1 && (
                <ChevronRight className="h-4 w-4" />
              )}
            </div>
          ))}
        </div>

        {/* Title and Actions */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
            {description && (
              <p className="text-muted-foreground mt-2">{description}</p>
            )}
          </div>
          {actions && (
            <div className="flex items-center gap-2">
              {actions}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
