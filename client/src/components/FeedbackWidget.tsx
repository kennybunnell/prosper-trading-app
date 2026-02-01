import { useState, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MessageCircle, Send, Upload, X, Image as ImageIcon, Video } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export function FeedbackWidget() {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [type, setType] = useState<string>("feedback");
  const [priority, setPriority] = useState<string>("medium");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [filePreviewUrl, setFilePreviewUrl] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  // File upload mutation
  const uploadFile = trpc.feedback.uploadFile.useMutation();

  // Submit feedback mutation
  const submitFeedback = trpc.feedback.submit.useMutation({
    onSuccess: () => {
      toast({
        title: "Feedback submitted successfully",
        description: "Thank you for your feedback! We'll review it shortly.",
      });
      // Reset form
      resetForm();
    },
    onError: (error: any) => {
      toast({
        title: "Failed to submit feedback",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const resetForm = () => {
    setType("feedback");
    setPriority("medium");
    setSubject("");
    setDescription("");
    setSelectedFile(null);
    setFilePreviewUrl(null);
    setIsOpen(false);
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type
    const validTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp', 'video/mp4', 'video/webm', 'video/quicktime'];
    if (!validTypes.includes(file.type)) {
      toast({
        title: "Invalid file type",
        description: "Please upload an image (PNG, JPG, GIF, WebP) or video (MP4, WebM, MOV)",
        variant: "destructive",
      });
      return;
    }

    // Validate file size (16MB limit)
    const maxSize = 16 * 1024 * 1024; // 16MB
    if (file.size > maxSize) {
      toast({
        title: "File too large",
        description: "Please upload a file smaller than 16MB",
        variant: "destructive",
      });
      return;
    }

    setSelectedFile(file);

    // Create preview URL
    const previewUrl = URL.createObjectURL(file);
    setFilePreviewUrl(previewUrl);
  };

  const handleRemoveFile = () => {
    if (filePreviewUrl) {
      URL.revokeObjectURL(filePreviewUrl);
    }
    setSelectedFile(null);
    setFilePreviewUrl(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleSubmit = async () => {
    if (!subject.trim()) {
      toast({
        title: "Subject required",
        description: "Please enter a subject for your feedback",
        variant: "destructive",
      });
      return;
    }

    if (!description.trim()) {
      toast({
        title: "Description required",
        description: "Please describe your feedback",
        variant: "destructive",
      });
      return;
    }

    let screenshotUrl: string | undefined = undefined;

    // Upload file if selected
    if (selectedFile) {
      try {
        setIsUploading(true);
        
        // Convert file to base64
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const result = reader.result as string;
            // Remove data URL prefix (e.g., "data:image/png;base64,")
            const base64Data = result.split(',')[1];
            resolve(base64Data);
          };
          reader.onerror = reject;
          reader.readAsDataURL(selectedFile);
        });

        const uploadResult = await uploadFile.mutateAsync({
          fileName: selectedFile.name,
          fileType: selectedFile.type,
          fileData: base64,
        });

        screenshotUrl = uploadResult.url;
      } catch (error: any) {
        toast({
          title: "File upload failed",
          description: error.message || "Failed to upload file. Please try again.",
          variant: "destructive",
        });
        setIsUploading(false);
        return;
      } finally {
        setIsUploading(false);
      }
    }

    // Submit feedback with file URL
    submitFeedback.mutate({
      type: type as any,
      priority: priority as any,
      subject: subject.trim(),
      description: description.trim(),
      pageUrl: window.location.href,
      userAgent: navigator.userAgent,
      screenshotUrl,
    });
  };

  const isImage = selectedFile?.type.startsWith('image/');
  const isVideo = selectedFile?.type.startsWith('video/');

  return (
    <>
      {/* Floating Button */}
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 z-50 flex items-center gap-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-full px-4 py-3 shadow-lg transition-all duration-200 hover:shadow-xl hover:scale-105"
      >
        <MessageCircle className="h-5 w-5" />
        <span className="font-medium">Feedback</span>
      </button>

      {/* Feedback Dialog */}
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Send Feedback</DialogTitle>
            <DialogDescription>
              Report bugs, request features, or ask questions. We value your input!
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium mb-2 block">Type</label>
                <Select value={type} onValueChange={setType}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="bug">🐛 Bug Report</SelectItem>
                    <SelectItem value="feature">💡 Feature Request</SelectItem>
                    <SelectItem value="question">❓ Question</SelectItem>
                    <SelectItem value="feedback">💬 General Feedback</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-sm font-medium mb-2 block">Priority</label>
                <Select value={priority} onValueChange={setPriority}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="urgent">Urgent</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <label className="text-sm font-medium mb-2 block">Subject</label>
              <Input
                placeholder="Brief summary of your feedback..."
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              />
            </div>

            <div>
              <label className="text-sm font-medium mb-2 block">Description</label>
              <Textarea
                placeholder="Provide detailed information about your feedback..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={6}
                className="resize-none"
              />
              <p className="text-sm text-muted-foreground mt-2">
                {description.length} characters
              </p>
            </div>

            {/* File Upload Section */}
            <div>
              <label className="text-sm font-medium mb-2 block">
                Screenshot or Recording (Optional)
              </label>
              
              {!selectedFile ? (
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-border rounded-lg p-6 text-center cursor-pointer hover:border-primary hover:bg-accent/50 transition-colors"
                >
                  <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                  <p className="text-sm font-medium mb-1">
                    Click to upload screenshot or recording
                  </p>
                  <p className="text-xs text-muted-foreground">
                    PNG, JPG, GIF, WebP, MP4, WebM, MOV (max 16MB)
                  </p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/jpg,image/gif,image/webp,video/mp4,video/webm,video/quicktime"
                    onChange={handleFileSelect}
                    className="hidden"
                  />
                </div>
              ) : (
                <div className="border border-border rounded-lg p-4">
                  <div className="flex items-start gap-3">
                    {/* Preview */}
                    <div className="flex-shrink-0">
                      {isImage && filePreviewUrl && (
                        <div className="relative w-24 h-24 rounded-lg overflow-hidden bg-muted">
                          <img
                            src={filePreviewUrl}
                            alt="Preview"
                            className="w-full h-full object-cover"
                          />
                        </div>
                      )}
                      {isVideo && filePreviewUrl && (
                        <div className="relative w-24 h-24 rounded-lg overflow-hidden bg-muted flex items-center justify-center">
                          <Video className="h-8 w-8 text-muted-foreground" />
                        </div>
                      )}
                    </div>

                    {/* File Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">
                            {selectedFile.name}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                          </p>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={handleRemoveFile}
                          className="flex-shrink-0"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="bg-muted/50 p-3 rounded-lg text-sm">
              <p className="text-muted-foreground">
                <strong>Note:</strong> We'll automatically include the current page URL and browser information to help us investigate issues.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={submitFeedback.isPending || isUploading || !subject.trim() || !description.trim()}
            >
              <Send className="h-4 w-4 mr-2" />
              {isUploading ? "Uploading..." : submitFeedback.isPending ? "Submitting..." : "Submit Feedback"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
