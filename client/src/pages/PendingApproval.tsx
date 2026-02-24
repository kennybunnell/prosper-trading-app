import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AlertCircle, Clock, Mail, Shield } from 'lucide-react';
import { useAuth } from '@/_core/hooks/useAuth';
import { trpc } from '@/lib/trpc';

export default function PendingApproval() {
  const { user, logout } = useAuth();
  const logoutMutation = trpc.auth.logout.useMutation();

  const handleLogout = async () => {
    await logoutMutation.mutateAsync();
    logout();
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-4">
      <Card className="w-full max-w-2xl border-orange-500/20 bg-slate-900/90 backdrop-blur">
        <CardHeader className="text-center space-y-4">
          <div className="mx-auto w-16 h-16 rounded-full bg-orange-500/10 flex items-center justify-center">
            <Clock className="w-8 h-8 text-orange-500" />
          </div>
          <CardTitle className="text-3xl font-bold text-white">
            Access Pending Approval
          </CardTitle>
          <CardDescription className="text-lg text-slate-300">
            Your account is awaiting administrator approval
          </CardDescription>
        </CardHeader>
        
        <CardContent className="space-y-6">
          {/* User Info */}
          <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700">
            <div className="flex items-center gap-3 mb-2">
              <Mail className="w-5 h-5 text-blue-400" />
              <span className="text-slate-300 font-medium">Registered Email</span>
            </div>
            <p className="text-white text-lg ml-8">{user?.email || 'Not provided'}</p>
          </div>

          {/* Status Message */}
          <div className="bg-orange-500/10 border border-orange-500/20 rounded-lg p-6 space-y-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-6 h-6 text-orange-500 flex-shrink-0 mt-0.5" />
              <div className="space-y-2">
                <h3 className="font-semibold text-white text-lg">What happens next?</h3>
                <ul className="space-y-2 text-slate-300">
                  <li className="flex items-start gap-2">
                    <span className="text-orange-500 mt-1">•</span>
                    <span>An administrator will review your account within 24-48 hours</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-orange-500 mt-1">•</span>
                    <span>You'll receive an email notification once your account is approved</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-orange-500 mt-1">•</span>
                    <span>After approval, you'll have full access to all features</span>
                  </li>
                </ul>
              </div>
            </div>
          </div>

          {/* Security Note */}
          <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <Shield className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
              <div>
                <h4 className="font-medium text-white mb-1">Why is approval required?</h4>
                <p className="text-sm text-slate-400">
                  Prosper Trading is currently in controlled rollout to ensure platform stability and provide 
                  personalized onboarding for each user. This helps us maintain the highest quality of service 
                  as we scale.
                </p>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-col sm:flex-row gap-3 pt-4">
            <Button
              onClick={handleLogout}
              variant="outline"
              className="flex-1"
            >
              Sign Out
            </Button>
            <Button
              onClick={() => window.location.reload()}
              className="flex-1 bg-orange-600 hover:bg-orange-700"
            >
              Check Approval Status
            </Button>
          </div>

          {/* Support */}
          <div className="text-center pt-4 border-t border-slate-700">
            <p className="text-sm text-slate-400">
              Questions? Contact us at{' '}
              <a href="mailto:support@prospertrading.biz" className="text-orange-500 hover:text-orange-400">
                support@prospertrading.biz
              </a>
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
