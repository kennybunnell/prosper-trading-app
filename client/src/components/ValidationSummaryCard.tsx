/**
 * Validation Summary Card
 * 
 * Displays validation status summary for orders in the Order Preview Dialog
 */

import { AlertTriangle, CheckCircle2, XCircle, RefreshCw, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ValidationSummary } from "../../../shared/validation-types";

interface ValidationSummaryCardProps {
  summary: ValidationSummary | null;
  isValidating: boolean;
  onRefresh: () => void;
}

export function ValidationSummaryCard({
  summary,
  isValidating,
  onRefresh,
}: ValidationSummaryCardProps) {
  if (!summary) {
    return null;
  }

  const hasErrors = summary.errors > 0;
  const hasWarnings = summary.warnings > 0;
  const allValid = summary.valid === summary.total && !hasErrors && !hasWarnings;

  return (
    <div className={`border rounded-lg p-4 ${
      hasErrors ? 'bg-red-500/10 border-red-500/30' :
      hasWarnings ? 'bg-amber-500/10 border-amber-500/30' :
      'bg-green-500/10 border-green-500/30'
    }`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 flex-1">
          {/* Status Icon */}
          <div className="mt-0.5">
            {hasErrors && <XCircle className="h-6 w-6 text-red-600" />}
            {!hasErrors && hasWarnings && <AlertTriangle className="h-6 w-6 text-amber-600" />}
            {allValid && <CheckCircle2 className="h-6 w-6 text-green-600" />}
          </div>

          {/* Summary Content */}
          <div className="flex-1">
            <h3 className="font-semibold text-lg mb-1">
              {hasErrors && "Validation Errors Detected"}
              {!hasErrors && hasWarnings && "Validation Warnings"}
              {allValid && "All Orders Validated"}
            </h3>
            
            <div className="text-sm space-y-1">
              {/* Stats */}
              <div className="flex flex-wrap gap-4">
                <div className="flex items-center gap-1.5">
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                  <span>{summary.valid} Valid</span>
                </div>
                
                {summary.warnings > 0 && (
                  <div className="flex items-center gap-1.5">
                    <AlertTriangle className="h-4 w-4 text-amber-600" />
                    <span>{summary.warnings} Warnings</span>
                  </div>
                )}
                
                {summary.errors > 0 && (
                  <div className="flex items-center gap-1.5">
                    <XCircle className="h-4 w-4 text-red-600" />
                    <span>{summary.errors} Errors</span>
                  </div>
                )}
              </div>

              {/* Last Validated */}
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <Clock className="h-3.5 w-3.5" />
                <span>Last validated: {new Date(summary.timestamp).toLocaleTimeString()}</span>
              </div>

              {/* Messages */}
              {hasErrors && (
                <p className="text-red-700 dark:text-red-300 mt-2">
                  Some orders have critical issues and cannot be submitted. Please review the errors below.
                </p>
              )}
              {!hasErrors && hasWarnings && (
                <p className="text-amber-700 dark:text-amber-300 mt-2">
                  Some orders have warnings but can still be submitted. Review the warnings for potential issues.
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Refresh Button */}
        <Button
          variant="outline"
          size="sm"
          onClick={onRefresh}
          disabled={isValidating}
          className="shrink-0"
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${isValidating ? 'animate-spin' : ''}`} />
          {isValidating ? 'Validating...' : 'Refresh'}
        </Button>
      </div>
    </div>
  );
}
