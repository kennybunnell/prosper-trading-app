import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MessageSquare, Send, CheckCircle, Clock, XCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { AdminPageHeader } from "@/components/AdminPageHeader";

export function AdminFeedback() {
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [selectedFeedbackId, setSelectedFeedbackId] = useState<number | null>(null);
  const [replyMessage, setReplyMessage] = useState("");

  // Fetch feedback list
  const { data: feedbackList, isLoading, refetch } = trpc.admin.listFeedback.useQuery({
    status: statusFilter === "all" ? undefined : (statusFilter as any),
    type: typeFilter === "all" ? undefined : (typeFilter as any),
  });

  // Fetch feedback detail
  const { data: feedbackDetail } = trpc.admin.getFeedbackDetail.useQuery(
    { feedbackId: selectedFeedbackId! },
    { enabled: !!selectedFeedbackId }
  );

  // Reply mutation
  const replyToFeedback = trpc.admin.replyToFeedback.useMutation({
    onSuccess: () => {
      toast({
        title: "Reply sent successfully",
      });
      setReplyMessage("");
      refetch();
    },
    onError: (error) => {
      toast({
        title: "Failed to send reply",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Update status mutation
  const updateStatus = trpc.admin.updateFeedbackStatus.useMutation({
    onSuccess: () => {
      toast({
        title: "Status updated successfully",
      });
      refetch();
    },
    onError: (error) => {
      toast({
        title: "Failed to update status",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleReply = () => {
    if (!selectedFeedbackId || !replyMessage.trim()) {
      toast({
        title: "Reply message required",
        variant: "destructive",
      });
      return;
    }

    replyToFeedback.mutate({
      feedbackId: selectedFeedbackId,
      message: replyMessage.trim(),
    });
  };

  const handleStatusChange = (feedbackId: number, newStatus: string) => {
    updateStatus.mutate({
      feedbackId,
      status: newStatus as any,
    });
  };

  const formatDate = (date: any) => {
    if (!date) return "Unknown";
    return new Date(date).toLocaleString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
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
        {/* Filters */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-col md:flex-row gap-4">
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
            </div>
          </CardContent>
        </Card>

        {/* Feedback List */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5" />
              Support Inbox
            </CardTitle>
            <CardDescription>
              {feedbackList?.length || 0} feedback submissions
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground">
                Loading feedback...
              </div>
            ) : !feedbackList || feedbackList.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No feedback submissions yet
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
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
                  {feedbackList.map((item) => (
                    <TableRow key={item.feedback.id}>
                      <TableCell className="whitespace-nowrap">
                        {formatDate(item.feedback.createdAt)}
                      </TableCell>
                      <TableCell>{item.user?.name || "Anonymous"}</TableCell>
                      <TableCell>{getTypeBadge(item.feedback.type)}</TableCell>
                      <TableCell>{getPriorityBadge(item.feedback.priority)}</TableCell>
                      <TableCell>{getStatusBadge(item.feedback.status)}</TableCell>
                      <TableCell className="max-w-xs">
                        <div className="truncate font-medium">{item.feedback.subject}</div>
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setSelectedFeedbackId(item.feedback.id)}
                        >
                          View & Reply
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Feedback Detail Dialog */}
      <Dialog open={!!selectedFeedbackId} onOpenChange={(open) => !open && setSelectedFeedbackId(null)}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Feedback Details</DialogTitle>
            <DialogDescription>
              View feedback details and conversation history
            </DialogDescription>
          </DialogHeader>

          {feedbackDetail && (
            <div className="space-y-6">
              {/* Feedback Info */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  {getTypeBadge(feedbackDetail.feedback.type)}
                  {getPriorityBadge(feedbackDetail.feedback.priority)}
                  {getStatusBadge(feedbackDetail.feedback.status)}
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
                        <img
                          src={feedbackDetail.feedback.screenshotUrl}
                          alt="Screenshot"
                          className="max-w-full h-auto rounded-lg"
                        />
                      ) : feedbackDetail.feedback.screenshotUrl.match(/\.(mp4|webm|mov)$/i) ? (
                        <video
                          src={feedbackDetail.feedback.screenshotUrl}
                          controls
                          className="max-w-full h-auto rounded-lg"
                        />
                      ) : (
                        <a
                          href={feedbackDetail.feedback.screenshotUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary hover:underline"
                        >
                          View attachment
                        </a>
                      )}
                    </div>
                  </div>
                )}

                {/* Page URL & User Agent */}
                {(feedbackDetail.feedback.pageUrl || feedbackDetail.feedback.userAgent) && (
                  <div className="text-xs text-muted-foreground space-y-1">
                    {feedbackDetail.feedback.pageUrl && (
                      <p><strong>Page:</strong> {feedbackDetail.feedback.pageUrl}</p>
                    )}
                    {feedbackDetail.feedback.userAgent && (
                      <p><strong>Browser:</strong> {feedbackDetail.feedback.userAgent}</p>
                    )}
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
                        className={`p-4 rounded-lg ${
                          item.reply.isAdminReply
                            ? "bg-primary/10 ml-8"
                            : "bg-muted/50 mr-8"
                        }`}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm font-medium">
                            {item.reply.isAdminReply ? "Admin" : (item.user?.name || "User")}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {formatDate(item.reply.createdAt)}
                          </span>
                        </div>
                        <p className="text-sm whitespace-pre-wrap">{item.reply.message}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Reply Form */}
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
            </div>
          )}

          <DialogFooter>
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
    </div>
  );
}
