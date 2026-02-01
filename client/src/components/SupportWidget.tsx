import { useState, useRef, useEffect } from "react";
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
import { MessageCircle, Send, Upload, X, Video, Circle, Square, Bot, User, Mic } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export function SupportWidget() {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const chatEndRef = useRef<HTMLDivElement>(null);
  
  const [isOpen, setIsOpen] = useState(false);
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
  const [isListening, setIsListening] = useState(false);
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

  // File upload mutation
  const uploadFile = trpc.feedback.uploadFile.useMutation();

  // Submit feedback mutation
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

  // Auto-scroll chat to bottom
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
  };

  const resetAll = () => {
    resetFeedbackForm();
    setChatMessage("");
    setChatHistory([]);
    setConversationId(null);
    setIsOpen(false);
    setActiveTab("chat");
  };

  // Initialize speech recognition
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRecognition) {
        const recognition = new SpeechRecognition();
        recognition.continuous = false;
        recognition.interimResults = false;
        recognition.lang = 'en-US';

        recognition.onresult = (event: any) => {
          const transcript = event.results[0][0].transcript;
          setChatMessage(prev => prev + (prev ? ' ' : '') + transcript);
          setIsListening(false);
        };

        recognition.onerror = (event: any) => {
          console.error('Speech recognition error:', event.error);
          setIsListening(false);
          if (event.error !== 'no-speech' && event.error !== 'aborted') {
            toast({
              title: "Voice input failed",
              description: "Could not recognize speech. Please try again.",
              variant: "destructive",
            });
          }
        };

        recognition.onend = () => {
          setIsListening(false);
        };

        recognitionRef.current = recognition;
      }
    }
  }, [toast]);

  const toggleVoiceInput = () => {
    if (!recognitionRef.current) {
      toast({
        title: "Voice input not supported",
        description: "Your browser doesn't support voice input. Please use Chrome, Edge, or Safari.",
        variant: "destructive",
      });
      return;
    }

    if (isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
    } else {
      try {
        recognitionRef.current.start();
        setIsListening(true);
      } catch (error) {
        console.error('Failed to start recognition:', error);
      }
    }
  };

  const handleSendMessage = () => {
    if (!chatMessage.trim()) return;

    // Add user message to chat history
    setChatHistory(prev => [
      ...prev,
      {
        id: Date.now(),
        senderType: "user",
        message: chatMessage,
        createdAt: new Date(),
      }
    ]);

    setIsAiThinking(true);

    // Send to AI
    askQuestion.mutate({
      message: chatMessage,
      conversationId: conversationId || undefined,
    });
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
        audio: true,
      } as any);

      // Request microphone audio
      let micStream: MediaStream | null = null;
      try {
        micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (micError) {
        console.warn('Microphone access denied or unavailable:', micError);
      }

      // Combine audio tracks
      const audioTracks = [
        ...displayStream.getAudioTracks(),
        ...(micStream ? micStream.getAudioTracks() : [])
      ];

      // Create combined stream
      const combinedStream = new MediaStream([
        ...displayStream.getVideoTracks(),
        ...audioTracks
      ]);

      const mimeType = MediaRecorder.isTypeSupported('video/webm; codecs=vp9')
        ? 'video/webm; codecs=vp9'
        : 'video/webm';
      
      const mediaRecorder = new MediaRecorder(combinedStream, { mimeType });
      mediaRecorderRef.current = mediaRecorder;
      recordedChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(recordedChunksRef.current, { type: mimeType });
        const file = new File([blob], `screen-recording-${Date.now()}.webm`, { type: mimeType });
        
        setSelectedFile(file);
        const previewUrl = URL.createObjectURL(file);
        setFilePreviewUrl(previewUrl);

        combinedStream.getTracks().forEach((track: MediaStreamTrack) => track.stop());
        if (micStream) {
          micStream.getTracks().forEach((track: MediaStreamTrack) => track.stop());
        }
        
        setIsRecording(false);
        setRecordingTime(0);
      };

      mediaRecorder.start();
      setIsRecording(true);

      const startTime = Date.now();
      const timerInterval = setInterval(() => {
        if (!mediaRecorderRef.current || mediaRecorderRef.current.state !== 'recording') {
          clearInterval(timerInterval);
          return;
        }
        setRecordingTime(Math.floor((Date.now() - startTime) / 1000));
      }, 1000);

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

  const handleSubmitFeedback = async () => {
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

    if (selectedFile) {
      try {
        setIsUploading(true);
        
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const result = reader.result as string;
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
        <span className="font-medium">Support</span>
      </button>

      {/* Support Dialog */}
      <Dialog open={isOpen} onOpenChange={(open) => {
        if (!open) resetAll();
        setIsOpen(open);
      }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Support & Feedback</DialogTitle>
            <DialogDescription>
              Get instant answers or report issues
            </DialogDescription>
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

            {/* Chat Tab */}
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
                    <div
                      key={msg.id}
                      className={`flex gap-3 ${msg.senderType === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                      {msg.senderType !== 'user' && (
                        <div className="flex-shrink-0">
                          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                            <Bot className="h-4 w-4 text-primary" />
                          </div>
                        </div>
                      )}
                      <div
                        className={`max-w-[80%] rounded-lg px-4 py-2 ${
                          msg.senderType === 'user'
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-background border'
                        }`}
                      >
                        <p className="text-sm whitespace-pre-wrap">{msg.message}</p>
                      </div>
                      {msg.senderType === 'user' && (
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
                  className="flex-1 min-h-[60px] border-2 focus:border-blue-500/50 focus:ring-2 focus:ring-blue-500/20 shadow-[0_0_15px_rgba(59,130,246,0.3)] transition-all"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSendMessage();
                    }
                  }}
                  disabled={isAiThinking}
                />
                <Button
                  onClick={toggleVoiceInput}
                  disabled={isAiThinking}
                  size="icon"
                  className={`h-[60px] w-[60px] ${isListening ? 'bg-red-500 hover:bg-red-600 animate-pulse' : ''}`}
                  variant={isListening ? "default" : "outline"}
                >
                  <Mic className={`h-5 w-5 ${isListening ? 'animate-pulse' : ''}`} />
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

            {/* Feedback Tab */}
            <TabsContent value="feedback" className="flex-1 flex flex-col overflow-y-auto mt-4 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Type</label>
                  <Select value={type} onValueChange={setType}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
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

              <div className="space-y-2">
                <label className="text-sm font-medium">Subject</label>
                <Input
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="Brief description of the issue"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Description</label>
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Provide detailed information..."
                  className="min-h-[120px]"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Attachment</label>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isRecording || !!selectedFile}
                  >
                    <Upload className="h-4 w-4 mr-2" />
                    Upload File
                  </Button>

                  {!isRecording ? (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={startScreenRecording}
                      disabled={!!selectedFile}
                    >
                      <Video className="h-4 w-4 mr-2" />
                      Record Screen
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="destructive"
                      onClick={stopScreenRecording}
                    >
                      <Square className="h-4 w-4 mr-2" />
                      Stop ({formatRecordingTime(recordingTime)})
                    </Button>
                  )}
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
                      <img
                        src={filePreviewUrl}
                        alt="Preview"
                        className="max-h-48 mx-auto rounded"
                      />
                    )}

                    {isVideo && (
                      <video
                        src={filePreviewUrl}
                        controls
                        className="max-h-48 mx-auto rounded"
                      />
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
                  {isUploading ? "Uploading..." : submitFeedback.isPending ? "Submitting..." : "Submit Feedback"}
                </Button>
              </DialogFooter>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>
    </>
  );
}
