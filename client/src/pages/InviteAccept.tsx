import { useEffect, useState } from "react";
import { useRoute, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle, XCircle, Loader2, Mail } from "lucide-react";
import { getLoginUrl } from "@/const";

export default function InviteAccept() {
  const [, params] = useRoute("/invite/:code");
  const [, setLocation] = useLocation();
  const [isAccepting, setIsAccepting] = useState(false);
  
  const code = params?.code || "";

  // Validate invite code
  const { data: validation, isLoading } = trpc.admin.validateInviteCode.useQuery(
    { code },
    { enabled: !!code }
  );

  // Accept invite mutation
  const acceptInvite = trpc.admin.acceptInvite.useMutation({
    onSuccess: () => {
      // Redirect to dashboard after successful acceptance
      setTimeout(() => {
        setLocation("/");
      }, 2000);
    },
  });

  // Check if user is logged in
  const { data: user } = trpc.auth.me.useQuery();

  // Auto-accept if user is logged in and invite is valid
  useEffect(() => {
    if (user && validation?.valid && !isAccepting && !acceptInvite.isSuccess) {
      setIsAccepting(true);
      acceptInvite.mutate({ code });
    }
  }, [user, validation, code, isAccepting, acceptInvite]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-orange-50 to-orange-100 dark:from-gray-900 dark:to-gray-800">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6">
            <div className="flex flex-col items-center gap-4 py-8">
              <Loader2 className="h-12 w-12 animate-spin text-orange-600" />
              <p className="text-muted-foreground">Validating invite...</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!validation?.valid) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-orange-50 to-orange-100 dark:from-gray-900 dark:to-gray-800 p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="p-3 rounded-full bg-red-100 dark:bg-red-900/20">
                <XCircle className="h-6 w-6 text-red-600 dark:text-red-400" />
              </div>
              <div>
                <CardTitle>Invalid Invite</CardTitle>
                <CardDescription>This invitation link is not valid</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-6">
              {validation?.message || "This invite link has expired or is invalid. Please contact the person who invited you for a new link."}
            </p>
            <Button
              onClick={() => setLocation("/")}
              variant="outline"
              className="w-full"
            >
              Go to Home
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (acceptInvite.isSuccess) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-orange-50 to-orange-100 dark:from-gray-900 dark:to-gray-800 p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="p-3 rounded-full bg-green-100 dark:bg-green-900/20">
                <CheckCircle className="h-6 w-6 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <CardTitle>Welcome to Prosper Trading!</CardTitle>
                <CardDescription>Your account has been approved</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-6">
              You now have full access to the platform. Redirecting you to the dashboard...
            </p>
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-8 w-8 animate-spin text-orange-600" />
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (acceptInvite.isError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-orange-50 to-orange-100 dark:from-gray-900 dark:to-gray-800 p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="p-3 rounded-full bg-red-100 dark:bg-red-900/20">
                <XCircle className="h-6 w-6 text-red-600 dark:text-red-400" />
              </div>
              <div>
                <CardTitle>Error Accepting Invite</CardTitle>
                <CardDescription>Something went wrong</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-6">
              {acceptInvite.error?.message || "Unable to accept the invitation. Please try again or contact support."}
            </p>
            <Button
              onClick={() => setLocation("/")}
              variant="outline"
              className="w-full"
            >
              Go to Home
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // User not logged in - show login prompt
  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-orange-50 to-orange-100 dark:from-gray-900 dark:to-gray-800 p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="p-3 rounded-full bg-orange-100 dark:bg-orange-900/20">
                <Mail className="h-6 w-6 text-orange-600 dark:text-orange-400" />
              </div>
              <div>
                <CardTitle>You're Invited!</CardTitle>
                <CardDescription>Join Prosper Trading Platform</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-lg p-4">
                <p className="text-sm font-medium text-orange-900 dark:text-orange-100 mb-2">
                  Invitation for:
                </p>
                <p className="text-sm text-orange-700 dark:text-orange-300">
                  {validation.email}
                </p>
              </div>

              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  You've been invited to join Prosper Trading, a premium platform for options trading analytics and automation.
                </p>
                <p className="text-sm text-muted-foreground">
                  Sign in with your account to accept this invitation and get started.
                </p>
              </div>

              <Button
                onClick={() => {
                  window.location.href = getLoginUrl();
                }}
                className="w-full bg-orange-600 hover:bg-orange-700"
              >
                Sign In to Accept Invitation
              </Button>

              <p className="text-xs text-center text-muted-foreground">
                Expires: {validation.expiresAt ? new Date(validation.expiresAt).toLocaleDateString() : 'N/A'}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Accepting invite...
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-orange-50 to-orange-100 dark:from-gray-900 dark:to-gray-800 p-4">
      <Card className="w-full max-w-md">
        <CardContent className="pt-6">
          <div className="flex flex-col items-center gap-4 py-8">
            <Loader2 className="h-12 w-12 animate-spin text-orange-600" />
            <p className="text-muted-foreground">Accepting invitation...</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
