import { useState, type ReactNode } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { MessageSquare, Send, CheckCircle, Clock, XCircle, Paperclip, Video, Archive, ArchiveRestore, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { AdminPageHeader } from "@/components/AdminPageHeader";

export function AdminFeedback() {
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [archivedView, setArchivedView] = useState<boolean>(false);
  const [selectedFeedbackId, setSelectedFeedbackId] = useState<number | null>(null);
  const [replyMessage, setReplyMessage] = useState("");
  const [replyVideoUrl, setReplyVideoUrl] = useState("");
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const utils = trpc.useUtils();

  // Fetch feedback list
  const { data: feedbackList, isLoading, refetch } = trpc.admin.listFeedback.useQuery({
    status: statusFilter === "all" ? undefined : (statusFilter as any),
    type: typeFilter === "all" ? undefined : (typeFilter as any),
    archived: archivedView,
  });

  // Fetch feedback detail
  const { data: feedbackDetail } = trpc.admin.getFeedbackDetail.useQuery(
    { feedbackId: selectedFeedbackId! },
    { enabled: !!selectedFeedbackId }
  );

  // Reply mutation
  const replyToFeedback = trpc.admin.replyToFeedback.useMutation({
    onSuccess: () => {
      toast({ title: "Reply sent successfully" });
      setReplyMessage("");
      setReplyVideoUrl("");
      refetch();
    },
    onError: (error) => {
      toast({ title: "Failed to send reply", description: error.message, variant: "destructive" });
    },
  });

  // Update status mutation
  const updateStatus = trpc.admin.updateFeedbackStatus.useMutation({
    onSuccess: () => {
      toast({ title: "Status updated successfully" });
      refetch();
    },
    onError: (error) => {
      toast({ title: "Failed to update status", description: error.message, variant: "destructive" });
    },
  });

  // Archive mutation
  const archiveFeedback = trpc.admin.archiveFeedback.useMutation({
    onSuccess: () => {
      toast({ title: "Feedback archived" });
      refetch();
      utils.admin.listFeedback.invalidate();
    },
    onError: (e) => toast({ title: "Failed to archive", description: e.message, variant: "destructive" }),
  });

  // Unarchive mutation
  const unarchiveFeedback = trpc.admin.unarchiveFeedback.useMutation({
    onSuccess: () => {
      toast({ title: "Feedback unarchived" });
      refetch();
      utils.admin.listFeedback.invalidate();
    },
    onError: (e) => toast({ title: "Failed to unarchive", description: e.message, variant: "destructive" }),
  });

  // Delete mutation
  const deleteFeedback = trpc.admin.deleteFeedback.useMutation({
    onSuccess: () => {
      toast({ title: "Feedback deleted" });
      setDeleteConfirmId(null);
      setSelectedFeedbackId(null);
      refetch();
      utils.admin.listFeedback.invalidate();
    },
    onError: (e) => toast({ title: "Failed to delete", description: e.message, variant: "destructive" }),
  });

  // Bulk archive mutation
  const bulkArchiveFeedback = trpc.admin.bulkArchiveFeedback.useMutation({
    onSuccess: (data) => {
      toast({ title: `Archived ${data.count} items` });
      setSelectedIds(new Set());
      refetch();
      utils.admin.listFeedback.invalidate();
    },
    onError: (e) => toast({ title: "Failed to bulk archive", description: e.message, variant: "destructive" }),
  });

  const handleReply = () => {
    if (!selectedFeedbackId || !replyMessage.trim()) {
      toast({ title: "Reply message required", variant: "destructive" });
      return;
    }
    replyToFeedback.mutate({
      feedbackId: selectedFeedbackId,
      message: replyMessage.trim(),
      videoUrl: replyVideoUrl.trim() || undefined,
    });
  };

  const handleStatusChange = (feedbackId: number, newStatus: string) => {
    updateStatus.mutate({ feedbackId, status: newStatus as any });
  };

  const toggleSelectAll = () => {
    if (!feedbackList) return;
    if (selectedIds.size === feedbackList.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(feedbackList.map((i: any) => i.feedback.id)));
    }
  };

  const toggleSelectOne = (id: number) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const formatDate = (date: any) => {
    if (!date) return "Unknown";
    return new Date(date).toLocaleString("en-US", {
      year: "numeric", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, { icon: any; variant: "default" | "secondary" | "outline" | "destructive"; label: string }> = {
      open: { icon: Clock, variant: "outline", label: "Open" },
      in_progress: { icon: Clock, variant: "secondary", label: "In Progress" },
      resolved: { icon: CheckCircle, variant: "default", label: "Resolved" },
      closed: { icon: XCircle, variant: "outline", label: "Closed" },
    };
    const config = variants[status] || { icon: Clock, variant: "outline" as const, label: status };
    const Icon = config.icon;
    return (
      <Badge variant={config.variant} className="gap-1">
        <Icon className="h-3 w-3" />
        {config.label}
      </Badge>
    );
  };

  const getTypeBadge = (type: string) => {
    const variants: Record<string, { variant: "default" | "secondary" | "outline" | "destructive"; label: string }> = {
      bug: { variant: "destructive", label: "Bug" },
      feature: { variant: "default", label: "Feature Request" },
      question: { variant: "secondary", label: "Question" },
      other: { variant: "outline", label: "Other" },
    };
    const config = variants[type] || { variant: "outline" as const, label: type };
    return <Badge variant={config.variant}>{config.label}</Badge>;
  };

  const getPriorityBadge = (priority: string) => {
    const variants: Record<string, { variant: "default" | "secondary" | "outline" | "destructive"; label: string }> = {
      low: { variant: "outline", label: "Low" },
      medium: { variant: "secondary", label: "Medium" },
      high: { variant: "destructive", label: "High" },
    };
    const config = variants[priority] || { variant: "outline" as const, label: priority };
    return <Badge variant={config.variant}>{config.label}</Badge>;
  };

  return (
    <div>
      <AdminPageHeader
        title="Feedback & Support"
        description="View and respond to user feedback, bug reports, and support requests"
        breadcrumbs={[
          { label: "Admin Panel", href: "/admin" },
          { label: "Feedback" },
        ]}
      />
      <div className="p-8 space-y-6">
        {/* Active / Archived tab switcher */}
        <Tabs value={archivedView ? "archived" : "active"} onValueChange={(v) => { setArchivedView(v === "archived"); setSelectedIds(new Set()); }}>
          <TabsList>
            <TabsTrigger value="active">
              <MessageSquare className="h-4 w-4 mr-2" />
              Active
            </TabsTrigger>
            <TabsTrigger value="archived">
              <Archive className="h-4 w-4 mr-2" />
              Archived
            </TabsTrigger>
          </TabsList>

          <TabsContent value="active" className="space-y-6 mt-4">
            <FeedbackContent
              feedbackList={feedbackList}
              isLoading={isLoading}
              statusFilter={statusFilter}
              setStatusFilter={setStatusFilter}
              typeFilter={typeFilter}
              setTypeFilter={setTypeFilter}
              selectedIds={selectedIds}
              toggleSelectAll={toggleSelectAll}
              toggleSelectOne={toggleSelectOne}
              setSelectedFeedbackId={setSelectedFeedbackId}
              getTypeBadge={getTypeBadge}
              getPriorityBadge={getPriorityBadge}
              getStatusBadge={getStatusBadge}
              formatDate={formatDate}
              isArchived={false}
              onArchive={(id) => archiveFeedback.mutate({ feedbackId: id })}
              onUnarchive={() => {}}
              onDeleteRequest={(id) => setDeleteConfirmId(id)}
              onBulkArchive={() => bulkArchiveFeedback.mutate({ feedbackIds: Array.from(selectedIds) })}
              archivePending={archiveFeedback.isPending}
              bulkArchivePending={bulkArchiveFeedback.isPending}
            />
          </TabsContent>

          <TabsContent value="archived" className="space-y-6 mt-4">
            <FeedbackContent
              feedbackList={feedbackList}
              isLoading={isLoading}
              statusFilter={statusFilter}
              setStatusFilter={setStatusFilter}
              typeFilter={typeFilter}
              setTypeFilter={setTypeFilter}
              selectedIds={selectedIds}
              toggleSelectAll={toggleSelectAll}
              toggleSelectOne={toggleSelectOne}
              setSelectedFeedbackId={setSelectedFeedbackId}
              getTypeBadge={getTypeBadge}
              getPriorityBadge={getPriorityBadge}
              getStatusBadge={getStatusBadge}
              formatDate={formatDate}
              isArchived={true}
              onArchive={() => {}}
              onUnarchive={(id) => unarchiveFeedback.mutate({ feedbackId: id })}
              onDeleteRequest={(id) => setDeleteConfirmId(id)}
              onBulkArchive={() => {}}
              archivePending={unarchiveFeedback.isPending}
              bulkArchivePending={false}
            />
          </TabsContent>
        </Tabs>
      </div>

      {/* Feedback Detail Dialog */}
      <Dialog open={!!selectedFeedbackId} onOpenChange={(open) => !open && setSelectedFeedbackId(null)}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Feedback Details</DialogTitle>
            <DialogDescription>View feedback details and conversation history</DialogDescription>
          </DialogHeader>

          {feedbackDetail && (
            <div className="space-y-6">
              {/* Feedback Info */}
              <div className="space-y-3">
                <div className="flex items-center gap-2 flex-wrap">
                  {getTypeBadge(feedbackDetail.feedback.type)}
                  {getPriorityBadge(feedbackDetail.feedback.priority)}
                  {getStatusBadge(feedbackDetail.feedback.status)}
                  {feedbackDetail.feedback.archived && (
                    <Badge variant="secondary" className="gap-1">
                      <Archive className="h-3 w-3" />Archived
                    </Badge>
                  )}
                </div>

                <div>
                  <h3 className="font-semibold text-lg">{feedbackDetail.feedback.subject}</h3>
                  <p className="text-sm text-muted-foreground">
                    From: {feedbackDetail.user?.name || "Anonymous"} • {formatDate(feedbackDetail.feedback.createdAt)}
                  </p>
                </div>

                <div className="bg-muted/50 p-4 rounded-lg">
                  <p className="whitespace-pre-wrap">{feedbackDetail.feedback.description}</p>
                </div>

                {/* Screenshot/Recording */}
                {feedbackDetail.feedback.screenshotUrl && (
                  <div>
                    <label className="text-sm font-medium mb-2 block">Attachment</label>
                    <div className="border border-border rounded-lg p-4">
                      {feedbackDetail.feedback.screenshotUrl.match(/\.(jpg|jpeg|png|gif|webp)$/i) ? (
                        <img src={feedbackDetail.feedback.screenshotUrl} alt="Screenshot" className="max-w-full h-auto rounded-lg" />
                      ) : feedbackDetail.feedback.screenshotUrl.match(/\.(mp4|webm|mov)$/i) ? (
                        <video src={feedbackDetail.feedback.screenshotUrl} controls className="max-w-full h-auto rounded-lg" />
                      ) : (
                        <a href={feedbackDetail.feedback.screenshotUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                          View attachment
                        </a>
                      )}
                    </div>
                  </div>
                )}

                {/* Page URL & User Agent */}
                {(feedbackDetail.feedback.pageUrl || feedbackDetail.feedback.userAgent) && (
                  <div className="text-xs text-muted-foreground space-y-1">
                    {feedbackDetail.feedback.pageUrl && <p><strong>Page:</strong> {feedbackDetail.feedback.pageUrl}</p>}
                    {feedbackDetail.feedback.userAgent && <p><strong>Browser:</strong> {feedbackDetail.feedback.userAgent}</p>}
                  </div>
                )}
              </div>

              {/* Status Update */}
              <div>
                <label className="text-sm font-medium mb-2 block">Update Status</label>
                <Select
                  value={feedbackDetail.feedback.status}
                  onValueChange={(value) => handleStatusChange(feedbackDetail.feedback.id, value)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="open">Open</SelectItem>
                    <SelectItem value="in_progress">In Progress</SelectItem>
                    <SelectItem value="resolved">Resolved</SelectItem>
                    <SelectItem value="closed">Closed</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Conversation History */}
              {feedbackDetail.replies && feedbackDetail.replies.length > 0 && (
                <div>
                  <h4 className="font-semibold mb-3">Conversation History</h4>
                  <div className="space-y-3">
                    {feedbackDetail.replies.map((item: any) => (
                      <div
                        key={item.reply.id}
                        className={`p-4 rounded-lg ${item.reply.isAdminReply ? "bg-primary/10 ml-8" : "bg-muted/50 mr-8"}`}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm font-medium">
                            {item.reply.isAdminReply ? "Admin" : (item.user?.name || "User")}
                          </span>
                          <span className="text-xs text-muted-foreground">{formatDate(item.reply.createdAt)}</span>
                        </div>
                        <p className="text-sm whitespace-pre-wrap">{item.reply.message}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Reply Form */}
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium mb-2 block">Send Reply</label>
                  <Textarea
                    placeholder="Type your reply here..."
                    value={replyMessage}
                    onChange={(e) => setReplyMessage(e.target.value)}
                    rows={4}
                    className="resize-none"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium mb-2 flex items-center gap-2">
                    <Video className="h-4 w-4" />
                    Video Link (Optional)
                  </label>
                  <input
                    type="url"
                    placeholder="Paste YouTube, Loom, or video URL..."
                    value={replyVideoUrl}
                    onChange={(e) => setReplyVideoUrl(e.target.value)}
                    className="w-full px-3 py-2 border rounded-md bg-background"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Add a video walkthrough or tutorial to help explain the solution
                  </p>
                </div>
              </div>
            </div>
          )}

          <DialogFooter className="gap-2">
            {/* Archive / Unarchive from dialog */}
            {feedbackDetail && !feedbackDetail.feedback.archived && (
              <Button
                variant="outline"
                className="text-amber-600 border-amber-600/30 hover:bg-amber-600/10"
                onClick={() => { archiveFeedback.mutate({ feedbackId: feedbackDetail.feedback.id }); setSelectedFeedbackId(null); }}
                disabled={archiveFeedback.isPending}
              >
                <Archive className="h-4 w-4 mr-2" />Archive
              </Button>
            )}
            {feedbackDetail && feedbackDetail.feedback.archived && (
              <Button
                variant="outline"
                className="text-blue-600 border-blue-600/30 hover:bg-blue-600/10"
                onClick={() => { unarchiveFeedback.mutate({ feedbackId: feedbackDetail.feedback.id }); setSelectedFeedbackId(null); }}
                disabled={unarchiveFeedback.isPending}
              >
                <ArchiveRestore className="h-4 w-4 mr-2" />Unarchive
              </Button>
            )}
            {feedbackDetail && (
              <Button
                variant="outline"
                className="text-destructive border-destructive/30 hover:bg-destructive/10"
                onClick={() => setDeleteConfirmId(feedbackDetail.feedback.id)}
              >
                <Trash2 className="h-4 w-4 mr-2" />Delete
              </Button>
            )}
            <Button variant="outline" onClick={() => setSelectedFeedbackId(null)}>
              Close
            </Button>
            <Button
              onClick={handleReply}
              disabled={replyToFeedback.isPending || !replyMessage.trim()}
            >
              <Send className="h-4 w-4 mr-2" />
              {replyToFeedback.isPending ? "Sending..." : "Send Reply"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deleteConfirmId} onOpenChange={(open) => !open && setDeleteConfirmId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Feedback?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently hide this feedback item. It will no longer appear in any view.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteConfirmId && deleteFeedback.mutate({ feedbackId: deleteConfirmId })}
              disabled={deleteFeedback.isPending}
            >
              {deleteFeedback.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── Shared table content component ──────────────────────────────────────────
function FeedbackContent({
  feedbackList,
  isLoading,
  statusFilter,
  setStatusFilter,
  typeFilter,
  setTypeFilter,
  selectedIds,
  toggleSelectAll,
  toggleSelectOne,
  setSelectedFeedbackId,
  getTypeBadge,
  getPriorityBadge,
  getStatusBadge,
  formatDate,
  isArchived,
  onArchive,
  onUnarchive,
  onDeleteRequest,
  onBulkArchive,
  archivePending,
  bulkArchivePending,
}: {
  feedbackList: any;
  isLoading: boolean;
  statusFilter: string;
  setStatusFilter: (v: string) => void;
  typeFilter: string;
  setTypeFilter: (v: string) => void;
  selectedIds: Set<number>;
  toggleSelectAll: () => void;
  toggleSelectOne: (id: number) => void;
  setSelectedFeedbackId: (id: number) => void;
  getTypeBadge: (type: string) => ReactNode;
  getPriorityBadge: (priority: string) => ReactNode;
  getStatusBadge: (status: string) => ReactNode;
  formatDate: (date: any) => string;
  isArchived: boolean;
  onArchive: (id: number) => void;
  onUnarchive: (id: number) => void;
  onDeleteRequest: (id: number) => void;
  onBulkArchive: () => void;
  archivePending: boolean;
  bulkArchivePending: boolean;
}) {
  return (
    <>
      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col md:flex-row gap-4 items-end">
            <div className="flex-1">
              <label className="text-sm font-medium mb-2 block">Status</label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Filter by status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="open">Open</SelectItem>
                  <SelectItem value="in_progress">In Progress</SelectItem>
                  <SelectItem value="resolved">Resolved</SelectItem>
                  <SelectItem value="closed">Closed</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1">
              <label className="text-sm font-medium mb-2 block">Type</label>
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Filter by type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="bug">Bug Reports</SelectItem>
                  <SelectItem value="feature">Feature Requests</SelectItem>
                  <SelectItem value="question">Questions</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {!isArchived && selectedIds.size > 0 && (
              <Button
                variant="outline"
                className="text-amber-600 border-amber-600/30 hover:bg-amber-600/10"
                onClick={onBulkArchive}
                disabled={bulkArchivePending}
              >
                <Archive className="h-4 w-4 mr-2" />
                Archive Selected ({selectedIds.size})
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Feedback List */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5" />
            {isArchived ? "Archived Feedback" : "Support Inbox"}
          </CardTitle>
          <CardDescription>
            {feedbackList?.length || 0} {isArchived ? "archived" : "active"} submissions
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Loading feedback...</div>
          ) : !feedbackList || feedbackList.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              {isArchived ? "No archived feedback" : "No feedback submissions yet"}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  {!isArchived && (
                    <TableHead className="w-10">
                      <input
                        type="checkbox"
                        checked={selectedIds.size === feedbackList.length && feedbackList.length > 0}
                        onChange={toggleSelectAll}
                        className="rounded"
                      />
                    </TableHead>
                  )}
                  <TableHead>Date</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {feedbackList.map((item: any) => (
                  <TableRow key={item.feedback.id}>
                    {!isArchived && (
                      <TableCell>
                        <input
                          type="checkbox"
                          checked={selectedIds.has(item.feedback.id)}
                          onChange={() => toggleSelectOne(item.feedback.id)}
                          onClick={(e) => e.stopPropagation()}
                          className="rounded"
                        />
                      </TableCell>
                    )}
                    <TableCell className="whitespace-nowrap">{formatDate(item.feedback.createdAt)}</TableCell>
                    <TableCell>{item.user?.name || "Anonymous"}</TableCell>
                    <TableCell>{getTypeBadge(item.feedback.type)}</TableCell>
                    <TableCell>{getPriorityBadge(item.feedback.priority)}</TableCell>
                    <TableCell>{getStatusBadge(item.feedback.status)}</TableCell>
                    <TableCell className="max-w-xs">
                      <div className="flex items-center gap-2">
                        <div className="truncate font-medium">{item.feedback.subject}</div>
                        {item.feedback.screenshotUrl && <Paperclip className="h-4 w-4 text-muted-foreground flex-shrink-0" />}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setSelectedFeedbackId(item.feedback.id)}
                        >
                          View
                        </Button>
                        {!isArchived ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-amber-600 hover:text-amber-700 hover:bg-amber-600/10"
                            title="Archive"
                            onClick={(e) => { e.stopPropagation(); onArchive(item.feedback.id); }}
                            disabled={archivePending}
                          >
                            <Archive className="h-4 w-4" />
                          </Button>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-blue-600 hover:text-blue-700 hover:bg-blue-600/10"
                            title="Unarchive"
                            onClick={(e) => { e.stopPropagation(); onUnarchive(item.feedback.id); }}
                            disabled={archivePending}
                          >
                            <ArchiveRestore className="h-4 w-4" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive hover:bg-destructive/10"
                          title="Delete"
                          onClick={(e) => { e.stopPropagation(); onDeleteRequest(item.feedback.id); }}
                        >
                          <Trash2 className="h-4 w-4" />
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
    </>
  );
}
