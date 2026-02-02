import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertTriangle, FileText, Shield } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useToast } from "@/hooks/use-toast";

interface LegalAcceptanceModalProps {
  open: boolean;
  onAccepted: () => void;
}

export function LegalAcceptanceModal({ open, onAccepted }: LegalAcceptanceModalProps) {
  const { toast } = useToast();
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [acceptedRiskDisclosure, setAcceptedRiskDisclosure] = useState(false);
  const [termsContent, setTermsContent] = useState("");
  const [riskContent, setRiskContent] = useState("");

  const acceptLegalMutation = trpc.auth.acceptLegalAgreements.useMutation({
    onSuccess: () => {
      toast({
        title: "Legal agreements accepted",
        description: "You can now access the platform",
      });
      onAccepted();
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message,
      });
    },
  });

  // Load legal documents
  useState(() => {
    fetch("/terms-of-service.md")
      .then((res) => res.text())
      .then(setTermsContent)
      .catch(console.error);

    fetch("/risk-disclosure.md")
      .then((res) => res.text())
      .then(setRiskContent)
      .catch(console.error);
  });

  const handleAccept = () => {
    if (!acceptedTerms || !acceptedRiskDisclosure) {
      toast({
        variant: "destructive",
        title: "Acceptance required",
        description: "You must accept both agreements to continue",
      });
      return;
    }

    acceptLegalMutation.mutate();
  };

  const canAccept = acceptedTerms && acceptedRiskDisclosure;

  return (
    <Dialog open={open} onOpenChange={() => {}} modal>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-2xl">
            <Shield className="h-6 w-6 text-orange-500" />
            Legal Agreements Required
          </DialogTitle>
          <DialogDescription>
            Please read and accept the following agreements before accessing the platform
          </DialogDescription>
        </DialogHeader>

        <div className="bg-orange-500/10 border border-orange-500/30 rounded-lg p-4 mb-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-orange-500 flex-shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-semibold text-orange-500 mb-1">Important Notice</p>
              <p className="text-muted-foreground">
                This platform is an educational tool. You are responsible for all trading decisions and must use your own brokerage API credentials.
                Trading involves substantial risk of loss.
              </p>
            </div>
          </div>
        </div>

        <Tabs defaultValue="terms" className="flex-1 overflow-hidden flex flex-col">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="terms" className="gap-2">
              <FileText className="h-4 w-4" />
              Terms of Service
            </TabsTrigger>
            <TabsTrigger value="risk" className="gap-2">
              <AlertTriangle className="h-4 w-4" />
              Risk Disclosure
            </TabsTrigger>
          </TabsList>

          <TabsContent value="terms" className="flex-1 overflow-hidden mt-4">
            <ScrollArea className="h-[400px] w-full rounded-md border p-4">
              <div className="prose prose-sm dark:prose-invert max-w-none">
                <pre className="whitespace-pre-wrap font-sans text-sm">{termsContent}</pre>
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="risk" className="flex-1 overflow-hidden mt-4">
            <ScrollArea className="h-[400px] w-full rounded-md border p-4">
              <div className="prose prose-sm dark:prose-invert max-w-none">
                <pre className="whitespace-pre-wrap font-sans text-sm">{riskContent}</pre>
              </div>
            </ScrollArea>
          </TabsContent>
        </Tabs>

        <div className="space-y-4 pt-4 border-t">
          <div className="flex items-start gap-3">
            <Checkbox
              id="terms"
              checked={acceptedTerms}
              onCheckedChange={(checked) => setAcceptedTerms(checked as boolean)}
            />
            <label htmlFor="terms" className="text-sm cursor-pointer leading-relaxed">
              I have read and agree to the <span className="font-semibold">Terms of Service</span>. I understand this is an educational platform
              and I am solely responsible for all trading decisions.
            </label>
          </div>

          <div className="flex items-start gap-3">
            <Checkbox
              id="risk"
              checked={acceptedRiskDisclosure}
              onCheckedChange={(checked) => setAcceptedRiskDisclosure(checked as boolean)}
            />
            <label htmlFor="risk" className="text-sm cursor-pointer leading-relaxed">
              I have read and understand the <span className="font-semibold">Risk Disclosure Statement</span>. I acknowledge that trading involves
              substantial risk of loss and I accept full responsibility for all risks.
            </label>
          </div>

          <Button
            onClick={handleAccept}
            disabled={!canAccept || acceptLegalMutation.isPending}
            className="w-full"
            size="lg"
          >
            {acceptLegalMutation.isPending ? "Processing..." : "I Accept - Continue to Platform"}
          </Button>

          <p className="text-xs text-center text-muted-foreground">
            By clicking "I Accept", you confirm that you have read, understood, and agree to be legally bound by these agreements.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
