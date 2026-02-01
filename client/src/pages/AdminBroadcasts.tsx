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
import { Send, MessageSquare, Video } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { AdminPageHeader } from "@/components/AdminPageHeader";

export function AdminBroadcasts() {
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [targetTier, setTargetTier] = useState<string>("all");

  // Fetch broadcast history
  const { data: broadcasts, isLoading, refetch } = trpc.admin.getBroadcastHistory.useQuery({}, {
    refetchOnMount: true,
  });

  // Send broadcast mutation
  const sendBroadcast = trpc.admin.sendBroadcast.useMutation({
    onSuccess: (data) => {
      toast({
        title: "Broadcast sent successfully",
        description: `Message delivered to ${data.recipientCount} users`,
      });
      setTitle("");
      setMessage("");
      setVideoUrl("");
      setTargetTier("all");
      refetch();
    },
    onError: (error) => {
      toast({
        title: "Failed to send broadcast",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleSend = () => {
    if (!title.trim()) {
      toast({
        title: "Title required",
        description: "Please enter a title for the broadcast",
        variant: "destructive",
      });
      return;
    }
    
    if (!message.trim()) {
      toast({
        title: "Message required",
        description: "Please enter a message to broadcast",
        variant: "destructive",
      });
      return;
    }

    sendBroadcast.mutate({
      title: title.trim(),
      message: message.trim(),
      videoUrl: videoUrl.trim() || undefined,
      targetTier: targetTier as any,
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

  const getTierBadge = (tier: string | null) => {
    if (!tier) return <Badge variant="outline">All Users</Badge>;
    
    const variants: Record<string, { variant: "default" | "secondary" | "outline", label: string }> = {
      free_trial: { variant: "outline", label: "Free Trial" },
      wheel: { variant: "secondary", label: "Starter" },
      pro: { variant: "secondary", label: "Wheel" },
      advanced: { variant: "default", label: "Advanced" },
    };
    
    const config = variants[tier] || { variant: "outline" as const, label: tier };
    return <Badge variant={config.variant}>{config.label}</Badge>;
  };

  return (
    <div>
      <AdminPageHeader
        title="Broadcast Messages"
        description="Send announcements to all users or filtered by subscription tier"
        breadcrumbs={[
          { label: "Admin Panel", href: "/admin" },
          { label: "Broadcasts" },
        ]}
      />
      <div className="p-8 space-y-6">
        {/* Send Broadcast Form */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Send className="h-5 w-5" />
              Send New Broadcast
            </CardTitle>
            <CardDescription>
              Compose and send a message to all users or a specific subscription tier
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-2 block">Title</label>
              <input
                type="text"
                placeholder="Enter broadcast title..."
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>

            <div>
              <label className="text-sm font-medium mb-2 block">Target Audience</label>
              <Select value={targetTier} onValueChange={setTargetTier}>
                <SelectTrigger>
                  <SelectValue placeholder="Select target audience" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Users</SelectItem>
                  <SelectItem value="free_trial">Free Trial Users Only</SelectItem>
                  <SelectItem value="wheel">Starter Tier Only</SelectItem>
                  <SelectItem value="pro">Wheel Tier Only</SelectItem>
                  <SelectItem value="advanced">Advanced Tier Only</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-sm font-medium mb-2 block">Message</label>
              <Textarea
                placeholder="Enter your announcement message here..."
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={6}
                className="resize-none"
              />
              <p className="text-sm text-muted-foreground mt-2">
                {message.length} characters
              </p>
            </div>

            <div>
              <label className="text-sm font-medium mb-2 block flex items-center gap-2">
                <Video className="h-4 w-4" />
                Video Link (Optional)
              </label>
              <input
                type="url"
                placeholder="Paste YouTube, Loom, or video URL..."
                value={videoUrl}
                onChange={(e) => setVideoUrl(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Add a video tutorial, feature walkthrough, or trading tip to accompany your message
              </p>
            </div>

            <Button
              onClick={handleSend}
              disabled={sendBroadcast.isPending || !title.trim() || !message.trim()}
              className="w-full"
            >
              <Send className="h-4 w-4 mr-2" />
              {sendBroadcast.isPending ? "Sending..." : "Send Broadcast"}
            </Button>
          </CardContent>
        </Card>

        {/* Broadcast History */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5" />
              Broadcast History
            </CardTitle>
            <CardDescription>
              View all previously sent broadcast messages
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground">
                Loading broadcast history...
              </div>
            ) : !broadcasts || broadcasts.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No broadcasts sent yet
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Target</TableHead>
                    <TableHead>Recipients</TableHead>
                    <TableHead>Title</TableHead>
                    <TableHead>Message</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {broadcasts.map((broadcast) => (
                    <TableRow key={broadcast.id}>
                      <TableCell className="whitespace-nowrap">
                        {formatDate(broadcast.createdAt)}
                      </TableCell>
                      <TableCell>
                        {getTierBadge(broadcast.targetTier)}
                      </TableCell>
                      <TableCell>{broadcast.recipientCount}</TableCell>
                      <TableCell>
                        <div className="font-medium">{broadcast.title}</div>
                      </TableCell>
                      <TableCell className="max-w-md">
                        <div className="truncate">{broadcast.message}</div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
