import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  MessageSquare, Megaphone, Trash2, Eye, EyeOff, Send, Paperclip,
  Video, Bot, Copy, Check, Clock, CheckCircle, XCircle, Users, ExternalLink,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

// ─── helpers ─────────────────────────────────────────────────────────────────

function formatDate(date: any) {
  if (!date) return "Unknown";
  return new Date(date).toLocaleString("en-US", {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { icon: any; variant: "default" | "secondary" | "outline" | "destructive"; label: string }> = {
    open:        { icon: Clock,        variant: "outline",     label: "Open" },
    in_progress: { icon: Clock,        variant: "secondary",   label: "In Progress" },
    resolved:    { icon: CheckCircle,  variant: "default",     label: "Resolved" },
    closed:      { icon: XCircle,      variant: "outline",     label: "Closed" },
  };
  const cfg = map[status] || { icon: Clock, variant: "outline" as const, label: status };
  const Icon = cfg.icon;
  return (
    <Badge variant={cfg.variant} className="gap-1 text-xs">
      <Icon className="h-3 w-3" />{cfg.label}
    </Badge>
  );
}

function TypeBadge({ type }: { type: string }) {
  const map: Record<string, { variant: "default" | "secondary" | "outline" | "destructive"; label: string }> = {
    bug:     { variant: "destructive", label: "Bug" },
    feature: { variant: "default",     label: "Feature" },
    question:{ variant: "secondary",   label: "Question" },
    other:   { variant: "outline",     label: "Other" },
  };
  const cfg = map[type] || { variant: "outline" as const, label: type };
  return <Badge variant={cfg.variant} className="text-xs">{cfg.label}</Badge>;
}

function PriorityBadge({ priority }: { priority: string }) {
  const map: Record<string, { variant: "default" | "secondary" | "outline" | "destructive"; label: string }> = {
    low:    { variant: "outline",     label: "Low" },
    medium: { variant: "secondary",   label: "Medium" },
    high:   { variant: "destructive", label: "High" },
  };
  const cfg = map[priority] || { variant: "outline" as const, label: priority };
  return <Badge variant={cfg.variant} className="text-xs">{cfg.label}</Badge>;
}

// ─── Copy button ──────────────────────────────────────────────────────────────

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
      const el = document.createElement("textarea");
      el.value = text;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };
  return (
    <Button size="sm" variant="outline" onClick={handleCopy} className="gap-1.5 text-xs h-7 px-2">
      {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? "Copied!" : label}
    </Button>
  );
}

// ─── Admin Support Tickets Tab ────────────────────────────────────────────────

