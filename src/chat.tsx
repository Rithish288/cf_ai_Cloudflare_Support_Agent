import React, {
  useCallback,
  useState,
  useEffect,
  useRef,
  forwardRef
} from "react";
import { useAgent } from "agents/react";
import { useAgentChat } from "@cloudflare/ai-chat/react";
import { getToolName, isToolUIPart, type UIMessage } from "ai";
import {
  Badge,
  Button,
  Empty,
  InputArea,
  Surface,
  Text
} from "@cloudflare/kumo";
import { Streamdown } from "streamdown";
import { code } from "@streamdown/code";
import {
  PaperPlaneRightIcon,
  StopIcon,
  GearIcon,
  ChatCircleDotsIcon,
  XCircleIcon,
  PaperclipIcon,
  ImageIcon,
  XIcon
} from "@phosphor-icons/react";

// ── Attachment helpers ────────────────────────────────────────────────

interface Attachment {
  id: string;
  file: File;
  preview: string;
  mediaType: string;
}

function createAttachment(file: File): Attachment {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    file,
    preview: URL.createObjectURL(file),
    mediaType: file.type || "application/octet-stream"
  };
}

function fileToDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ── Error display ────────────────────────────────────────────────────────

function ErrorMessage({ error }: { error: string }) {
  // Extract error code and message
  const match = error.match(/^(\d+):\s*(.*)/);
  const code = match ? match[1] : "Error";
  const message = match ? match[2] : error;

  let title = "Error";
  let description = message;

  if (code === "4006") {
    title = "Daily Limit Reached";
    description =
      "You've used your daily free allocation of 10,000 neurons. Please upgrade to Cloudflare's Workers Paid plan to continue.";
  }

  return (
    <div className="flex justify-start">
      <Surface className="max-w-[85%] px-4 py-3 rounded-xl rounded-bl-md bg-kumo-danger/10 border border-kumo-danger/30">
        <div className="flex items-start gap-3">
          <XCircleIcon
            size={18}
            className="text-kumo-danger flex-shrink-0 mt-0.5"
          />
          <div>
            <div className="font-bold text-kumo-danger">{title}</div>
            <div className="text-sm text-kumo-default mt-1">{description}</div>
          </div>
        </div>
      </Surface>
    </div>
  );
}

// ── Loading animation ─────────────────────────────────────────────────────

function LoadingAnimation() {
  return (
    <div className="flex justify-start">
      <Surface className="max-w-[85%] px-4 py-3 rounded-2xl rounded-bl-md bg-kumo-base">
        <div className="flex items-center gap-2">
          <div className="flex gap-1">
            <div
              className="w-2 h-2 bg-kumo-default rounded-full animate-bounce"
              style={{ animationDelay: "0ms" }}
            />
            <div
              className="w-2 h-2 bg-kumo-default rounded-full animate-bounce"
              style={{ animationDelay: "150ms" }}
            />
            <div
              className="w-2 h-2 bg-kumo-default rounded-full animate-bounce"
              style={{ animationDelay: "300ms" }}
            />
          </div>
          <Text size="sm" variant="secondary">
            Thinking...
          </Text>
        </div>
      </Surface>
    </div>
  );
}
// ── Tool rendering ────────────────────────────────────────────────────

