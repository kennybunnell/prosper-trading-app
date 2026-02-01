import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { MessageSquare, Bot, User, Send, AlertCircle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { AdminPageHeader } from "@/components/AdminPageHeader";

export default function AdminChats() {
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "resolved" | "needs_admin">("all");
  const [selectedConversation, setSelectedConversation] = useState<number | null>(null);
  const [adminMessage, setAdminMessage] = useState("");

  // Fetch conversations
  const { data: conversationsData, refetch } = trpc.chat.adminListConversations.useQuery({
    status: statusFilter,
  });

  // Fetch conversation detail
  const { data: conversationDetail } = trpc.chat.getChatHistory.useQuery(
    { conversationId: selectedConversation! },
    { enabled: !!selectedConversation }
  );

  // Send admin message
  const sendMessage = trpc.chat.adminSendMessage.useMutation({
    onSuccess: () => {
      toast({ title: "Message sent", description: "Your message has been added to the conversation" });
      setAdminMessage("");
      refetch();
    },
    onError: (error: any) => {
      toast({ title: "Failed to send message", description: error.message, variant: "destructive" });
    },
  });

  // Resolve conversation
  const resolveConversation = trpc.chat.resolveConversation.useMutation({
    onSuccess: () => {
      toast({ title: "Conversation resolved" });
      refetch();
      setSelectedConversation(null);
    },
  });

  const handleSendMessage = () => {
    if (!selectedConversation || !adminMessage.trim()) return;
    sendMessage.mutate({
      conversationId: selectedConversation,
      message: adminMessage,
    });
  };

  const handleResolve = () => {
    if (!selectedConversation) return;
    resolveConversation.mutate({ conversationId: selectedConversation });
  };

  return (
    <div className="container py-8">
      <AdminPageHeader
        title="AI Chat Conversations"
        breadcrumbs={[
          { label: "Admin Panel", href: "/admin" },
          { label: "AI Conversations" },
        ]}
      />

      <div className="mb-8">
        <h1 className="text-3xl font-bold">AI Chat Conversations</h1>
        <p className="text-muted-foreground mt-2">
          Monitor AI conversations and provide human support when needed
        </p>
      </div>

      <div className="mb-6">
        <Select value={statusFilter} onValueChange={(value: any) => setStatusFilter(value)}>
          <SelectTrigger className="w-[200px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Conversations</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="resolved">Resolved</SelectItem>
            <SelectItem value="needs_admin">Needs Admin</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-4">
        {!conversationsData || conversationsData.conversations.length === 0 ? (
          <Card className="p-12 text-center">
            <MessageSquare className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No conversations yet</h3>
            <p className="text-muted-foreground">
              User conversations with the AI assistant will appear here
            </p>
          </Card>
        ) : (
          conversationsData.conversations.map((item: any) => {
            const conv = item.conversation;
            const needsAttention = conv.status === "needs_admin" || !conv.hasAdminReplied;
            
            return (
              <Card
                key={conv.id}
                className={`p-6 cursor-pointer hover:bg-accent/50 transition-colors ${
                  needsAttention ? 'border-orange-500' : ''
                }`}
                onClick={() => setSelectedConversation(conv.id)}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="font-semibold truncate">{conv.subject}</h3>
                      <Badge variant={conv.status === 'resolved' ? 'default' : 'secondary'}>
                        {conv.status}
                      </Badge>
                      {conv.hasAdminReplied && (
                        <Badge variant="outline">Admin Replied</Badge>
                      )}
                      {needsAttention && (
                        <Badge variant="destructive" className="gap-1">
                          <AlertCircle className="h-3 w-3" />
                          Needs Attention
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      User ID: {conv.userId}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Last activity: {formatDistanceToNow(new Date(conv.lastMessageAt), { addSuffix: true })}
                    </p>
                  </div>
                </div>
              </Card>
            );
          })
        )}
      </div>

      {/* Conversation Detail Dialog */}
      <Dialog open={!!selectedConversation} onOpenChange={() => setSelectedConversation(null)}>
        <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Conversation Details</DialogTitle>
          </DialogHeader>
          {conversationDetail && (
            <div className="flex-1 flex flex-col overflow-hidden">
              {/* Conversation Info */}
              <div className="mb-4 pb-4 border-b">
                <div className="flex items-center gap-3 mb-2">
                  <h3 className="font-semibold">{conversationDetail.conversation.subject}</h3>
                  <Badge>{conversationDetail.conversation.status}</Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  User ID: {conversationDetail.conversation.userId}
                </p>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto space-y-4 mb-4">
                {conversationDetail.messages.map((msg: any) => (
                  <div
                    key={msg.id}
                    className={`flex gap-3 ${msg.senderType === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    {msg.senderType !== 'user' && (
                      <div className="flex-shrink-0">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                          msg.senderType === 'ai' ? 'bg-primary/10' : 'bg-green-500/10'
                        }`}>
                          {msg.senderType === 'ai' ? (
                            <Bot className="h-4 w-4 text-primary" />
                          ) : (
                            <User className="h-4 w-4 text-green-600" />
                          )}
                        </div>
                      </div>
                    )}
                    <div
                      className={`max-w-[70%] rounded-lg px-4 py-2 ${
                        msg.senderType === 'user'
                          ? 'bg-primary text-primary-foreground'
                          : msg.senderType === 'ai'
                          ? 'bg-background border'
                          : 'bg-green-500/10 border border-green-500/20'
                      }`}
                    >
                      {msg.senderType === 'admin' && (
                        <p className="text-xs font-semibold text-green-600 mb-1">Admin Response</p>
                      )}
                      <p className="text-sm whitespace-pre-wrap">{msg.message}</p>
                      <p className="text-xs opacity-70 mt-1">
                        {formatDistanceToNow(new Date(msg.createdAt), { addSuffix: true })}
                      </p>
                    </div>
                    {msg.senderType === 'user' && (
                      <div className="flex-shrink-0">
                        <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center">
                          <User className="h-4 w-4 text-primary-foreground" />
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Admin Reply Form */}
              {conversationDetail.conversation.status !== 'resolved' && (
                <div className="border-t pt-4 space-y-3">
                  <Textarea
                    value={adminMessage}
                    onChange={(e) => setAdminMessage(e.target.value)}
                    placeholder="Type your response as admin..."
                    className="min-h-[100px]"
                  />
                  <DialogFooter>
                    <Button variant="outline" onClick={handleResolve}>
                      Mark as Resolved
                    </Button>
                    <Button
                      onClick={handleSendMessage}
                      disabled={!adminMessage.trim() || sendMessage.isPending}
                    >
                      <Send className="h-4 w-4 mr-2" />
                      Send Response
                    </Button>
                  </DialogFooter>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
