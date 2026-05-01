import { useState, useRef, useEffect } from "react";
import { useSupportWidget } from "@/contexts/SupportContext";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MessageCircle, Send, Upload, X, Video, Square, Bot, User, Mic, Camera } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// Dictation target type
type DictationTarget = "chat" | "subject" | "description" | null;

export function SupportWidget() {
  const { toast } = useToast();
  const { isOpen, closeSupport } = useSupportWidget();

  // Check if screen recording is available
  useEffect(() => {
    const checkScreenRecording = async () => {
      try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
          setIsScreenRecordingAvailable(false);
          return;
        }
        setIsScreenRecordingAvailable(true);
      } catch {
        setIsScreenRecordingAvailable(false);
      }
    };
    checkScreenRecording();
  }, []);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const [activeTab, setActiveTab] = useState("chat");

  // Chat state
  const [chatMessage, setChatMessage] = useState("");
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [chatHistory, setChatHistory] = useState<Array<{
    id: number;
    senderType: "user" | "ai" | "admin";
    message: string;
    createdAt: Date;
  }>>([]);
  const [isAiThinking, setIsAiThinking] = useState(false);

  // Feedback form state
  const [type, setType] = useState<string>("feedback");
  const [priority, setPriority] = useState<string>("medium");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [filePreviewUrl, setFilePreviewUrl] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [isScreenRecordingAvailable, setIsScreenRecordingAvailable] = useState(true);
  const [isCapturingScreenshot, setIsCapturingScreenshot] = useState(false);

  // Dictation state — tracks which field is currently listening
  const [dictationTarget, setDictationTarget] = useState<DictationTarget>(null);
  const recognitionRef = useRef<any>(null);

  // Chat mutations
  const askQuestion = trpc.chat.askQuestion.useMutation({
    onSuccess: (data) => {
      setConversationId(data.conversationId);
      setChatHistory(prev => [
        ...prev,
        {
          id: Date.now() + 1,
          senderType: "ai",
          message: data.aiMessage,
          createdAt: new Date(),
        }
      ]);
      setIsAiThinking(false);
      setChatMessage("");
    },
    onError: (error: any) => {
      toast({
        title: "Failed to get response",
        description: error.message,
        variant: "destructive",
      });
      setIsAiThinking(false);
    },
  });

  const uploadFile = trpc.feedback.uploadFile.useMutation();

  const submitFeedback = trpc.feedback.submit.useMutation({
    onSuccess: () => {
      toast({
        title: "Feedback submitted successfully",
        description: "Thank you for your feedback! We'll review it shortly.",
      });
      resetFeedbackForm();
    },
    onError: (error: any) => {
      toast({
        title: "Failed to submit feedback",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatHistory]);

  const resetFeedbackForm = () => {
    setType("feedback");
    setPriority("medium");
    setSubject("");
    setDescription("");
    setSelectedFile(null);
    setFilePreviewUrl(null);
    setIsRecording(false);
    setRecordingTime(0);
    setDictationTarget(null);
  };

  const resetAll = () => {
    resetFeedbackForm();
    setChatMessage("");
    setChatHistory([]);
    setConversationId(null);
    closeSupport();
    setActiveTab("chat");
    stopDictation();
  };

  // ─── Speech Recognition ───────────────────────────────────────────────────
  useEffect(() => {
    if (typeof window === "undefined") return;
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognition.maxAlternatives = 1;

    recognition.onresult = (event: any) => {
      let finalTranscript = "";
      for (let i = 0; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript + " ";
        }
      }
      if (!finalTranscript) return;
      const trimmed = finalTranscript.trim();

      // Route transcript to the correct field based on current target
      setDictationTarget(prev => {
        if (prev === "chat") setChatMessage(m => m + (m ? " " : "") + trimmed);
        if (prev === "subject") setSubject(s => s + (s ? " " : "") + trimmed);
        if (prev === "description") setDescription(d => d + (d ? " " : "") + trimmed);
        return prev;
      });
    };

    recognition.onerror = (event: any) => {
      if (event.error !== "no-speech" && event.error !== "aborted") {
        toast({
          title: "Voice input failed",
          description: "Could not recognize speech. Please try again.",
          variant: "destructive",
        });
      }
      setDictationTarget(null);
    };

    recognition.onend = () => {
      setDictationTarget(null);
    };

    recognitionRef.current = recognition;
  }, [toast]);

  const stopDictation = () => {
    try { recognitionRef.current?.stop(); } catch { /* ignore */ }
    setDictationTarget(null);
  };

  const toggleDictation = (target: DictationTarget) => {
    if (!recognitionRef.current) {
      toast({
        title: "Voice input not supported",
        description: "Please use Chrome, Edge, or Safari for voice input.",
        variant: "destructive",
      });
      return;
    }

    // If already listening to this target, stop
    if (dictationTarget === target) {
      stopDictation();
      return;
    }

    // Stop any existing session first
    if (dictationTarget !== null) {
      try { recognitionRef.current.stop(); } catch { /* ignore */ }
    }

    // Small delay to allow previous session to close
    setTimeout(() => {
      try {
        recognitionRef.current.start();
        setDictationTarget(target);

        // Auto-stop after 30 seconds
        setTimeout(() => {
          setDictationTarget(prev => {
            if (prev === target) {
              try { recognitionRef.current?.stop(); } catch { /* ignore */ }
              return null;
            }
            return prev;
          });
        }, 30000);
      } catch (err) {
        console.error("Failed to start recognition:", err);
      }
    }, 100);
  };

  // ─── Screenshot Capture ───────────────────────────────────────────────────
  const captureScreenshot = async () => {
    if (selectedFile) return; // already have an attachment
    setIsCapturingScreenshot(true);
    try {
      // Use getDisplayMedia to capture the screen as a single frame
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 1 },
        audio: false,
      } as any);

      const track = stream.getVideoTracks()[0];
      const imageCapture = new (window as any).ImageCapture(track);
      const bitmap = await imageCapture.grabFrame();

      // Draw to canvas and export as PNG
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(bitmap, 0, 0);

      track.stop();
      stream.getTracks().forEach((t: MediaStreamTrack) => t.stop());

      canvas.toBlob((blob) => {
        if (!blob) return;
        const file = new File([blob], `screenshot-${Date.now()}.png`, { type: "image/png" });
        setSelectedFile(file);
        setFilePreviewUrl(URL.createObjectURL(file));
        toast({
          title: "Screenshot captured",
          description: "Screenshot attached to your report.",
        });
      }, "image/png");
    } catch (err: any) {
      if (err.name !== "NotAllowedError") {
        toast({
          title: "Screenshot failed",
          description: "Could not capture screenshot. Try uploading a file instead.",
          variant: "destructive",
        });
      }
    } finally {
      setIsCapturingScreenshot(false);
    }
  };

  // ─── Screen Recording ─────────────────────────────────────────────────────
  const startScreenRecording = async () => {
    try {
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      } as any);

      let micStream: MediaStream | null = null;
      try {
        micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch { /* mic optional */ }

      const audioTracks = [
        ...displayStream.getAudioTracks(),
        ...(micStream ? micStream.getAudioTracks() : []),
      ];

      const combinedStream = new MediaStream([
        ...displayStream.getVideoTracks(),
        ...audioTracks,
      ]);

      const mimeType = MediaRecorder.isTypeSupported("video/webm; codecs=vp9")
        ? "video/webm; codecs=vp9"
        : "video/webm";

      const mediaRecorder = new MediaRecorder(combinedStream, { mimeType });
      mediaRecorderRef.current = mediaRecorder;
      recordedChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) recordedChunksRef.current.push(event.data);
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(recordedChunksRef.current, { type: mimeType });
        const file = new File([blob], `screen-recording-${Date.now()}.webm`, { type: mimeType });
        setSelectedFile(file);
        setFilePreviewUrl(URL.createObjectURL(file));
        combinedStream.getTracks().forEach((t: MediaStreamTrack) => t.stop());
        if (micStream) micStream.getTracks().forEach((t: MediaStreamTrack) => t.stop());
        setIsRecording(false);
        setRecordingTime(0);
      };

      mediaRecorder.start();
      setIsRecording(true);

      const startTime = Date.now();
      const timerInterval = setInterval(() => {
        if (!mediaRecorderRef.current || mediaRecorderRef.current.state !== "recording") {
          clearInterval(timerInterval);
          return;
        }
        setRecordingTime(Math.floor((Date.now() - startTime) / 1000));
      }, 1000);

      displayStream.getVideoTracks()[0].onended = () => stopScreenRecording();
    } catch (error: any) {
      if (error.message?.includes("permissions policy")) {
        setIsScreenRecordingAvailable(false);
        toast({
          title: "Screen recording unavailable",
          description: "Screen recording is not available in this environment. Please use file upload instead.",
          variant: "destructive",
        });
        return;
      }
      toast({
        title: "Screen recording failed",
        description: error.name === "NotAllowedError"
          ? "Screen recording permission was denied"
          : "Failed to start screen recording. Please try again.",
        variant: "destructive",
      });
    }
  };

  const stopScreenRecording = () => {
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
    }
  };

  const formatRecordingTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  // ─── File Handling ────────────────────────────────────────────────────────
  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const validTypes = ["image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp", "video/mp4", "video/webm", "video/quicktime"];
    if (!validTypes.includes(file.type)) {
      toast({ title: "Invalid file type", description: "Please upload an image or video.", variant: "destructive" });
      return;
    }
    if (file.size > 16 * 1024 * 1024) {
      toast({ title: "File too large", description: "Please upload a file smaller than 16MB.", variant: "destructive" });
      return;
    }
    setSelectedFile(file);
    setFilePreviewUrl(URL.createObjectURL(file));
  };

  const handleRemoveFile = () => {
    if (filePreviewUrl) URL.revokeObjectURL(filePreviewUrl);
    setSelectedFile(null);
    setFilePreviewUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // ─── Submit ───────────────────────────────────────────────────────────────
  const handleSubmitFeedback = async () => {
    if (!subject.trim()) {
      toast({ title: "Subject required", description: "Please enter a subject.", variant: "destructive" });
      return;
    }
    if (!description.trim()) {
      toast({ title: "Description required", description: "Please describe the issue.", variant: "destructive" });
      return;
    }

    let screenshotUrl: string | undefined;

    if (selectedFile) {
      try {
        setIsUploading(true);
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve((reader.result as string).split(",")[1]);
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
        toast({ title: "File upload failed", description: error.message || "Please try again.", variant: "destructive" });
        setIsUploading(false);
        return;
      } finally {
        setIsUploading(false);
      }
    }

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

  const handleSendMessage = () => {
    if (!chatMessage.trim()) return;
    setChatHistory(prev => [...prev, {
      id: Date.now(),
      senderType: "user",
      message: chatMessage,
      createdAt: new Date(),
    }]);
    setIsAiThinking(true);
    askQuestion.mutate({ message: chatMessage, conversationId: conversationId || undefined });
  };

  const isImage = selectedFile?.type.startsWith("image/");
  const isVideo = selectedFile?.type.startsWith("video/");

  // Helper: mic button for a given target
  const MicButton = ({ target, className = "" }: { target: DictationTarget; className?: string }) => (
    <Button
      type="button"
      size="icon"
      variant={dictationTarget === target ? "default" : "outline"}
      className={`h-8 w-8 shrink-0 ${dictationTarget === target ? "bg-red-500 hover:bg-red-600 animate-pulse" : ""} ${className}`}
      title={dictationTarget === target ? "Stop dictation" : "Start voice dictation"}
      onClick={() => toggleDictation(target)}
    >
      <Mic className={`h-4 w-4 ${dictationTarget === target ? "animate-pulse" : ""}`} />
    </Button>
  );

  return (
    <>
      <Dialog open={isOpen} onOpenChange={(open) => { if (!open) resetAll(); }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Support & Feedback</DialogTitle>
            <DialogDescription>Get instant answers or report issues</DialogDescription>
          </DialogHeader>

          <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="chat">
                <Bot className="h-4 w-4 mr-2" />
                Ask Question
              </TabsTrigger>
              <TabsTrigger value="feedback">
                <MessageCircle className="h-4 w-4 mr-2" />
                Report Issue
              </TabsTrigger>
            </TabsList>

            {/* ── Chat Tab ── */}
            <TabsContent value="chat" className="flex-1 flex flex-col overflow-hidden mt-4">
              <div className="flex-1 overflow-y-auto border rounded-lg p-4 mb-4 bg-muted/20 space-y-4">
                {chatHistory.length === 0 ? (
                  <div className="text-center text-muted-foreground py-8">
                    <Bot className="h-12 w-12 mx-auto mb-3 opacity-50" />
                    <p className="text-sm">Ask me anything about Prosper Trading!</p>
                    <p className="text-xs mt-1">I can help with features, strategies, and troubleshooting.</p>
                  </div>
                ) : (
                  chatHistory.map((msg) => (
                    <div key={msg.id} className={`flex gap-3 ${msg.senderType === "user" ? "justify-end" : "justify-start"}`}>
                      {msg.senderType !== "user" && (
                        <div className="flex-shrink-0">
                          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                            <Bot className="h-4 w-4 text-primary" />
                          </div>
                        </div>
                      )}
                      <div className={`max-w-[80%] rounded-lg px-4 py-2 ${msg.senderType === "user" ? "bg-primary text-primary-foreground" : "bg-background border"}`}>
                        <p className="text-sm whitespace-pre-wrap">{msg.message}</p>
                      </div>
                      {msg.senderType === "user" && (
                        <div className="flex-shrink-0">
                          <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center">
                            <User className="h-4 w-4 text-primary-foreground" />
                          </div>
                        </div>
                      )}
                    </div>
                  ))
                )}
                {isAiThinking && (
                  <div className="flex gap-3 justify-start">
                    <div className="flex-shrink-0">
                      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                        <Bot className="h-4 w-4 text-primary animate-pulse" />
                      </div>
                    </div>
                    <div className="bg-background border rounded-lg px-4 py-2">
                      <p className="text-sm text-muted-foreground">Thinking...</p>
                    </div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>

              <div className="flex gap-2">
                <Textarea
                  value={chatMessage}
                  onChange={(e) => setChatMessage(e.target.value)}
                  placeholder="Type your question here..."
                  className="flex-1 min-h-[60px] border-2 border-orange-500/30 focus:border-orange-500/70 focus:ring-2 focus:ring-orange-500/30 shadow-[0_0_20px_rgba(249,115,22,0.4)] focus:shadow-[0_0_30px_rgba(249,115,22,0.6)] transition-all"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSendMessage(); }
                  }}
                  disabled={isAiThinking}
                />
                <Button
                  onClick={() => toggleDictation("chat")}
                  disabled={isAiThinking}
                  size="icon"
                  className={`h-[60px] w-[60px] ${dictationTarget === "chat" ? "bg-red-500 hover:bg-red-600 animate-pulse" : ""}`}
                  variant={dictationTarget === "chat" ? "default" : "outline"}
                  title={dictationTarget === "chat" ? "Stop dictation" : "Dictate your question"}
                >
                  <Mic className={`h-5 w-5 ${dictationTarget === "chat" ? "animate-pulse" : ""}`} />
                </Button>
                <Button
                  onClick={handleSendMessage}
                  disabled={!chatMessage.trim() || isAiThinking}
                  size="icon"
                  className="h-[60px] w-[60px]"
                >
                  <Send className="h-5 w-5" />
                </Button>
              </div>
            </TabsContent>

            {/* ── Report Issue Tab ── */}
            <TabsContent value="feedback" className="flex-1 flex flex-col overflow-y-auto mt-4 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Type</label>
                  <Select value={type} onValueChange={setType}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="bug">Bug Report</SelectItem>
                      <SelectItem value="feature">Feature Request</SelectItem>
                      <SelectItem value="question">Question</SelectItem>
                      <SelectItem value="feedback">General Feedback</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Priority</label>
                  <Select value={priority} onValueChange={setPriority}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Low</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                      <SelectItem value="critical">Critical</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Subject with mic */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium">Subject</label>
                  {dictationTarget === "subject" && (
                    <span className="text-xs text-red-400 animate-pulse flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-red-500 inline-block" />
                      Listening…
                    </span>
                  )}
                </div>
                <div className="flex gap-2">
                  <Input
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder="Brief description of the issue"
                    className="flex-1 border-2 border-orange-500/30 focus:border-orange-500/70 focus:ring-2 focus:ring-orange-500/30 shadow-[0_0_20px_rgba(249,115,22,0.4)] focus:shadow-[0_0_30px_rgba(249,115,22,0.6)] transition-all"
                  />
                  <MicButton target="subject" />
                </div>
              </div>

              {/* Description with mic */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium">Description</label>
                  {dictationTarget === "description" && (
                    <span className="text-xs text-red-400 animate-pulse flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-red-500 inline-block" />
                      Listening…
                    </span>
                  )}
                </div>
                <div className="relative">
                  <Textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Provide detailed information about the issue…"
                    className="min-h-[120px] pr-10 border-2 border-orange-500/30 focus:border-orange-500/70 focus:ring-2 focus:ring-orange-500/30 shadow-[0_0_20px_rgba(249,115,22,0.4)] focus:shadow-[0_0_30px_rgba(249,115,22,0.6)] transition-all"
                  />
                  {/* Mic button overlaid in bottom-right corner of textarea */}
                  <div className="absolute bottom-2 right-2">
                    <MicButton target="description" />
                  </div>
                </div>
              </div>

              {/* Attachment section */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Attachment</label>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isRecording || !!selectedFile}
                  >
                    <Upload className="h-4 w-4 mr-2" />
                    Upload File
                  </Button>

                  {/* Screenshot button */}
                  <Button
                    type="button"
                    variant="outline"
                    onClick={captureScreenshot}
                    disabled={!!selectedFile || isCapturingScreenshot || isRecording}
                    title="Capture a screenshot of your screen"
                  >
                    <Camera className="h-4 w-4 mr-2" />
                    {isCapturingScreenshot ? "Capturing…" : "Screenshot"}
                  </Button>

                  {/* Screen recording */}
                  {isScreenRecordingAvailable && !isRecording ? (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={startScreenRecording}
                      disabled={!!selectedFile}
                    >
                      <Video className="h-4 w-4 mr-2" />
                      Record Screen
                    </Button>
                  ) : isRecording ? (
                    <Button type="button" variant="destructive" onClick={stopScreenRecording}>
                      <Square className="h-4 w-4 mr-2" />
                      Stop ({formatRecordingTime(recordingTime)})
                    </Button>
                  ) : null}
                </div>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,video/*"
                  onChange={handleFileSelect}
                  className="hidden"
                />

                {selectedFile && filePreviewUrl && (
                  <div className="mt-3 relative border rounded-lg p-3">
                    <button
                      onClick={handleRemoveFile}
                      className="absolute top-2 right-2 bg-destructive text-destructive-foreground rounded-full p-1 hover:bg-destructive/90"
                    >
                      <X className="h-4 w-4" />
                    </button>
                    {isImage && (
                      <img src={filePreviewUrl} alt="Preview" className="max-h-48 mx-auto rounded" />
                    )}
                    {isVideo && (
                      <video src={filePreviewUrl} controls className="max-h-48 mx-auto rounded" />
                    )}
                    <p className="text-xs text-muted-foreground mt-2 text-center">
                      {selectedFile.name} ({(selectedFile.size / 1024 / 1024).toFixed(2)} MB)
                    </p>
                  </div>
                )}
              </div>

              <DialogFooter>
                <Button
                  onClick={handleSubmitFeedback}
                  disabled={submitFeedback.isPending || isUploading}
                >
                  {isUploading ? "Uploading…" : submitFeedback.isPending ? "Submitting…" : "Submit Feedback"}
                </Button>
              </DialogFooter>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>
    </>
  );
}