function ToolPartView({ part }: { part: UIMessage["parts"][number] }) {
  if (!isToolUIPart(part)) return null;
  const toolName = getToolName(part);

  // Completed
  if (part.state === "output-available") {
    return (
      <div className="flex justify-start">
        <Surface className="max-w-[85%] px-4 py-2.5 rounded-xl ring ring-kumo-line">
          <div className="flex items-center gap-2 mb-1">
            <GearIcon size={14} className="text-kumo-inactive" />
            <Text size="xs" variant="secondary" bold>
              {toolName}
            </Text>
            <Badge variant="secondary">Done</Badge>
          </div>
          {/* <div className="font-mono">
                        <Text size="xs" variant="secondary">
                            {JSON.stringify(part.output, null, 2)}
                        </Text>
                    </div> */}
        </Surface>
      </div>
    );
  }

  // Rejected / denied
  if (
    part.state === "output-denied" ||
    ("approval" in part &&
      (part.approval as { approved?: boolean })?.approved === false)
  ) {
    return (
      <div className="flex justify-start">
        <Surface className="max-w-[85%] px-4 py-2.5 rounded-xl ring ring-kumo-line">
          <div className="flex items-center gap-2">
            <XCircleIcon size={14} className="text-kumo-danger" />
            <Text size="xs" variant="secondary" bold>
              {toolName}
            </Text>
            <Badge variant="secondary">Rejected</Badge>
          </div>
        </Surface>
      </div>
    );
  }

  // Executing
  if (part.state === "input-available" || part.state === "input-streaming") {
    return (
      <div className="flex justify-start">
        <Surface className="max-w-[85%] px-4 py-2.5 rounded-xl ring ring-kumo-line">
          <div className="flex items-center gap-2">
            <GearIcon size={14} className="text-kumo-inactive animate-spin" />
            <Text size="xs" variant="secondary">
              Running {toolName}...
            </Text>
          </div>
        </Surface>
      </div>
    );
  }

  return null;
}

// ── Main chat ─────────────────────────────────────────────────────────

interface ChatProps {
  onNewChat?: () => void;
}