function AdminSupportTab() {
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter]     = useState<string>("all");
  const [selectedId, setSelectedId]     = useState<number | null>(null);
  const [replyMessage, setReplyMessage] = useState("");
  const [replyVideoUrl, setReplyVideoUrl] = useState("");

  const { data: feedbackList, isLoading, refetch } = trpc.admin.listFeedback.useQuery({
    status: statusFilter === "all" ? undefined : (statusFilter as any),
    type:   typeFilter   === "all" ? undefined : (typeFilter   as any),
  });

  const { data: detail } = trpc.admin.getFeedbackDetail.useQuery(
    { feedbackId: selectedId! },
    { enabled: !!selectedId }
  );

  const replyMutation = trpc.admin.replyToFeedback.useMutation({
    onSuccess: () => {
      toast({ title: "Reply sent" });
      setReplyMessage("");
      setReplyVideoUrl("");
      refetch();
    },
    onError: (e) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const statusMutation = trpc.admin.updateFeedbackStatus.useMutation({
    onSuccess: () => { toast({ title: "Status updated" }); refetch(); },
    onError:   (e) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const handleReply = () => {
    if (!selectedId || !replyMessage.trim()) return;
    replyMutation.mutate({ feedbackId: selectedId, message: replyMessage.trim(), videoUrl: replyVideoUrl.trim() || undefined });
  };

  const buildCopyText = (item: any) => {
    const lines: string[] = [];
    lines.push(`Subject: ${item.feedback.subject}`);
    lines.push(`From: ${item.user?.name || "Anonymous"} | ${formatDate(item.feedback.createdAt)}`);
    lines.push(`Type: ${item.feedback.type} | Priority: ${item.feedback.priority} | Status: ${item.feedback.status}`);
    if (item.feedback.pageUrl) lines.push(`Page: ${item.feedback.pageUrl}`);
    lines.push("");
    lines.push(item.feedback.description);
    return lines.join("\n");
  };

  const openCount = feedbackList?.filter((i: any) => i.feedback.status === "open").length || 0;

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40 h-8 text-xs">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="in_progress">In Progress</SelectItem>
            <SelectItem value="resolved">Resolved</SelectItem>
            <SelectItem value="closed">Closed</SelectItem>
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-40 h-8 text-xs">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="bug">Bug Reports</SelectItem>
            <SelectItem value="feature">Feature Requests</SelectItem>
            <SelectItem value="question">Questions</SelectItem>
            <SelectItem value="other">Other</SelectItem>
          </SelectContent>
        </Select>
        {openCount > 0 && (
          <Badge variant="destructive" className="self-center">{openCount} open</Badge>
        )}
      </div>

      {/* Ticket list */}
      {isLoading ? (
        <Card className="p-12 text-center text-muted-foreground">Loading tickets…</Card>
      ) : !feedbackList || feedbackList.length === 0 ? (
        <Card className="p-12 text-center">
          <Users className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold mb-2">No submissions yet</h3>
          <p className="text-muted-foreground">User feedback and support requests will appear here</p>
        </Card>
      ) : (
        feedbackList.map((item: any) => (
          <Card
            key={item.feedback.id}
            className={`p-5 cursor-pointer hover:bg-accent/50 transition-colors ${
              item.feedback.status === "open" ? "border-amber-500/40" : ""
            }`}
            onClick={() => setSelectedId(item.feedback.id)}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2 mb-1.5">
                  <span className="font-semibold truncate">{item.feedback.subject}</span>
                  <TypeBadge type={item.feedback.type} />
                  <PriorityBadge priority={item.feedback.priority} />
                  <StatusBadge status={item.feedback.status} />
                  {item.feedback.screenshotUrl && <Paperclip className="h-3.5 w-3.5 text-muted-foreground" />}
                </div>
                <p className="text-sm text-muted-foreground line-clamp-2 mb-1.5">
                  {item.feedback.description}
                </p>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground/70">{item.user?.name || "Anonymous"}</span>
                  <span>·</span>
                  <span>{formatDistanceToNow(new Date(item.feedback.createdAt), { addSuffix: true })}</span>
                  {item.feedback.pageUrl && (
                    <>
                      <span>·</span>
                      <span className="truncate max-w-[200px]">{item.feedback.pageUrl}</span>
                    </>
                  )}
                </div>
              </div>
              {/* Thumbnail preview */}
              {item.feedback.screenshotUrl && item.feedback.screenshotUrl.match(/\.(jpg|jpeg|png|gif|webp)$/i) && (
                <img
                  src={item.feedback.screenshotUrl}
                  alt="screenshot"
                  className="w-16 h-12 object-cover rounded border border-border flex-shrink-0"
                />
              )}
            </div>
          </Card>
        ))
      )}

      {/* Detail Dialog */}
      <Dialog open={!!selectedId} onOpenChange={(open) => !open && setSelectedId(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Support Ticket</DialogTitle>
            <DialogDescription>View details, reply, and update status</DialogDescription>
          </DialogHeader>

          {detail && (
            <div className="space-y-5">
              {/* Header badges + copy */}
              <div className="flex flex-wrap items-center gap-2">
                <TypeBadge type={detail.feedback.type} />
                <PriorityBadge priority={detail.feedback.priority} />
                <StatusBadge status={detail.feedback.status} />
                <div className="ml-auto">
                  <CopyButton
                    text={buildCopyText(detail)}
                    label="Copy to clipboard"
                  />
                </div>
              </div>

              {/* Subject + meta */}
              <div>
                <h3 className="font-semibold text-lg">{detail.feedback.subject}</h3>
                <p className="text-sm text-muted-foreground mt-0.5">
                  From: <span className="font-medium text-foreground/80">{detail.user?.name || "Anonymous"}</span>
                  {" · "}{formatDate(detail.feedback.createdAt)}
                </p>
                {detail.feedback.pageUrl && (
                  <a
                    href={detail.feedback.pageUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-primary hover:underline flex items-center gap-1 mt-0.5"
                  >
                    <ExternalLink className="h-3 w-3" />
                    {detail.feedback.pageUrl}
                  </a>
                )}
              </div>

              {/* Description */}
              <div className="bg-muted/50 p-4 rounded-lg">
                <p className="whitespace-pre-wrap text-sm">{detail.feedback.description}</p>
              </div>

              {/* Screenshot / video attachment */}
              {detail.feedback.screenshotUrl && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-sm font-medium">Attachment</label>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-xs gap-1"
                        onClick={() => window.open(detail.feedback.screenshotUrl ?? undefined, "_blank")}
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                        Open full size
                      </Button>
                      <CopyButton text={detail.feedback.screenshotUrl ?? ""} label="Copy URL" />
                    </div>
                  </div>
                  <div className="border border-border rounded-lg p-3">
                    {detail.feedback.screenshotUrl.match(/\.(jpg|jpeg|png|gif|webp)$/i) ? (
                      <img
                        src={detail.feedback.screenshotUrl}
                        alt="Screenshot"
                        className="max-w-full h-auto rounded cursor-pointer"
                        onClick={() => window.open(detail.feedback.screenshotUrl ?? undefined, "_blank")}
                      />
                    ) : detail.feedback.screenshotUrl.match(/\.(mp4|webm|mov)$/i) ? (
                      <video src={detail.feedback.screenshotUrl} controls className="max-w-full h-auto rounded" />
                    ) : (
                      <a href={detail.feedback.screenshotUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                        View attachment
                      </a>
                    )}
                  </div>
                </div>
              )}

              {/* Browser / page meta */}
              {detail.feedback.userAgent && (
                <p className="text-xs text-muted-foreground">
                  <strong>Browser:</strong> {detail.feedback.userAgent}
                </p>
              )}

              {/* Status update */}
              <div>
                <label className="text-sm font-medium mb-1.5 block">Update Status</label>
                <Select
                  value={detail.feedback.status}
                  onValueChange={(v) => statusMutation.mutate({ feedbackId: detail.feedback.id, status: v as any })}
                >
                  <SelectTrigger className="w-48">
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

              {/* Conversation history */}
              {detail.replies && detail.replies.length > 0 && (
                <div>
                  <h4 className="font-semibold mb-3">Conversation History</h4>
                  <div className="space-y-3">
                    {detail.replies.map((item: any) => (
                      <div
                        key={item.reply.id}
                        className={`p-4 rounded-lg ${
                          item.reply.isAdminReply ? "bg-primary/10 ml-8" : "bg-muted/50 mr-8"
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-sm font-medium">
                            {item.reply.isAdminReply ? "You (Admin)" : (item.user?.name || "User")}
                          </span>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">{formatDate(item.reply.createdAt)}</span>
                            <CopyButton text={item.reply.message} label="Copy" />
                          </div>
                        </div>
                        <p className="text-sm whitespace-pre-wrap">{item.reply.message}</p>
                        {item.reply.videoUrl && (
                          <div className="mt-3">
                            {item.reply.videoUrl.match(/^https?:\/\/(www\.)?(youtube\.com|youtu\.be|loom\.com)/i) ? (
                              <div className="aspect-video">
                                <iframe
                                  src={item.reply.videoUrl.replace("watch?v=", "embed/")}
                                  className="w-full h-full rounded"
                                  allowFullScreen
                                />
                              </div>
                            ) : (
                              <video src={item.reply.videoUrl} controls className="w-full max-h-64 rounded" />
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Reply form */}
              {detail.feedback.status !== "closed" && (
                <div className="space-y-3 pt-2 border-t border-border">
                  <label className="text-sm font-medium block">Send Reply</label>
                  <Textarea
                    placeholder="Type your reply here…"
                    value={replyMessage}
                    onChange={(e) => setReplyMessage(e.target.value)}
                    rows={4}
                    className="resize-none"
                  />
                  <div>
                    <label className="text-sm font-medium mb-1.5 flex items-center gap-1.5">
                      <Video className="h-4 w-4" />
                      Video Link (optional)
                    </label>
                    <input
                      type="url"
                      placeholder="Paste YouTube, Loom, or video URL…"
                      value={replyVideoUrl}
                      onChange={(e) => setReplyVideoUrl(e.target.value)}
                      className="w-full px-3 py-2 border border-border rounded-md bg-background text-sm"
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedId(null)}>Close</Button>
            {detail?.feedback.status !== "closed" && (
              <Button onClick={handleReply} disabled={replyMutation.isPending || !replyMessage.trim()}>
                <Send className="h-4 w-4 mr-2" />
                {replyMutation.isPending ? "Sending…" : "Send Reply"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Main Inbox ───────────────────────────────────────────────────────────────

export default function Inbox() {
  const { user } = useAuth();
  const { toast } = useToast();
  const isAdmin = user?.role === "admin";

  const [selectedFeedback, setSelectedFeedback]       = useState<number | null>(null);
  const [selectedBroadcast, setSelectedBroadcast]     = useState<number | null>(null);
  const [selectedConversation, setSelectedConversation] = useState<number | null>(null);
  const [replyMessage, setReplyMessage]               = useState("");

  // User's own feedback
  const { data: feedbackList, refetch: refetchFeedback } = trpc.feedback.listMyFeedback.useQuery();
  const { data: broadcastList, refetch: refetchBroadcasts } = trpc.inbox.listBroadcasts.useQuery();
  const { data: conversationsList } = trpc.chat.listConversations.useQuery();

  const { data: conversationDetail } = trpc.chat.getChatHistory.useQuery(
    { conversationId: selectedConversation! },
    { enabled: !!selectedConversation }
  );
  const { data: feedbackDetail } = trpc.feedback.getFeedbackDetail.useQuery(
    { feedbackId: selectedFeedback! },
    { enabled: !!selectedFeedback }
  );

  useEffect(() => {
    if (feedbackDetail) refetchFeedback();
  }, [feedbackDetail, refetchFeedback]);

  const replyMutation = trpc.feedback.submitReply.useMutation({
    onSuccess: () => {
      toast({ title: "Reply sent" });
      setReplyMessage("");
      refetchFeedback();
    },
    onError: (e: any) => toast({ title: "Failed to send reply", description: e.message, variant: "destructive" }),
  });

  const markBroadcastRead = trpc.inbox.markBroadcastRead.useMutation({ onSuccess: () => refetchBroadcasts() });
  const deleteBroadcast   = trpc.inbox.deleteBroadcast.useMutation({
    onSuccess: () => { toast({ title: "Message deleted" }); refetchBroadcasts(); setSelectedBroadcast(null); },
  });

  const unreadFeedbackCount  = feedbackList?.feedback.filter((f: any) => f.replies?.some((r: any) => r.isAdminReply && !r.readByUser)).length || 0;
  const unreadBroadcastCount = broadcastList?.broadcasts.filter((b: any) => !b.isRead).length || 0;

  // Admin open ticket count for badge
  const { data: adminFeedbackAll } = trpc.admin.listFeedback.useQuery(
    { status: "new" as any },
    { enabled: isAdmin }
  );
  // Count all non-resolved, non-closed tickets for the badge
  const adminOpenCount = isAdmin ? (adminFeedbackAll?.length || 0) : 0;

  return (
    <div className="container py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">Inbox</h1>
        <p className="text-muted-foreground mt-2">
          {isAdmin
            ? "Manage support tickets, view your feedback conversations, and read announcements"
            : "View your feedback conversations and announcements"}
        </p>
      </div>

      <Tabs defaultValue={isAdmin ? "support" : "feedback"} className="space-y-6">
        <TabsList>
          {/* Admin-only Support Tickets tab */}
          {isAdmin && (
            <TabsTrigger value="support" className="gap-2">
              <Users className="h-4 w-4" />
              Support Tickets
              {adminOpenCount > 0 && (
                <Badge variant="destructive" className="ml-1">{adminOpenCount}</Badge>
              )}
            </TabsTrigger>
          )}
          <TabsTrigger value="feedback" className="gap-2">
            <MessageSquare className="h-4 w-4" />
            My Feedback
            {unreadFeedbackCount > 0 && (
              <Badge variant="destructive" className="ml-1">{unreadFeedbackCount}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="broadcasts" className="gap-2">
            <Megaphone className="h-4 w-4" />
            Announcements
            {unreadBroadcastCount > 0 && (
              <Badge variant="destructive" className="ml-1">{unreadBroadcastCount}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="conversations" className="gap-2">
            <Bot className="h-4 w-4" />
            Conversations
          </TabsTrigger>
        </TabsList>

        {/* ── Admin Support Tickets ── */}
        {isAdmin && (
          <TabsContent value="support">
            <AdminSupportTab />
          </TabsContent>
        )}

        {/* ── My Feedback ── */}
        <TabsContent value="feedback" className="space-y-4">
          {!feedbackList || feedbackList.feedback.length === 0 ? (
            <Card className="p-12 text-center">
              <MessageSquare className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">No feedback submitted yet</h3>
              <p className="text-muted-foreground">Use the Feedback button to report issues or suggest features</p>
            </Card>
          ) : (
            feedbackList.feedback.map((item: any) => {
              const hasUnread = item.replies?.some((r: any) => r.isAdminReply && !r.readByUser);
              const lastReply = item.replies?.[item.replies.length - 1];
              return (
                <Card
                  key={item.id}
                  className="p-6 cursor-pointer hover:bg-accent/50 transition-colors"
                  onClick={() => setSelectedFeedback(item.id)}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-2">
                        <h3 className="font-semibold truncate">{item.subject}</h3>
                        <Badge variant={item.status === "resolved" ? "default" : "secondary"}>{item.status}</Badge>
                        <Badge variant="outline">{item.type}</Badge>
                        {item.screenshotUrl && <Paperclip className="h-4 w-4 text-muted-foreground" />}
                      </div>
                      <p className="text-sm text-muted-foreground line-clamp-2 mb-2">{item.description}</p>
                      {lastReply && (
                        <p className="text-sm text-muted-foreground">
                          Last reply: {formatDistanceToNow(new Date(lastReply.createdAt), { addSuffix: true })}
                        </p>
                      )}
                    </div>
                    {hasUnread && <Badge variant="destructive">New Reply</Badge>}
                  </div>
                </Card>
              );
            })
          )}
        </TabsContent>

        {/* ── Announcements ── */}
        <TabsContent value="broadcasts" className="space-y-4">
          {!broadcastList || broadcastList.broadcasts.length === 0 ? (
            <Card className="p-12 text-center">
              <Megaphone className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">No announcements yet</h3>
              <p className="text-muted-foreground">You'll see important updates and announcements here</p>
            </Card>
          ) : (
            broadcastList.broadcasts.map((b: any) => (
              <Card
                key={b.id}
                className={`p-6 cursor-pointer hover:bg-accent/50 transition-colors ${!b.isRead ? "border-primary" : ""}`}
                onClick={() => setSelectedBroadcast(b.id)}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="font-semibold">{b.title}</h3>
                      {!b.isRead && <Badge>New</Badge>}
                      {b.videoUrl && <Video className="h-4 w-4 text-muted-foreground" />}
                    </div>
                    <p className="text-sm text-muted-foreground line-clamp-2">{b.message}</p>
                    <p className="text-xs text-muted-foreground mt-2">
                      {formatDistanceToNow(new Date(b.createdAt), { addSuffix: true })}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); markBroadcastRead.mutate({ broadcastId: b.id, isRead: !b.isRead }); }}>
                      {b.isRead ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); deleteBroadcast.mutate({ broadcastId: b.id }); }}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </Card>
            ))
          )}
        </TabsContent>

        {/* ── AI Conversations ── */}
        <TabsContent value="conversations" className="space-y-4">
          {!conversationsList || conversationsList.conversations.length === 0 ? (
            <Card className="p-12 text-center">
              <Bot className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">No conversations yet</h3>
              <p className="text-muted-foreground">Start a conversation using the Ask Question feature in the Support widget</p>
            </Card>
          ) : (
            conversationsList.conversations.map((c: any) => (
              <Card key={c.id} className="p-6 cursor-pointer hover:bg-accent/50 transition-colors" onClick={() => setSelectedConversation(c.id)}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="font-semibold truncate">{c.subject}</h3>
                      <Badge variant={c.status === "resolved" ? "default" : "secondary"}>{c.status}</Badge>
                      {c.hasAdminReplied && <Badge variant="outline">Admin Joined</Badge>}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Last activity: {formatDistanceToNow(new Date(c.lastMessageAt), { addSuffix: true })}
                    </p>
                  </div>
                </div>
              </Card>
            ))
          )}
        </TabsContent>
      </Tabs>

      {/* ── My Feedback Detail Dialog ── */}
      <Dialog open={!!selectedFeedback} onOpenChange={() => setSelectedFeedback(null)}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Feedback Conversation</DialogTitle></DialogHeader>
          {feedbackDetail && (
            <div className="space-y-6">
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <h3 className="font-semibold text-lg">{feedbackDetail.feedback.subject}</h3>
                  <Badge>{feedbackDetail.feedback.status}</Badge>
                  <Badge variant="outline">{feedbackDetail.feedback.type}</Badge>
                </div>
                <p className="text-sm">{feedbackDetail.feedback.description}</p>
                {feedbackDetail.feedback.screenshotUrl && (
                  <div className="border rounded-lg p-4">
                    {feedbackDetail.feedback.screenshotUrl.match(/\.(mp4|webm|mov)$/i) ? (
                      <video controls className="w-full max-h-96 rounded"><source src={feedbackDetail.feedback.screenshotUrl} /></video>
                    ) : (
                      <img src={feedbackDetail.feedback.screenshotUrl} alt="Screenshot" className="w-full rounded" />
                    )}
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  Submitted {formatDistanceToNow(new Date(feedbackDetail.feedback.createdAt), { addSuffix: true })}
                </p>
              </div>
              {feedbackDetail.replies && feedbackDetail.replies.length > 0 && (
                <div className="space-y-4">
                  <h4 className="font-semibold">Conversation</h4>
                  {feedbackDetail.replies.map((reply: any) => (
                    <div key={reply.id} className={`p-4 rounded-lg ${reply.isAdminReply ? "bg-primary/10" : "bg-muted"}`}>
                      <div className="flex items-center gap-2 mb-2">
                        <span className="font-semibold text-sm">{reply.isAdminReply ? "Support Team" : "You"}</span>
                        <span className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(reply.createdAt), { addSuffix: true })}</span>
                      </div>
                      <p className="text-sm whitespace-pre-wrap">{reply.message}</p>
                      {reply.videoUrl && (
                        <div className="mt-3"><video controls className="w-full max-h-64 rounded"><source src={reply.videoUrl} /></video></div>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {feedbackDetail.feedback.status !== "closed" && (
                <div className="space-y-3">
                  <Textarea
                    placeholder="Type your reply..."
                    value={replyMessage}
                    onChange={(e) => setReplyMessage(e.target.value)}
                    rows={4}
                    className="border-2 border-orange-500/30 focus:border-orange-500/70 focus:ring-2 focus:ring-orange-500/30 shadow-[0_0_20px_rgba(249,115,22,0.4)] focus:shadow-[0_0_30px_rgba(249,115,22,0.6)] transition-all"
                  />
                  <Button onClick={() => replyMutation.mutate({ feedbackId: selectedFeedback!, message: replyMessage })} disabled={!replyMessage.trim() || replyMutation.isPending}>
                    <Send className="h-4 w-4 mr-2" />Send Reply
                  </Button>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Broadcast Detail Dialog ── */}
      <Dialog open={!!selectedBroadcast} onOpenChange={() => setSelectedBroadcast(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Announcement</DialogTitle></DialogHeader>
          {broadcastList && selectedBroadcast && (() => {
            const b = broadcastList.broadcasts.find((x: any) => x.id === selectedBroadcast);
            if (!b) return null;
            if (!b.isRead) markBroadcastRead.mutate({ broadcastId: b.id, isRead: true });
            return (
              <div className="space-y-4">
                <div>
                  <h3 className="font-semibold text-lg mb-2">{b.title}</h3>
                  <p className="text-sm whitespace-pre-wrap">{b.message}</p>
                </div>
                {b.videoUrl && (
                  <div>
                    <h4 className="font-semibold text-sm mb-2">Video Tutorial</h4>
                    {b.videoUrl.match(/^https?:\/\/(www\.)?(youtube\.com|youtu\.be|loom\.com)/i) ? (
                      <div className="aspect-video">
                        <iframe src={b.videoUrl.replace("watch?v=", "embed/")} className="w-full h-full rounded" allowFullScreen />
                      </div>
                    ) : (
                      <a href={b.videoUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline flex items-center gap-2">
                        <Video className="h-4 w-4" />Watch Video
                      </a>
                    )}
                  </div>
                )}
                <p className="text-xs text-muted-foreground">Sent {formatDistanceToNow(new Date(b.createdAt), { addSuffix: true })}</p>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* ── Conversation Detail Dialog ── */}
      <Dialog open={!!selectedConversation} onOpenChange={() => setSelectedConversation(null)}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader><DialogTitle>AI Chat Conversation</DialogTitle></DialogHeader>
          {conversationDetail && (
            <div className="space-y-6">
              <div className="space-y-3 pb-4 border-b">
                <div className="flex items-center gap-3">
                  <h3 className="font-semibold text-lg">{conversationDetail.conversation.subject}</h3>
                  <Badge variant={conversationDetail.conversation.status === "resolved" ? "default" : "secondary"}>
                    {conversationDetail.conversation.status}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  Started {formatDistanceToNow(new Date(conversationDetail.conversation.createdAt), { addSuffix: true })}
                </p>
              </div>
              <div className="space-y-4">
                {conversationDetail.messages.map((msg: any) => (
                  <div key={msg.id} className={`flex gap-3 ${msg.senderType === "user" ? "justify-end" : "justify-start"}`}>
                    {msg.senderType !== "user" && (
                      <div className="flex-shrink-0">
                        {msg.senderType === "ai" ? (
                          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                            <Bot className="h-4 w-4 text-primary" />
                          </div>
                        ) : (
                          <div className="w-8 h-8 rounded-full bg-orange-500/10 flex items-center justify-center">
                            <span className="text-xs font-semibold text-orange-500">A</span>
                          </div>
                        )}
                      </div>
                    )}
                    <div className={`max-w-[70%] rounded-lg p-4 ${msg.senderType === "user" ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                      <p className="text-sm whitespace-pre-wrap">{msg.message}</p>
                      <p className="text-xs mt-2 opacity-70">{formatDistanceToNow(new Date(msg.createdAt), { addSuffix: true })}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
