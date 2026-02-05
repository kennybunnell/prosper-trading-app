/**
 * Validation Details Row
 * 
 * Expandable row showing detailed validation checks for an order
 */

import { ChevronDown, ChevronUp, CheckCircle2, AlertTriangle, XCircle, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { OrderValidationResult, ValidationCheck } from "../../../shared/validation-types";

interface ValidationDetailsRowProps {
  validation: OrderValidationResult | null;
  isExpanded: boolean;
  onToggle: () => void;
}

export function ValidationDetailsRow({ validation, isExpanded, onToggle }: ValidationDetailsRowProps) {
  if (!validation || validation.checks.length === 0) {
    return null;
  }

  const getCheckIcon = (check: ValidationCheck) => {
    switch (check.status) {
      case 'valid':
        return <CheckCircle2 className="h-4 w-4 text-green-600" />;
      case 'warning':
        return <AlertTriangle className="h-4 w-4 text-amber-600" />;
      case 'error':
        return <XCircle className="h-4 w-4 text-red-600" />;
      default:
        return <Info className="h-4 w-4 text-blue-600" />;
    }
  };

  return (
    <tr>
      <td colSpan={9} className="p-0">
        <div className="border-t bg-muted/30 p-4">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-semibold">Validation Details</h4>
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                onToggle();
              }}
              className="h-6 px-2"
            >
              {isExpanded ? (
                <>
                  <ChevronUp className="h-4 w-4 mr-1" />
                  Hide Details
                </>
              ) : (
                <>
                  <ChevronDown className="h-4 w-4 mr-1" />
                  Show Details
                </>
              )}
            </Button>
          </div>

          {isExpanded && (
            <div className="space-y-2">
              {validation.checks.map((check, idx) => (
                <div
                  key={idx}
                  className={`flex items-start gap-2 p-2 rounded ${
                    check.status === 'error' ? 'bg-red-500/10' :
                    check.status === 'warning' ? 'bg-amber-500/10' :
                    'bg-green-500/10'
                  }`}
                >
                  <div className="mt-0.5">{getCheckIcon(check)}</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">{check.name}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{check.message}</div>
                  </div>
                </div>
              ))}

              {/* Data Freshness Info */}
              {validation.dataAge !== undefined && (
                <div className="mt-3 p-2 rounded bg-blue-500/10 border border-blue-500/30">
                  <div className="text-xs text-muted-foreground">
                    Market data age: {validation.dataAge < 60 ? `${validation.dataAge}s` : `${Math.floor(validation.dataAge / 60)}m`}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </td>
    </tr>
  );
}