export const Chat = forwardRef<{ clearHistory: () => void }, ChatProps>(
  (_, ref) => {
    const [connected, setConnected] = useState(false);
    const [input, setInput] = useState("");
    const [attachments, setAttachments] = useState<Attachment[]>([]);
    const [isDragging, setIsDragging] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const agent = useAgent({
      agent: "ChatAgent",
      onOpen: useCallback(() => setConnected(true), []),
      onClose: useCallback(() => setConnected(false), []),
      onError: useCallback(
        (error: Event) => console.error("WebSocket error:", error),
        []
      )
    });

    const { messages, sendMessage, stop, status, clearHistory } = useAgentChat({
      agent,
      onToolCall: async (event) => {
        if (
          "addToolOutput" in event &&
          event.toolCall.toolName === "getUserTimezone"
        ) {
          event.addToolOutput({
            toolCallId: event.toolCall.toolCallId,
            output: {
              timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
              localTime: new Date().toLocaleTimeString()
            }
          });
        }
      }
    });

    const isStreaming = status === "streaming" || status === "submitted";

    useEffect(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    // Re-focus the input after streaming ends
    useEffect(() => {
      if (!isStreaming && textareaRef.current) {
        textareaRef.current.focus();
      }
    }, [isStreaming]);

    const addFiles = useCallback((files: FileList | File[]) => {
      const images = Array.from(files).filter((f) =>
        f.type.startsWith("image/")
      );
      if (images.length === 0) return;
      setAttachments((prev) => [...prev, ...images.map(createAttachment)]);
    }, []);

    const removeAttachment = useCallback((id: string) => {
      setAttachments((prev) => {
        const att = prev.find((a) => a.id === id);
        if (att) URL.revokeObjectURL(att.preview);
        return prev.filter((a) => a.id !== id);
      });
    }, []);

    const handleDragOver = useCallback((e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer.types.includes("Files")) setIsDragging(true);
    }, []);

    const handleDragLeave = useCallback((e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.currentTarget === e.target) setIsDragging(false);
    }, []);

    const handleDrop = useCallback(
      (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
        if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files);
      },
      [addFiles]
    );

    const handlePaste = useCallback(
      (e: React.ClipboardEvent) => {
        const items = e.clipboardData?.items;
        if (!items) return;
        const files: File[] = [];
        for (const item of items) {
          if (item.kind === "file") {
            const file = item.getAsFile();
            if (file) files.push(file);
          }
        }
        if (files.length > 0) {
          e.preventDefault();
          addFiles(files);
        }
      },
      [addFiles]
    );

    const send = useCallback(async () => {
      const text = input.trim();
      if ((!text && attachments.length === 0) || isStreaming) return;
      setInput("");

      const parts: Array<
        | { type: "text"; text: string }
        | { type: "file"; mediaType: string; url: string }
      > = [];
      if (text) parts.push({ type: "text", text });

      for (const att of attachments) {
        const dataUri = await fileToDataUri(att.file);
        parts.push({ type: "file", mediaType: att.mediaType, url: dataUri });
      }

      for (const att of attachments) URL.revokeObjectURL(att.preview);
      setAttachments([]);

      sendMessage({ role: "user", parts });
      if (textareaRef.current) textareaRef.current.style.height = "auto";
    }, [input, attachments, isStreaming, sendMessage]);

    React.useImperativeHandle(ref, () => ({
      clearHistory: () => clearHistory()
    }));

    return (
      <div
        className="flex flex-col h-full bg-kumo-elevated relative"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {isDragging && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-kumo-elevated/80 backdrop-blur-sm border-2 border-dashed border-kumo-brand rounded-xl m-2 pointer-events-none">
            <div className="flex flex-col items-center gap-2 text-kumo-brand">
              <ImageIcon size={40} />
              <Text variant="heading3">Drop images here</Text>
            </div>
          </div>
        )}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto px-5 py-6 space-y-5">
            {messages.length === 0 && (
              <Empty
                icon={<ChatCircleDotsIcon size={32} />}
                title="Start a conversation"
                contents={
                  <div className="flex flex-wrap justify-center gap-2">
                    {[
                      "I need help with Cloudflare Workers",
                      "What is the best way to optimize my Cloudflare cache performance?",
                      "What is the pricing for Cloudflare R2?",
                      "How do I set up a load balancer in Cloudflare?"
                    ].map((prompt) => (
                      <Button
                        key={prompt}
                        variant="outline"
                        size="sm"
                        disabled={isStreaming}
                        onClick={() => {
                          sendMessage({
                            role: "user",
                            parts: [{ type: "text", text: prompt }]
                          });
                        }}
                      >
                        {prompt}
                      </Button>
                    ))}
                  </div>
                }
              />
            )}

            {messages.map((message: UIMessage, index: number) => {
              const isUser = message.role === "user";
              const isLastAssistant =
                message.role === "assistant" && index === messages.length - 1;

              // Check if this is an error message
              const textParts = message.parts.filter(
                (part) => part.type === "text"
              );
              const hasError = textParts.some((part) => {
                const text = (part as { type: "text"; text: string }).text;
                return text && text.includes("error") && text.match(/^\d+:/);
              });

              return (
                <div key={message.id} className="space-y-2">
                  {/* Tool parts */}
                  {message.parts.filter(isToolUIPart).map((part) => (
                    <ToolPartView key={part.toolCallId} part={part} />
                  ))}

                  {/* Image parts */}
                  {message.parts
                    .filter(
                      (part): part is Extract<typeof part, { type: "file" }> =>
                        part.type === "file" &&
                        (part as { mediaType?: string }).mediaType?.startsWith(
                          "image/"
                        ) === true
                    )
                    .map((part, i) => (
                      <div
                        key={`file-${i}`}
                        className={`flex ${isUser ? "justify-end" : "justify-start"}`}
                      >
                        <img
                          src={part.url}
                          alt="Attachment"
                          className="max-h-64 rounded-xl border border-kumo-line object-contain"
                        />
                      </div>
                    ))}

                  {/* Error message display */}
                  {!isUser && hasError && (
                    <ErrorMessage
                      error={(
                        textParts
                          .map(
                            (part) =>
                              (part as { type: "text"; text: string }).text
                          )
                          .find((text) => text && text.includes("error")) ||
                        "An error occurred"
                      ).trim()}
                    />
                  )}

                  {/* Text parts */}
                  {message.parts
                    .filter((part) => part.type === "text")
                    .map((part, i) => {
                      const text = (part as { type: "text"; text: string })
                        .text;
                      if (!text) return null;

                      // Skip error messages in normal text rendering
                      if (
                        !isUser &&
                        text.match(/^\d+:/) &&
                        text.includes("error")
                      ) {
                        return null;
                      }

                      if (isUser) {
                        return (
                          <div key={i} className="flex justify-end">
                            <div className="max-w-[85%] px-4 py-2.5 rounded-2xl rounded-br-md bg-kumo-contrast text-kumo-inverse leading-relaxed">
                              {text}
                            </div>
                          </div>
                        );
                      }

                      return (
                        <div key={i} className="flex justify-start">
                          <div className="max-w-[85%] rounded-2xl rounded-bl-md bg-kumo-base text-kumo-default leading-relaxed">
                            <Streamdown
                              className="sd-theme rounded-2xl rounded-bl-md p-3"
                              plugins={{ code }}
                              controls={false}
                              isAnimating={isLastAssistant && isStreaming}
                            >
                              {text}
                            </Streamdown>
                          </div>
                        </div>
                      );
                    })}
                </div>
              );
            })}

            {/* Loading animation */}
            {isStreaming && <LoadingAnimation />}

            {/* Spacer for scroll anchor */}
            <div ref={messagesEndRef} className="h-4" />
          </div>
        </div>

        {/* Input */}
        <div className="border-t border-kumo-line bg-kumo-base">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
            className="max-w-3xl mx-auto px-5 py-4"
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                if (e.target.files) addFiles(e.target.files);
                e.target.value = "";
              }}
            />

            {attachments.length > 0 && (
              <div className="flex gap-2 mb-2 flex-wrap">
                {attachments.map((att) => (
                  <div
                    key={att.id}
                    className="relative group rounded-lg border border-kumo-line bg-kumo-control overflow-hidden"
                  >
                    <img
                      src={att.preview}
                      alt={att.file.name}
                      className="h-16 w-16 object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => removeAttachment(att.id)}
                      className="absolute top-0.5 right-0.5 rounded-full bg-kumo-contrast/80 text-kumo-inverse p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                      aria-label={`Remove ${att.file.name}`}
                    >
                      <XIcon size={10} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-end gap-3 rounded-xl border border-kumo-line bg-kumo-base p-3 shadow-sm focus-within:ring-2 focus-within:ring-kumo-ring focus-within:border-transparent transition-shadow">
              <Button
                type="button"
                variant="ghost"
                shape="square"
                aria-label="Attach images"
                icon={<PaperclipIcon size={18} />}
                onClick={() => fileInputRef.current?.click()}
                disabled={!connected || isStreaming}
                className="mb-0.5"
              />
              <InputArea
                ref={textareaRef}
                value={input}
                onValueChange={setInput}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                onInput={(e) => {
                  const el = e.currentTarget;
                  el.style.height = "auto";
                  el.style.height = `${el.scrollHeight}px`;
                }}
                onPaste={handlePaste}
                placeholder={
                  attachments.length > 0
                    ? "Add a message or send images..."
                    : "Send a message..."
                }
                disabled={!connected || isStreaming}
                rows={1}
                className="flex-1 ring-0! focus:ring-0! shadow-none! bg-transparent! outline-none! resize-none max-h-40"
              />
              {isStreaming ? (
                <Button
                  type="button"
                  variant="secondary"
                  shape="square"
                  aria-label="Stop generation"
                  icon={<StopIcon size={18} />}
                  onClick={stop}
                  className="mb-0.5"
                />
              ) : (
                <Button
                  type="submit"
                  variant="primary"
                  shape="square"
                  aria-label="Send message"
                  disabled={
                    (!input.trim() && attachments.length === 0) || !connected
                  }
                  icon={<PaperPlaneRightIcon size={18} />}
                  className="mb-0.5"
                />
              )}
            </div>
          </form>
        </div>
      </div>
    );
  }
);
