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
import { MessageCircle, Send, Upload, X, Video, Circle, Square } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export function FeedbackWidget() {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  
  const [isOpen, setIsOpen] = useState(false);
  const [type, setType] = useState<string>("feedback");
  const [priority, setPriority] = useState<string>("medium");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [filePreviewUrl, setFilePreviewUrl] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);

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
    setIsRecording(false);
    setRecordingTime(0);
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

  const startScreenRecording = async () => {
    try {
      // Request screen capture with system audio
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true, // Include system audio if available
      } as any);

      // Request microphone audio
      let micStream: MediaStream | null = null;
      try {
        micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (micError) {
        console.warn('Microphone access denied or unavailable:', micError);
        // Continue without microphone - screen audio might still work
      }

      // Combine audio tracks from both streams
      const audioTracks = [
        ...displayStream.getAudioTracks(),
        ...(micStream ? micStream.getAudioTracks() : [])
      ];

      // Create combined stream with video from display and all audio tracks
      const combinedStream = new MediaStream([
        ...displayStream.getVideoTracks(),
        ...audioTracks
      ]);

      // Create MediaRecorder with combined stream
      const mimeType = MediaRecorder.isTypeSupported('video/webm; codecs=vp9')
        ? 'video/webm; codecs=vp9'
        : 'video/webm';
      
      const mediaRecorder = new MediaRecorder(combinedStream, { mimeType });
      mediaRecorderRef.current = mediaRecorder;
      recordedChunksRef.current = [];

      // Collect recorded data
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
        }
      };

      // Handle recording stop
      mediaRecorder.onstop = () => {
        const blob = new Blob(recordedChunksRef.current, { type: mimeType });
        const file = new File([blob], `screen-recording-${Date.now()}.webm`, { type: mimeType });
        
        // Set as selected file
        setSelectedFile(file);
        const previewUrl = URL.createObjectURL(file);
        setFilePreviewUrl(previewUrl);

        // Stop all tracks from both streams
        combinedStream.getTracks().forEach((track: MediaStreamTrack) => track.stop());
        if (micStream) {
          micStream.getTracks().forEach((track: MediaStreamTrack) => track.stop());
        }
        
        setIsRecording(false);
        setRecordingTime(0);
      };

      // Start recording
      mediaRecorder.start();
      setIsRecording(true);

      // Start timer
      const startTime = Date.now();
      const timerInterval = setInterval(() => {
        if (!mediaRecorderRef.current || mediaRecorderRef.current.state !== 'recording') {
          clearInterval(timerInterval);
          return;
        }
        setRecordingTime(Math.floor((Date.now() - startTime) / 1000));
      }, 1000);

      // Handle user stopping share from browser UI
      displayStream.getVideoTracks()[0].onended = () => {
        stopScreenRecording();
      };

    } catch (error: any) {
      console.error('Screen recording error:', error);
      toast({
        title: "Screen recording failed",
        description: error.name === 'NotAllowedError' 
          ? "Screen recording permission was denied" 
          : "Failed to start screen recording. Please try again.",
        variant: "destructive",
      });
    }
  };

  const stopScreenRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
  };

  const formatRecordingTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
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

            {/* File Upload / Screen Recording Section */}
            <div>
              <label className="text-sm font-medium mb-2 block">
                Screenshot or Recording (Optional)
              </label>
              
              {!selectedFile && !isRecording ? (
                <div className="space-y-3">
                  {/* Upload File */}
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    className="border-2 border-dashed border-border rounded-lg p-4 text-center cursor-pointer hover:border-primary hover:bg-accent/50 transition-colors"
                  >
                    <Upload className="h-6 w-6 mx-auto mb-2 text-muted-foreground" />
                    <p className="text-sm font-medium mb-1">
                      Click to upload screenshot or video
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

                  {/* Record Screen */}
                  <div className="relative">
                    <div className="absolute inset-0 flex items-center">
                      <div className="w-full border-t border-border"></div>
                    </div>
                    <div className="relative flex justify-center text-xs uppercase">
                      <span className="bg-background px-2 text-muted-foreground">Or</span>
                    </div>
                  </div>

                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    onClick={startScreenRecording}
                  >
                    <Circle className="h-4 w-4 mr-2 text-red-500 fill-red-500" />
                    Record Your Screen
                  </Button>
                  <p className="text-xs text-muted-foreground text-center">
                    Browser will ask which screen/window to share
                  </p>
                </div>
              ) : isRecording ? (
                <div className="border border-border rounded-lg p-4 bg-red-50 dark:bg-red-950/20">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-2">
                        <Circle className="h-3 w-3 text-red-500 fill-red-500 animate-pulse" />
                        <span className="text-sm font-medium">Recording...</span>
                      </div>
                      <span className="text-sm text-muted-foreground font-mono">
                        {formatRecordingTime(recordingTime)}
                      </span>
                    </div>
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      onClick={stopScreenRecording}
                    >
                      <Square className="h-4 w-4 mr-2" />
                      Stop Recording
                    </Button>
                  </div>
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
                            {selectedFile?.name}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {selectedFile ? (selectedFile.size / 1024 / 1024).toFixed(2) : '0.00'} MB
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
            <Button variant="outline" onClick={() => setIsOpen(false)} disabled={isRecording}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={submitFeedback.isPending || isUploading || isRecording || !subject.trim() || !description.trim()}
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
