import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { MessageSquare, Megaphone, Trash2, Eye, EyeOff, Send, Paperclip, Video } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

export default function Inbox() {
  const { toast } = useToast();
  const [selectedFeedback, setSelectedFeedback] = useState<number | null>(null);
  const [selectedBroadcast, setSelectedBroadcast] = useState<number | null>(null);
  const [replyMessage, setReplyMessage] = useState("");

  // Fetch user's feedback submissions
  const { data: feedbackList, refetch: refetchFeedback } = trpc.feedback.listMyFeedback.useQuery();
  
  // Fetch user's broadcasts
  const { data: broadcastList, refetch: refetchBroadcasts } = trpc.inbox.listBroadcasts.useQuery();

  // Fetch feedback detail with replies
  const { data: feedbackDetail } = trpc.feedback.getFeedbackDetail.useQuery(
    { feedbackId: selectedFeedback! },
    { enabled: !!selectedFeedback }
  );

  // Mutations
  const replyMutation = trpc.feedback.submitReply.useMutation({
    onSuccess: () => {
      toast({ title: "Reply sent", description: "Your reply has been submitted" });
      setReplyMessage("");
      refetchFeedback();
    },
    onError: (error: any) => {
      toast({ title: "Failed to send reply", description: error.message, variant: "destructive" });
    },
  });

  const markBroadcastRead = trpc.inbox.markBroadcastRead.useMutation({
    onSuccess: () => refetchBroadcasts(),
  });

  const deleteBroadcast = trpc.inbox.deleteBroadcast.useMutation({
    onSuccess: () => {
      toast({ title: "Message deleted" });
      refetchBroadcasts();
      setSelectedBroadcast(null);
    },
  });

  const handleSendReply = () => {
    if (!selectedFeedback || !replyMessage.trim()) return;
    replyMutation.mutate({
      feedbackId: selectedFeedback,
      message: replyMessage,
    });
  };

  const handleMarkRead = (broadcastId: number, isRead: boolean) => {
    markBroadcastRead.mutate({ broadcastId, isRead });
  };

  const handleDeleteBroadcast = (broadcastId: number) => {
    deleteBroadcast.mutate({ broadcastId });
  };

  const unreadFeedbackCount = feedbackList?.feedback.filter((f: any) => 
    f.replies?.some((r: any) => r.isAdminReply && !r.readByUser)
  ).length || 0;

  const unreadBroadcastCount = broadcastList?.broadcasts.filter((b: any) => !b.isRead).length || 0;

  return (
    <div className="container py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">Inbox</h1>
        <p className="text-muted-foreground mt-2">
          View your feedback conversations and announcements
        </p>
      </div>

      <Tabs defaultValue="feedback" className="space-y-6">
        <TabsList>
          <TabsTrigger value="feedback" className="gap-2">
            <MessageSquare className="h-4 w-4" />
            Feedback
            {unreadFeedbackCount > 0 && (
              <Badge variant="destructive" className="ml-2">{unreadFeedbackCount}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="broadcasts" className="gap-2">
            <Megaphone className="h-4 w-4" />
            Announcements
            {unreadBroadcastCount > 0 && (
              <Badge variant="destructive" className="ml-2">{unreadBroadcastCount}</Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="feedback" className="space-y-4">
          {!feedbackList || feedbackList.feedback.length === 0 ? (
            <Card className="p-12 text-center">
              <MessageSquare className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">No feedback submitted yet</h3>
              <p className="text-muted-foreground">
                Use the Feedback button to report issues or suggest features
              </p>
            </Card>
          ) : (
            feedbackList.feedback.map((item: any) => {
              const hasUnreadReplies = item.replies?.some((r: any) => r.isAdminReply && !r.readByUser);
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
                        <Badge variant={item.status === 'resolved' ? 'default' : 'secondary'}>
                          {item.status}
                        </Badge>
                        <Badge variant="outline">{item.type}</Badge>
                        {item.screenshotUrl && (
                          <Paperclip className="h-4 w-4 text-muted-foreground" />
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground line-clamp-2 mb-2">
                        {item.description}
                      </p>
                      {lastReply && (
                        <p className="text-sm text-muted-foreground">
                          Last reply: {formatDistanceToNow(new Date(lastReply.createdAt), { addSuffix: true })}
                        </p>
                      )}
                    </div>
                    {hasUnreadReplies && (
                      <Badge variant="destructive">New Reply</Badge>
                    )}
                  </div>
                </Card>
              );
            })
          )}
        </TabsContent>

        <TabsContent value="broadcasts" className="space-y-4">
          {!broadcastList || broadcastList.broadcasts.length === 0 ? (
            <Card className="p-12 text-center">
              <Megaphone className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">No announcements yet</h3>
              <p className="text-muted-foreground">
                You'll see important updates and announcements here
              </p>
            </Card>
          ) : (
            broadcastList.broadcasts.map((broadcast: any) => (
              <Card
                key={broadcast.id}
                className={`p-6 cursor-pointer hover:bg-accent/50 transition-colors ${
                  !broadcast.isRead ? 'border-primary' : ''
                }`}
                onClick={() => setSelectedBroadcast(broadcast.id)}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="font-semibold">{broadcast.title}</h3>
                      {!broadcast.isRead && <Badge>New</Badge>}
                      {broadcast.videoUrl && (
                        <Video className="h-4 w-4 text-muted-foreground" />
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground line-clamp-2">
                      {broadcast.message}
                    </p>
                    <p className="text-xs text-muted-foreground mt-2">
                      {formatDistanceToNow(new Date(broadcast.createdAt), { addSuffix: true })}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleMarkRead(broadcast.id, !broadcast.isRead);
                      }}
                    >
                      {broadcast.isRead ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteBroadcast(broadcast.id);
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </Card>
            ))
          )}
        </TabsContent>
      </Tabs>

      {/* Feedback Detail Dialog */}
      <Dialog open={!!selectedFeedback} onOpenChange={() => setSelectedFeedback(null)}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Feedback Conversation</DialogTitle>
          </DialogHeader>
          {feedbackDetail && (
            <div className="space-y-6">
              {/* Original Feedback */}
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
                      <video controls className="w-full max-h-96 rounded">
                        <source src={feedbackDetail.feedback.screenshotUrl} />
                      </video>
                    ) : (
                      <img
                        src={feedbackDetail.feedback.screenshotUrl}
                        alt="Screenshot"
                        className="w-full rounded"
                      />
                    )}
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  Submitted {formatDistanceToNow(new Date(feedbackDetail.feedback.createdAt), { addSuffix: true })}
                </p>
              </div>

              {/* Replies */}
              {feedbackDetail.replies && feedbackDetail.replies.length > 0 && (
                <div className="space-y-4">
                  <h4 className="font-semibold">Conversation</h4>
                  {feedbackDetail.replies.map((reply: any) => (
                    <div
                      key={reply.id}
                      className={`p-4 rounded-lg ${
                        reply.isAdminReply ? 'bg-primary/10' : 'bg-muted'
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <span className="font-semibold text-sm">
                          {reply.isAdminReply ? 'Support Team' : 'You'}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {formatDistanceToNow(new Date(reply.createdAt), { addSuffix: true })}
                        </span>
                      </div>
                      <p className="text-sm whitespace-pre-wrap">{reply.message}</p>
                      {reply.videoUrl && (
                        <div className="mt-3">
                          <video controls className="w-full max-h-64 rounded">
                            <source src={reply.videoUrl} />
                          </video>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Reply Form */}
              {feedbackDetail.feedback.status !== 'closed' && (
                <div className="space-y-3">
                  <Textarea
                    placeholder="Type your reply..."
                    value={replyMessage}
                    onChange={(e) => setReplyMessage(e.target.value)}
                    rows={4}
                  />
                  <Button
                    onClick={handleSendReply}
                    disabled={!replyMessage.trim() || replyMutation.isPending}
                  >
                    <Send className="h-4 w-4 mr-2" />
                    Send Reply
                  </Button>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Broadcast Detail Dialog */}
      <Dialog open={!!selectedBroadcast} onOpenChange={() => setSelectedBroadcast(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Announcement</DialogTitle>
          </DialogHeader>
          {broadcastList && selectedBroadcast && (
            (() => {
              const broadcast = broadcastList.broadcasts.find((b: any) => b.id === selectedBroadcast);
              if (!broadcast) return null;
              
              // Mark as read when opened
              if (!broadcast.isRead) {
                handleMarkRead(broadcast.id, true);
              }

              return (
                <div className="space-y-4">
                  <div>
                    <h3 className="font-semibold text-lg mb-2">{broadcast.title}</h3>
                    <p className="text-sm whitespace-pre-wrap">{broadcast.message}</p>
                  </div>
                  {broadcast.videoUrl && (
                    <div>
                      <h4 className="font-semibold text-sm mb-2">Video Tutorial</h4>
                      {broadcast.videoUrl.match(/^https?:\/\/(www\.)?(youtube\.com|youtu\.be|loom\.com)/i) ? (
                        <div className="aspect-video">
                          <iframe
                            src={broadcast.videoUrl.replace('watch?v=', 'embed/')}
                            className="w-full h-full rounded"
                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                            allowFullScreen
                          />
                        </div>
                      ) : (
                        <a
                          href={broadcast.videoUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary hover:underline flex items-center gap-2"
                        >
                          <Video className="h-4 w-4" />
                          Watch Video
                        </a>
                      )}
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Sent {formatDistanceToNow(new Date(broadcast.createdAt), { addSuffix: true })}
                  </p>
                </div>
              );
            })()
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
