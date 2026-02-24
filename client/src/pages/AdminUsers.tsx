import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Search, UserPlus, Trash2, RefreshCw, ArrowUpCircle, Eye, CheckCircle, XCircle, Mail } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import { AdminPageHeader } from "@/components/AdminPageHeader";

export function AdminUsers() {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [tierFilter, setTierFilter] = useState<string>("all");
  const [deleteUserId, setDeleteUserId] = useState<number | null>(null);
  const [resetUserId, setResetUserId] = useState<number | null>(null);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteNote, setInviteNote] = useState("");

  // Fetch users
  const { data: users, isLoading, refetch } = trpc.admin.listUsers.useQuery({
    search: searchQuery || undefined,
    tier: tierFilter === "all" ? undefined : tierFilter as any,
  });

  // Mutations
  const deleteUser = trpc.admin.deleteUser.useMutation({
    onSuccess: () => {
      toast({ title: "User deleted successfully" });
      refetch();
      setDeleteUserId(null);
    },
    onError: (error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const resetUserData = trpc.admin.resetUserData.useMutation({
    onSuccess: () => {
      toast({ title: "User data reset successfully" });
      refetch();
      setResetUserId(null);
    },
    onError: (error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const upgradeUserTier = trpc.admin.upgradeUserTier.useMutation({
    onSuccess: () => {
      toast({ title: "User tier upgraded successfully" });
      refetch();
    },
    onError: (error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const updateUserRole = trpc.admin.updateUserRole.useMutation({
    onSuccess: () => {
      toast({ title: "User role updated successfully" });
      refetch();
    },
    onError: (error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const approveUser = trpc.admin.approveUser.useMutation({
    onSuccess: () => {
      toast({ title: "User approved successfully" });
      refetch();
    },
    onError: (error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const sendInvite = trpc.admin.sendInvite.useMutation({
    onSuccess: (data) => {
      toast({ 
        title: "Invite sent successfully", 
        description: `Invite link: ${data.inviteLink}` 
      });
      setShowInviteModal(false);
      setInviteEmail("");
      setInviteNote("");
    },
    onError: (error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const getTierBadge = (tier: string | null) => {
    const variants: Record<string, { variant: "default" | "secondary" | "destructive" | "outline", label: string }> = {
      free_trial: { variant: "outline", label: "Free Trial" },
      starter: { variant: "secondary", label: "Starter" },
      wheel: { variant: "default", label: "Wheel" },
      advanced: { variant: "default", label: "Advanced" },
    };
    const config = variants[tier || 'free_trial'] || { variant: "outline" as const, label: tier || 'Unknown' };
    return <Badge variant={config.variant}>{config.label}</Badge>;
  };

  const formatDate = (date: any) => {
    if (!date) return "Never";
    return new Date(date).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  return (
    <div>
      <AdminPageHeader
        title="User Management"
        description="Manage registered users, view details, and perform administrative actions"
        breadcrumbs={[
          { label: "Admin Panel", href: "/admin" },
          { label: "Users" },
        ]}
      />
      <div className="p-8">

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <Card>
          <CardHeader className="pb-3">
            <CardDescription>Total Users</CardDescription>
            <CardTitle className="text-3xl">{users?.length || 0}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardDescription>Free Trial</CardDescription>
            <CardTitle className="text-3xl">
              {users?.filter((u) => u.subscriptionTier === "free_trial").length || 0}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardDescription>Paid Users</CardDescription>
            <CardTitle className="text-3xl">
              {users?.filter((u) => u.subscriptionTier !== "free_trial").length || 0}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardDescription>Active (7d)</CardDescription>
            <CardTitle className="text-3xl">
              {users?.filter((u) => {
                const lastSignIn = new Date(u.lastSignedIn || 0);
                const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
                return lastSignIn > sevenDaysAgo;
              }).length || 0}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      {/* Filters */}
      <Card className="mb-6">
        <CardContent className="pt-6">
          <div className="flex flex-col md:flex-row gap-4 items-end">
            <Button
              onClick={() => setShowInviteModal(true)}
              className="bg-orange-600 hover:bg-orange-700 md:order-last"
            >
              <Mail className="h-4 w-4 mr-2" />
              Invite New User
            </Button>
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by name or email..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={tierFilter} onValueChange={setTierFilter}>
              <SelectTrigger className="w-full md:w-[200px]">
                <SelectValue placeholder="Filter by tier" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Tiers</SelectItem>
                <SelectItem value="free_trial">Free Trial</SelectItem>
                <SelectItem value="starter">Starter</SelectItem>
                <SelectItem value="wheel">Wheel</SelectItem>
                <SelectItem value="advanced">Advanced</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* User Table */}
      <Card>
        <CardHeader>
          <CardTitle>All Users</CardTitle>
          <CardDescription>
            {users?.length || 0} user{users?.length !== 1 ? "s" : ""} found
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Loading users...</div>
          ) : !users || users.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">No users found</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Approval Status</TableHead>
                  <TableHead>Tier</TableHead>
                  <TableHead>Legal Agreements</TableHead>
                  <TableHead>Registered</TableHead>
                  <TableHead>Last Active</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell className="font-medium">{user.name}</TableCell>
                    <TableCell>{user.email}</TableCell>
                    <TableCell>
                      <Select
                        value={user.role}
                        onValueChange={(role: any) =>
                          updateUserRole.mutate({ userId: user.id, role })
                        }
                      >
                        <SelectTrigger className="w-[140px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="user">User</SelectItem>
                          <SelectItem value="admin">Admin</SelectItem>
                          <SelectItem value="vip">VIP</SelectItem>
                          <SelectItem value="partner">Partner</SelectItem>
                          <SelectItem value="beta_tester">Beta Tester</SelectItem>
                          <SelectItem value="lifetime">Lifetime</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      {user.isApproved ? (
                        <Badge variant="default" className="bg-green-600 hover:bg-green-700">
                          <CheckCircle className="h-3 w-3 mr-1" />
                          Approved
                        </Badge>
                      ) : (
                        <Badge variant="destructive">
                          <XCircle className="h-3 w-3 mr-1" />
                          Pending
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>{getTierBadge(user.subscriptionTier)}</TableCell>
                    <TableCell>
                      {user.acceptedTermsAt && user.acceptedRiskDisclosureAt ? (
                        <div className="flex flex-col gap-1">
                          <Badge variant="default" className="bg-green-600 hover:bg-green-700">
                            ✓ Accepted
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {formatDate(user.acceptedTermsAt)}
                          </span>
                          {user.acceptedTermsIp && (
                            <span className="text-xs text-muted-foreground">
                              IP: {user.acceptedTermsIp}
                            </span>
                          )}
                        </div>
                      ) : (
                        <Badge variant="destructive">Pending</Badge>
                      )}
                    </TableCell>
                    <TableCell>{formatDate(user.createdAt)}</TableCell>
                    <TableCell>
                      {formatDate(user.lastSignedIn)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        {!user.isApproved && (
                          <Button
                            variant="default"
                            size="sm"
                            className="bg-green-600 hover:bg-green-700"
                            onClick={() => approveUser.mutate({ userId: user.id })}
                          >
                            <CheckCircle className="h-4 w-4 mr-1" />
                            Approve
                          </Button>
                        )}
                        <Link href={`/admin/users/${user.id}`}>
                          <Button variant="ghost" size="sm">
                            <Eye className="h-4 w-4" />
                          </Button>
                        </Link>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setResetUserId(user.id)}
                        >
                          <RefreshCw className="h-4 w-4" />
                        </Button>
                        {user.subscriptionTier === "free_trial" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              upgradeUserTier.mutate({ userId: user.id, tier: "wheel_trading" })
                            }
                          >
                            <ArrowUpCircle className="h-4 w-4" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDeleteUserId(user.id)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteUserId !== null} onOpenChange={() => setDeleteUserId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete User</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the user and all their data (watchlist, presets, trades, positions).
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteUserId && deleteUser.mutate({ userId: deleteUserId })}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Reset Confirmation Dialog */}
      <AlertDialog open={resetUserId !== null} onOpenChange={() => setResetUserId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset User Data</AlertDialogTitle>
            <AlertDialogDescription>
              This will clear the user's watchlist, presets, trades, and positions, then re-seed with default data.
              The user account will remain active.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => resetUserId && resetUserData.mutate({ userId: resetUserId })}
            >
              Reset Data
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Invite New User Dialog */}
      <AlertDialog open={showInviteModal} onOpenChange={setShowInviteModal}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Invite New User</AlertDialogTitle>
            <AlertDialogDescription>
              Send an invite link to a new user. They'll have 7 days to accept the invitation.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <label htmlFor="invite-email" className="text-sm font-medium">
                Email Address *
              </label>
              <Input
                id="invite-email"
                type="email"
                placeholder="user@example.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <label htmlFor="invite-note" className="text-sm font-medium">
                Note (Optional)
              </label>
              <Input
                id="invite-note"
                placeholder="e.g., Paid customer, Beta tester, etc."
                value={inviteNote}
                onChange={(e) => setInviteNote(e.target.value)}
                className="mt-1"
              />
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => {
              setInviteEmail("");
              setInviteNote("");
            }}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => sendInvite.mutate({ email: inviteEmail, note: inviteNote })}
              disabled={!inviteEmail || !inviteEmail.includes('@')}
              className="bg-orange-600 hover:bg-orange-700"
            >
              <Mail className="h-4 w-4 mr-2" />
              Send Invite
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      </div>
    </div>
  );
}
