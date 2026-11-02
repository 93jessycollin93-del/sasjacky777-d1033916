import { callEdgeFunction } from "@/lib/edgeFunction";
import { useState, useRef, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import { DEFAULT_CHAT_MODEL, type ChatMessage } from "@/lib/jackie-stream";
import { routeChat, type RouteChatOptions } from "@/lib/jackie-router";
import { runChatHarness, type HarnessApproval, type HarnessEvent } from "@/lib/chatHarness";
import type { DevicePersonaIssue } from "@/lib/microai/devicePersona";
import { ChatWorkbench } from "@/components/chat/ChatWorkbench";
import {
  ENGINES,
  DEFAULT_ENGINE,
  findEngine,
  isKnownEngine,
  type EngineId,
} from "@/lib/jackie-engines";
import {
  listConversations,
  createConversation,
  deleteConversation,
  getMessages,
  saveMessage,
  generateTitle,
  updateConversationTitle,
  updateConversationModel,
  getConversationModel,
  type Conversation,
} from "@/lib/jackie-db";
import { getChatPreset, setChatPreset } from "@/lib/jackie-preset";
import { downloadArchive, importArchive } from "@/lib/jackie-archive";
import {
  uploadAttachment,
  getMessageAttachments,
  type Attachment,
} from "@/lib/jackie-attachments";
import { detectSecurityFlag, detectMemoryTier, describeFlag, isCredentialFlag } from "@/lib/jackie-security";
import { useAuth } from "@/hooks/useAuth";
import { useTheme } from "@/hooks/useTheme";
import { voiceManager } from "@/lib/voice-manager";
import { ChatMediaBar, type PendingFile } from "@/components/ChatMediaBar";
import { DeviceModelPanel } from "@/components/microai/DeviceModelPanel";
import { VoiceRecorder } from "@/components/VoiceRecorder";
import { AttachmentDisplay } from "@/components/AttachmentDisplay";
import { toast } from "sonner";
import { SidebarNav } from "@/components/SidebarNav";
import { PalettePicker } from "@/components/PalettePicker";

import { getGameStateContext } from "@/lib/game-state-context";
import { Plus, Trash2, MessageSquare, LogOut, Send, Menu, X, Sun, Moon, Volume2, VolumeX, Download, Mic, ChevronDown, Zap, DollarSign, Search, Tag, XCircle, Pin, Upload, Archive as ArchiveIcon, Square, Cpu } from "lucide-react";
import {
  listTags,
  createTag,
  deleteTag,
  getTagConversationMap,
  addTagToConversation,
  removeTagFromConversation,
  TAG_COLOR_MAP,
  TAG_COLORS,
  type Tag as TagType,
} from "@/lib/jackie-tags";
import {
  buildMemoryContext,
  upsertMemory,
  extractMemoryCandidates,
  getMemories,
  deleteMemory,
  searchMemories,
} from "@/lib/jackie-memory";
import {
  buildTaskContext,
  createTask,
  getTasks,
  updateTask,
  completeTask,
  deleteTask,
  getTaskStats,
} from "@/lib/jackie-tasks";
import {
  buildFileContext,
  generateImage,
  listFiles,
  searchFiles,
} from "@/lib/jackie-files";
import AnimatedCanvas from "@/components/backgrounds/AnimatedCanvas";
import NeutronBackgroundSettings, { loadNeutronSettings, type NeutronBackgroundSettings as NSSettings } from "@/components/backgrounds/NeutronBackgroundSettings";
import { ScrollNav } from "@/components/ScrollNav";
import { Button } from "@/components/ui/button";


interface DisplayMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  memoryTier?: 1 | 2 | 3;
  securityFlag?: string | null;
  attachments?: Attachment[];
  /** Which engine actually answered, and what it fell back from. */
  servedBy?: EngineId;
  servedModel?: string;
  fellBackFrom?: EngineId[];
}

// ─── Sidebar ───────────────────────────────────────────────

const Sidebar = ({
  conversations,
  activeId,
  onSelect,
  onNew,
  onDelete,
  onSignOut,
  userEmail,
  coreFiles,
  isMobileOpen,
  onCloseMobile,
  theme,
  onToggleTheme,
  tags,
  tagMap,
  activeTagFilter,
  onSetTagFilter,
  onCreateTag,
  onDeleteTag,
  onToggleTag,
  onExportArchive,
  onImportArchive,
}: {
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onSignOut: () => void;
  userEmail: string;
  coreFiles: string[];
  isMobileOpen?: boolean;
  onCloseMobile?: () => void;
  theme: string;
  onToggleTheme: () => void;
  tags: TagType[];
  tagMap: Record<string, string[]>;
  activeTagFilter: string | null;
  onSetTagFilter: (tagId: string | null) => void;
  onCreateTag: (name: string, color: string) => void;
  onDeleteTag: (id: string) => void;
  onToggleTag: (convId: string, tagId: string, has: boolean) => void;
  onExportArchive: () => void;
  onImportArchive: (file: File) => void;
}) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [showNewTag, setShowNewTag] = useState(false);
  const [newTagName, setNewTagName] = useState("");
  const [newTagColor, setNewTagColor] = useState<string>("blue");
  const [tagMenuConvId, setTagMenuConvId] = useState<string | null>(null);
  const handleSelect = (id: string) => {
    onSelect(id);
    onCloseMobile?.();
  };

  let filtered = searchQuery.trim()
    ? conversations.filter((c) =>
        c.title.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : conversations;

  if (activeTagFilter) {
    const taggedConvIds = new Set(
      Object.entries(tagMap)
        .filter(([, tids]) => tids.includes(activeTagFilter))
        .map(([cid]) => cid)
    );
    filtered = filtered.filter((c) => taggedConvIds.has(c.id));
  }

  return (
    <>
      {/* Mobile overlay */}
      {isMobileOpen && (
        <div className="fixed inset-0 z-40 bg-black/60 md:hidden" onClick={onCloseMobile} />
      )}
      <aside
        className={`
          w-[280px] h-screen border-r border-border bg-sidebar flex-col
          hidden md:flex
          ${isMobileOpen ? "!flex fixed inset-y-0 left-0 z-50" : ""}
        `}
      >
        <div className="p-4 border-b border-border">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="font-mono text-lg font-bold text-primary tracking-wider">J</span>
              <span className="font-mono text-xs uppercase tracking-widest text-sidebar-foreground">
                Jackie
              </span>
            </div>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onNew}
                className="h-9 rounded-sm px-2 font-mono text-xs text-primary hover:bg-primary/10 hover:text-primary"
                title="New conversation"
                aria-label="Start a new chat"
              >
                <Plus size={16} />
                New
              </Button>
              <button
                onClick={onToggleTheme}
                className="p-1.5 rounded-sm text-muted-foreground hover:text-foreground hover:bg-secondary btn-mechanical transition-colors duration-150"
                title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
              >
                {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
              </button>
              <PalettePicker />
              {isMobileOpen && (
                <button
                  onClick={onCloseMobile}
                  className="p-1.5 rounded-sm text-muted-foreground hover:text-foreground hover:bg-secondary btn-mechanical transition-colors duration-150 md:hidden"
                >
                  <X size={14} />
                </button>
              )}
            </div>
          </div>
          {/* Search */}
          <div className="mt-3 relative">
            <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search conversations…"
              className="w-full pl-7 pr-2 py-1.5 rounded-sm bg-secondary/50 border border-border font-mono text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
            />
          </div>
          {/* Tag filters */}
          {tags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {tags.map((t) => (
                <div key={t.id} className="group/tag inline-flex items-center gap-0.5">
                  <button
                    onClick={() => onSetTagFilter(activeTagFilter === t.id ? null : t.id)}
                    className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-l-sm font-mono text-[10px] border border-r-0 transition-all ${
                      TAG_COLOR_MAP[t.color] || TAG_COLOR_MAP.blue
                    } ${activeTagFilter === t.id ? "ring-1 ring-primary" : "opacity-70 hover:opacity-100"}`}
                  >
                    {t.name}
                    {activeTagFilter === t.id && <X size={8} />}
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); onDeleteTag(t.id); }}
                    className={`px-0.5 py-0.5 rounded-r-sm font-mono text-[10px] border transition-all opacity-0 group-hover/tag:opacity-100 hover:!text-destructive ${
                      TAG_COLOR_MAP[t.color] || TAG_COLOR_MAP.blue
                    }`}
                    title={`Delete "${t.name}" tag`}
                  >
                    <Trash2 size={8} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
          <div className="px-2 py-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground flex items-center justify-between">
            <span>Conversations {(searchQuery || activeTagFilter) && `(${filtered.length})`}</span>
          </div>
          {filtered.length === 0 && (
            <div className="px-2 py-2 text-xs text-muted-foreground">
              {searchQuery || activeTagFilter ? "No matches found." : "No conversations yet."}
            </div>
          )}
          {filtered.map((conv) => {
            const convTags = (tagMap[conv.id] || []).map((tid) => tags.find((t) => t.id === tid)).filter(Boolean) as TagType[];
            return (
              <div
                key={conv.id}
                className={`group flex flex-col rounded-sm transition-colors duration-150 ${
                  activeId === conv.id
                    ? "bg-secondary text-foreground"
                    : "text-sidebar-foreground hover:bg-secondary/50"
                }`}
              >
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleSelect(conv.id)}
                    className="flex-1 text-left px-2 py-1.5 font-mono text-xs truncate btn-mechanical flex items-center gap-2"
                  >
                    <MessageSquare size={12} className="flex-shrink-0 text-muted-foreground" />
                    {conv.title}
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); setTagMenuConvId(tagMenuConvId === conv.id ? null : conv.id); }}
                    className="opacity-0 group-hover:opacity-100 p-1 text-muted-foreground hover:text-foreground transition-opacity duration-150"
                    title="Manage tags"
                  >
                    <Tag size={10} />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); onDelete(conv.id); }}
                    className="opacity-0 group-hover:opacity-100 p-1 mr-1 text-muted-foreground hover:text-destructive transition-opacity duration-150"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
                {/* Tag badges */}
                {convTags.length > 0 && (
                  <div className="flex flex-wrap gap-1 px-2 pb-1">
                    {convTags.map((t) => (
                      <span key={t.id} className={`px-1 py-0 rounded-sm font-mono text-[9px] border ${TAG_COLOR_MAP[t.color] || TAG_COLOR_MAP.blue}`}>
                        {t.name}
                      </span>
                    ))}
                  </div>
                )}
                {/* Tag menu */}
                {tagMenuConvId === conv.id && (
                  <div className="mx-2 mb-1 p-2 bg-popover border border-border rounded-sm space-y-1">
                    {tags.map((t) => {
                      const has = (tagMap[conv.id] || []).includes(t.id);
                      return (
                        <button
                          key={t.id}
                          onClick={() => onToggleTag(conv.id, t.id, has)}
                          className={`w-full text-left px-2 py-1 rounded-sm font-mono text-[10px] flex items-center gap-2 hover:bg-secondary transition-colors ${has ? "text-foreground" : "text-muted-foreground"}`}
                        >
                          <span className={`w-2 h-2 rounded-full ${has ? "bg-primary" : "bg-muted-foreground/30"}`} />
                          <span className={`px-1 rounded-sm border ${TAG_COLOR_MAP[t.color] || TAG_COLOR_MAP.blue}`}>{t.name}</span>
                        </button>
                      );
                    })}
                    {tags.length === 0 && <div className="text-[10px] text-muted-foreground">No tags yet</div>}
                    <button
                      onClick={() => setShowNewTag(true)}
                      className="w-full text-left px-2 py-1 font-mono text-[10px] text-primary hover:bg-secondary rounded-sm"
                    >
                      + New tag
                    </button>
                  </div>
                )}
              </div>
            );
          })}

          {/* New tag popover */}
          {showNewTag && (
            <div className="mx-2 mt-2 p-2 bg-popover border border-border rounded-sm space-y-2">
              <input
                type="text"
                value={newTagName}
                onChange={(e) => setNewTagName(e.target.value)}
                placeholder="Tag name"
                className="w-full px-2 py-1 bg-secondary/50 border border-border rounded-sm font-mono text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
                autoFocus
              />
              <div className="flex flex-wrap gap-1">
                {TAG_COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => setNewTagColor(c)}
                    className={`w-4 h-4 rounded-full border-2 ${newTagColor === c ? "border-foreground" : "border-transparent"} ${TAG_COLOR_MAP[c]?.split(" ")[0] || "bg-blue-500/20"}`}
                  />
                ))}
              </div>
              <div className="flex gap-1">
                <button
                  onClick={() => {
                    if (newTagName.trim()) {
                      onCreateTag(newTagName.trim(), newTagColor);
                      setNewTagName("");
                      setShowNewTag(false);
                    }
                  }}
                  className="px-2 py-1 bg-primary text-primary-foreground font-mono text-[10px] rounded-sm hover:opacity-90"
                >
                  Create
                </button>
                <button
                  onClick={() => { setShowNewTag(false); setNewTagName(""); }}
                  className="px-2 py-1 font-mono text-[10px] text-muted-foreground hover:text-foreground"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="border-t border-border p-2 flex-shrink-0 max-h-[45vh] overflow-y-auto space-y-0.5">
          <SidebarNav onNavigate={onCloseMobile} />
          <div className="px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground/70">
            Press ⌘K anywhere to jump to all 84 Eru modules.
          </div>
          <div className="px-2 py-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Core
          </div>
          {coreFiles.map((file) => (
            <div key={file} className="px-2 py-1 font-mono text-[11px] text-muted-foreground truncate">
              {file}
            </div>
          ))}
        </div>


        <div className="p-4 border-t border-border space-y-2">
          <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground/70 flex items-center gap-1.5">
            <ArchiveIcon size={10} /> Archive
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onExportArchive}
              className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground hover:text-primary transition-colors"
              title="Export all conversations to a JSON file"
            >
              <Download size={10} /> Export
            </button>
            <label
              className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground hover:text-primary transition-colors cursor-pointer"
              title="Import a Jackie archive JSON file"
            >
              <Upload size={10} /> Import
              <input
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onImportArchive(f);
                  e.currentTarget.value = "";
                }}
              />
            </label>
          </div>
          <div className="font-mono text-[10px] text-muted-foreground truncate pt-2 border-t border-border/50" title={userEmail}>
            {userEmail}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onSignOut}
              className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground hover:text-destructive transition-colors"
            >
              <LogOut size={10} />
              Sign Out
            </button>
          </div>
        </div>
      </aside>
    </>
  );
};

// ─── Memory Dots ───────────────────────────────────────────

const MemoryDots = ({ tier }: { tier: 1 | 2 | 3 }) => (
  <div className="flex gap-1 items-center" title={`Memory tier: ${["Ephemeral", "Durable", "Gold"][tier - 1]}`}>
    {[1, 2, 3].map((i) => (
      <span key={i} className={`memory-dot ${i <= tier ? "active" : ""}`} />
    ))}
  </div>
);

// ─── Messages ──────────────────────────────────────────────

/**
 * The model an engine should open on.
 *
 * `saved` is honoured only when it belongs to that engine — a model id left
 * behind by a previous engine is worse than no preference at all, because the
 * picker shows it and the engine rejects it.
 */
function modelFor(engine: EngineId, saved?: string): string {
  const def = findEngine(engine);
  if (!def) return DEFAULT_CHAT_MODEL;
  if (saved && def.models.some((m) => m.id === saved)) return saved;
  return def.models[0]?.id ?? "";
}

const JackieMessage = ({ message }: { message: DisplayMessage }) => {
  const [speaking, setSpeaking] = useState(false);

  const toggleSpeak = async () => {
    if (speaking) {
      voiceManager.stop();
      setSpeaking(false);
    } else {
      setSpeaking(true);
      try {
        await voiceManager.speak(message.content);
      } catch {
        // ignore
      }
      setSpeaking(false);
    }
  };

  return (
    <div className="rounded-2xl border border-border bg-card/95 p-4 space-y-3 stagger-enter">
      <div className="flex items-center justify-between">
        <span className="jackie-badge">Jackie here—</span>
        <div className="flex items-center gap-2">
          {voiceManager.isSupported() && (
            <button
              onClick={toggleSpeak}
              className="p-1 rounded-sm text-muted-foreground hover:text-primary transition-colors"
              title={speaking ? "Stop speaking" : "Read aloud"}
            >
              {speaking ? <VolumeX size={12} /> : <Volume2 size={12} />}
            </button>
          )}
          {message.memoryTier && <MemoryDots tier={message.memoryTier} />}
        </div>
      </div>

      {message.securityFlag && (
        <div className={isCredentialFlag(message.securityFlag) ? "jackie-security-flag" : "jackie-security-flag jackie-security-flag--topic"}>
          <div className="font-mono text-xs font-semibold uppercase tracking-wider mb-1">
            {isCredentialFlag(message.securityFlag) ? "⚠" : "ⓘ"} {message.securityFlag}
          </div>
        </div>
      )}

      <MarkdownRenderer content={message.content} />

      {message.attachments && message.attachments.length > 0 && (
        <AttachmentDisplay attachments={message.attachments} />
      )}

      <div className="flex flex-wrap items-center gap-2 font-mono text-[10px] text-muted-foreground">
        <span>{message.timestamp.toLocaleTimeString("en-US", { hour12: false })}</span>
        {message.servedBy && (
          <span
            className={message.fellBackFrom?.length ? "text-yellow-500" : ""}
            title={
              message.fellBackFrom?.length
                ? `Fell back from ${message.fellBackFrom
                    .map((id) => findEngine(id)?.short ?? id)
                    .join(" → ")}`
                : "Engine that answered"
            }
          >
            · {findEngine(message.servedBy)?.short ?? message.servedBy}
            {message.servedModel ? ` · ${message.servedModel}` : ""}
            {message.fellBackFrom?.length ? " · fallback" : ""}
          </span>
        )}
      </div>
    </div>
  );
};

const UserMessage = ({ message }: { message: DisplayMessage }) => (
  <div className="ml-auto max-w-[92%] rounded-2xl border border-primary/20 bg-primary/5 p-4 space-y-2">
    <div className="font-mono text-[10px] uppercase tracking-widest text-primary">You</div>
    <div className="text-foreground leading-relaxed text-sm whitespace-pre-wrap break-words">
      {message.content}
    </div>
    {message.attachments && message.attachments.length > 0 && (
      <AttachmentDisplay attachments={message.attachments} />
    )}
    <div className="font-mono text-[10px] text-muted-foreground">
      {message.timestamp.toLocaleTimeString("en-US", { hour12: false })}
    </div>
  </div>
);

// ─── Main Page ─────────────────────────────────────────────

const CORE_FILES = [
  "CORE_IDENTITY.md",
  "BEHAVIOR_RULES.md",
  "MEMORY_MODEL.md",
  "SECURITY_PRINCIPLES.md",
  "ARCHITECTURE.md",
  "ROADMAP.md",
];

const Index = () => {
  const { user, signOut } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [bgSettings, setBgSettings] = useState<NSSettings>(() => loadNeutronSettings());
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  // A model id persisted by an older build can outlive the list that contains
  // it. Handing an unknown id to the function meant a silent fall back to
  // whatever its own default was, so the label said one thing and the answer
  // came from another. Unknown ids resolve to the shared default instead.
  // Which engine answers first. The rest of the chain still covers for it, so
  // this is a preference rather than a restriction — picking Ollama does not
  // mean the chat dies when the box is asleep.
  const [selectedEngine, setSelectedEngine] = useState<EngineId>(() => {
    const saved = getChatPreset().engine;
    return isKnownEngine(saved) ? saved : DEFAULT_ENGINE;
  });
  // A model id persisted by an older build can outlive the list that contains
  // it. Handing an unknown id to the function meant a silent fall back to
  // whatever its own default was, so the label said one thing and the answer
  // came from another. Unknown ids resolve to the engine's own default instead.
  const [selectedModel, setSelectedModel] = useState<string>(() => {
    const preset = getChatPreset();
    const engine = isKnownEngine(preset.engine) ? preset.engine : DEFAULT_ENGINE;
    return modelFor(engine, preset.model);
  });
  const [presetModel, setPresetModel] = useState<string>(() => getChatPreset().model);
  const [presetEngine, setPresetEngine] = useState<string>(() => getChatPreset().engine);
  /** Set while an answer is being served by something other than the choice. */
  const [routeNote, setRouteNote] = useState<string | null>(null);
  /** What an engine running in this tab is doing before its first word. */
  const [engineStatus, setEngineStatus] = useState<string | null>(null);
  const [focusMode, setFocusMode] = useState(true);
  const [harnessMode, setHarnessMode] = useState<"chat" | "harness">("chat");
  const [reviewWrites, setReviewWrites] = useState(false);
  const [runOutcome, setRunOutcome] = useState<"idle" | "working" | "complete" | "blocked" | "stopped">("idle");
  const [runEvents, setRunEvents] = useState<HarnessEvent[]>([]);
  const [runError, setRunError] = useState<string | null>(null);
  const [profileIssue, setProfileIssue] = useState<DevicePersonaIssue | null>(null);
  const [pendingApproval, setPendingApproval] = useState<HarnessApproval | null>(null);
  const approvalRef = useRef<((approved: boolean) => void) | null>(null);
  const lastPromptRef = useRef("");
  const recordRunEvent = useCallback((label: string, kind: HarnessEvent["kind"] = "info") => {
    setRunEvents((events) => [...events.slice(-23), { id: `${Date.now()}-${Math.random()}`, at: Date.now(), label, kind }]);
  }, []);
  const decideAction = useCallback((approved: boolean) => {
    approvalRef.current?.(approved);
    approvalRef.current = null;
    setPendingApproval(null);
  }, []);

  const engineDef = findEngine(selectedEngine);
  const engineModels = engineDef?.models ?? [];
  const isPinnedDefault = presetEngine === selectedEngine && presetModel === selectedModel;

  const saveCurrentAsPreset = useCallback(() => {
    setChatPreset({ engine: selectedEngine, provider: "lovable", model: selectedModel });
    setPresetModel(selectedModel);
    setPresetEngine(selectedEngine);
    toast.success("Default engine and model saved for new chats.");
  }, [selectedEngine, selectedModel]);
  const [tags, setTags] = useState<TagType[]>([]);
  const [tagMap, setTagMap] = useState<Record<string, string[]>>({});
  const [activeTagFilter, setActiveTagFilter] = useState<string | null>(null);
  const [rateLimitCooldown, setRateLimitCooldown] = useState(0);
  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Holds the answer in flight so it can be stopped. Without this the composer
  // stayed locked until the model finished or the tab was reloaded.
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => { abortRef.current?.abort(); approvalRef.current?.(false); }, [user?.id]);

  const changeModel = useCallback(async (model: string) => {
    setSelectedModel(model);
    if (activeConvId) {
      try { await updateConversationModel(activeConvId, model); } catch { /* best effort */ }
    }
  }, [activeConvId]);

  /**
   * Switching engine switches model with it.
   *
   * Ollama cannot serve `google/gemini-2.5-flash` and the cloud gateway cannot
   * serve `llama3.2:3b`. Carrying the old id across meant the first send after
   * every switch failed on a model the new engine had never heard of.
   */
  const changeEngine = useCallback(async (id: EngineId) => {
    setSelectedEngine(id);
    setRouteNote(null);
    const model = modelFor(id);
    setSelectedModel(model);
    if (activeConvId && model) {
      try { await updateConversationModel(activeConvId, model); } catch { /* best effort */ }
    }
  }, [activeConvId]);

  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [engineMenuOpen, setEngineMenuOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const dragCounter = useRef(0);
  const feedRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const loadTags = useCallback(async () => {
    try {
      const [t, m] = await Promise.all([listTags(), getTagConversationMap()]);
      setTags(t);
      setTagMap(m);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    loadConversations(true);
    loadTags();
  }, []);

  const handleCreateTag = async (name: string, color: string) => {
    try {
      await createTag(name, color);
      await loadTags();
    } catch (e: any) {
      toast.error(e.message?.includes("duplicate") ? "Tag already exists" : "Failed to create tag");
    }
  };

  const handleDeleteTag = async (id: string) => {
    try {
      await deleteTag(id);
      if (activeTagFilter === id) setActiveTagFilter(null);
      await loadTags();
    } catch { toast.error("Failed to delete tag"); }
  };

  const handleToggleTag = async (convId: string, tagId: string, has: boolean) => {
    try {
      if (has) await removeTagFromConversation(convId, tagId);
      else await addTagToConversation(convId, tagId);
      await loadTags();
    } catch { toast.error("Failed to update tag"); }
  };

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + "px";
    }
  }, [input]);

  const loadConversations = async (autoSelect = false) => {
    try {
      const convs = await listConversations();
      setConversations(convs);
      if (autoSelect && convs.length > 0 && !activeConvId) {
        setActiveConvId(convs[0].id);
        loadMessages(convs[0].id);
      }
    } catch (e) {
      console.error("Failed to load conversations:", e);
    }
  };

  const loadMessages = useCallback(async (convId: string) => {
    try {
      const msgs = await getMessages(convId);
      const display: DisplayMessage[] = await Promise.all(
        msgs.map(async (m) => {
          let attachments: Attachment[] = [];
          try {
            attachments = await getMessageAttachments(m.id);
          } catch { /* no attachments */ }
          return {
            id: m.id,
            role: m.role as "user" | "assistant",
            content: m.content,
            timestamp: new Date(m.created_at),
            memoryTier: (m.memory_tier as 1 | 2 | 3) ?? 1,
            securityFlag: describeFlag(m.security_flag),
            attachments,
          };
        })
      );
      setMessages(display);
      setChatHistory(
        msgs.map((m) => ({ role: m.role as "user" | "assistant", content: m.content }))
      );
    } catch (e) {
      console.error("Failed to load messages:", e);
    }
  }, []);

  const selectConversation = useCallback(
    async (id: string) => {
      if (isProcessing) { toast.info("Stop the current run before switching conversations."); return; }
      setRunEvents([]); setRunError(null); setProfileIssue(null); setRunOutcome("idle");
      setActiveConvId(id);
      loadMessages(id);
      try {
        const model = await getConversationModel(id);
        // Only adopt a stored model the current engine can actually serve.
        if (typeof model === "string" && model) {
          const resolved = modelFor(selectedEngine, model);
          if (resolved === model) setSelectedModel(model);
        }
      } catch { /* use current */ }
    },
    [loadMessages, selectedEngine, isProcessing]
  );

  const startNewConversation = () => {
    if (isProcessing) { toast.info("Stop the current run before starting another chat."); return; }
    setRunEvents([]); setRunError(null); setProfileIssue(null); setRunOutcome("idle");
    lastPromptRef.current = "";
    setActiveConvId(null);
    setMessages([]);
    setChatHistory([]);
    setInput("");
    setRouteNote(null);
    // Apply the saved engine + model preset for every new chat.
    const preset = getChatPreset();
    const engine = isKnownEngine(preset.engine) ? preset.engine : DEFAULT_ENGINE;
    setSelectedEngine(engine);
    setSelectedModel(modelFor(engine, preset.model));
  };

  const handleExportArchive = async () => {
    try {
      const count = await downloadArchive();
      toast.success(`Archive exported (${count} conversation${count === 1 ? "" : "s"}).`);
    } catch (e: any) {
      toast.error(e?.message || "Export failed.");
    }
  };

  const handleImportArchive = async (file: File) => {
    try {
      toast.info("Importing archive…");
      const { conversations: c, messages: m, skipped } = await importArchive(file);
      toast.success(`Imported ${c} conversation${c === 1 ? "" : "s"}, ${m} message${m === 1 ? "" : "s"}${skipped ? ` (${skipped} skipped)` : ""}.`);
      await loadConversations();
    } catch (e: any) {
      toast.error(e?.message || "Import failed.");
    }
  };

  const handleDeleteConversation = async (id: string) => {
    if (isProcessing && id === activeConvId) { toast.info("Stop this run before deleting its conversation."); return; }
    try {
      await deleteConversation(id);
      if (activeConvId === id) {
        setActiveConvId(null);
        setMessages([]);
        setChatHistory([]);
      }
      await loadConversations();
    } catch {
      toast.error("Failed to delete conversation.");
    }
  };

  const scrollToBottom = () => {
    setTimeout(() => {
      feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: "smooth" });
    }, 50);
  };

  // ── Slash Command Handler ──
  const handleSlashCommand = async (text: string, convId: string): Promise<string | null> => {
    const parts = text.split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1).join(' ');

    switch (cmd) {
      case '/remember': {
        if (!args) return "**Usage:** `/remember <key> = <value>`\nExample: `/remember preferred_framework = React with TypeScript`";
        const [key, ...valParts] = args.split('=');
        const value = valParts.join('=').trim();
        if (!key.trim() || !value) return "**Format:** `/remember key = value`";
        try {
          await upsertMemory(key.trim(), value, 'preference', convId);
          return `✅ **Remembered:** ${key.trim()} → ${value}`;
        } catch (e: any) {
          return `❌ Failed to save memory: ${e.message}`;
        }
      }
      case '/memories': {
        try {
          const mems = args ? await searchMemories(args) : await getMemories();
          if (mems.length === 0) return "📭 No memories stored yet. Use `/remember key = value` to teach me.";
          let out = "## 🧠 Jackie's Memory\n\n";
          for (const m of mems.slice(0, 20)) {
            out += `- **${m.key}** → ${m.value} _(${m.category}, ${(m.confidence * 100).toFixed(0)}%)_\n`;
          }
          return out;
        } catch (e: any) {
          return `❌ ${e.message}`;
        }
      }
      case '/forget': {
        if (!args) return "**Usage:** `/forget <search term>`";
        try {
          const mems = await searchMemories(args);
          if (mems.length === 0) return "No matching memories found.";
          for (const m of mems) await deleteMemory(m.id);
          return `🗑️ Forgot ${mems.length} memor${mems.length === 1 ? 'y' : 'ies'} matching "${args}"`;
        } catch (e: any) {
          return `❌ ${e.message}`;
        }
      }
      case '/task': {
        if (!args) return "**Usage:** `/task <title>` — Creates a new task\nOr: `/task done <id>` `/task list`";
        if (args.toLowerCase() === 'list') {
          const tasks = await getTasks();
          if (tasks.length === 0) return "📋 No tasks. Create one with `/task <title>`";
          let out = "## 📋 Tasks\n\n";
          const statusEmoji: Record<string, string> = { todo: '📋', in_progress: '🔧', done: '✅', blocked: '🚫' };
          const prioEmoji: Record<string, string> = { critical: '🔴', high: '🟠', medium: '🟡', low: '🟢' };
          for (const t of tasks) {
            out += `- ${statusEmoji[t.status] || ''} ${prioEmoji[t.priority] || ''} **${t.title}** _(${t.status})_ \`${t.id.slice(0, 8)}\`\n`;
          }
          return out + "\n_All of them, by column: 📋 Task Board in the menu, at `/tasks`._";
        }
        try {
          const task = await createTask(args);
          return `✅ **Task created:** ${task.title} \`${task.id.slice(0, 8)}\``;
        } catch (e: any) {
          return `❌ ${e.message}`;
        }
      }
      case '/done': {
        if (!args) return "**Usage:** `/done <task-id-prefix>`";
        try {
          const tasks = await getTasks();
          const match = tasks.find(t => t.id.startsWith(args.trim()));
          if (!match) return "❌ No task found with that ID prefix.";
          await completeTask(match.id);
          return `✅ **Completed:** ${match.title}`;
        } catch (e: any) {
          return `❌ ${e.message}`;
        }
      }
      case '/files': {
        try {
          const files = args ? await searchFiles(args) : await listFiles(convId);
          if (files.length === 0) return "📁 No files found.";
          let out = "## 📁 Files\n\n";
          for (const f of files.slice(0, 20)) {
            const size = f.size < 1024 ? `${f.size}B` : f.size < 1048576 ? `${(f.size / 1024).toFixed(1)}KB` : `${(f.size / 1048576).toFixed(1)}MB`;
            out += `- 📎 **${f.name}** (${f.type}, ${size})\n`;
          }
          return out;
        } catch (e: any) {
          return `❌ ${e.message}`;
        }
      }
      case '/imagine': {
        if (!args) return "**Usage:** `/imagine <description>`\nExample: `/imagine a futuristic city skyline at sunset`";
        try {
          toast.info("🎨 Generating image...");
          const result = await generateImage(args);
          return `## 🎨 Generated Image\n\n![Generated](${result.image})\n\n${result.text || ''}`;
        } catch (e: any) {
          return `❌ Image generation failed: ${e.message}`;
        }
      }
      case '/stats': {
        try {
          const [taskStats, memCount] = await Promise.all([getTaskStats(), getMemories()]);
          return `## 📊 Jackie Stats\n\n**Tasks:** ${taskStats.total} total (${taskStats.todo} todo, ${taskStats.inProgress} active, ${taskStats.done} done, ${taskStats.blocked} blocked)\n**Critical:** ${taskStats.critical}\n**Memories:** ${memCount.length} stored\n**Model:** ${selectedModel}`;
        } catch {
          return "❌ Failed to load stats.";
        }
      }
      case '/discernment': {
        if (!args) return "**Usage:** `/discernment <URL, tool name, or description>`\nExample: `/discernment https://free-followers-now.xyz`\nJackie will analyze it through Jessy's discernment lens.";
        try {
          toast.info("🔍 Analyzing...");
          const discernmentPrompt = `Analyze the following through Jessy's discernment lens. Evaluate whether this is signal or bait, real value or distraction, trustworthy or a trap. Be calm, precise, and protective — not harsh or reactive.

Subject to evaluate: "${args}"

Provide your assessment in this structure:
1. **Trust Level** — rate as: ✅ Clean, ⚠️ Caution, or 🚫 Avoid
2. **What it claims** — what does it present itself as?
3. **What it likely is** — your honest read
4. **Red flags** — specific concerns (or "None detected")
5. **Recommendation** — calm, actionable guidance

Keep it concise but thorough. No hype, no false alarm — just truth.`;

          // Was hardcoded to a different Supabase project entirely
          // (rkwhhbxgjdpehfuxsult), so this could never reach this app's
          // functions no matter what was deployed.
          const res = await callEdgeFunction('jackie-chat', {
            model: selectedModel,
            messages: [{ role: 'user', content: discernmentPrompt }],
          });
          if (!res.ok) throw new Error('Analysis failed');
          const reader = res.body?.getReader();
          if (!reader) throw new Error('No response stream');
          let result = '';
          const decoder = new TextDecoder();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value);
            for (const line of chunk.split('\n')) {
              if (!line.startsWith('data: ') || line.includes('[DONE]')) continue;
              try {
                const j = JSON.parse(line.slice(6));
                result += j.choices?.[0]?.delta?.content || '';
              } catch {}
            }
          }
          return `## 🔍 Discernment Analysis\n\n${result || 'No assessment could be generated.'}`;
        } catch (e: any) {
          return `❌ Discernment analysis failed: ${e.message}`;
        }
      }
      case '/help':
        return `## Jackie Commands\n
| Command | Description |
|---------|------------|
| \`/remember key = value\` | Teach Jackie a preference or decision |
| \`/memories [search]\` | View stored memories |
| \`/forget <search>\` | Delete matching memories |
| \`/task <title>\` | Create a coding task |
| \`/task list\` | Show all tasks |
| \`/done <id>\` | Mark task complete |
| \`/files [search]\` | Browse uploaded files |
| \`/imagine <prompt>\` | Generate an image |
| \`/discernment <subject>\` | Analyze a URL, tool, or offer for trust |
| \`/stats\` | View Jackie's stats |
| \`/help\` | Show this guide |`;
      default:
        return null; // Not a recognized command, proceed as normal message
    }
  };

  const handleSubmit = async () => {
    if ((!input.trim() && pendingFiles.length === 0) || isProcessing || rateLimitCooldown > 0) return;

    const userText = input.trim();
    const controller = new AbortController();
    abortRef.current = controller;
    lastPromptRef.current = userText;
    setRunEvents([]); setRunError(null); setProfileIssue(null); setRunOutcome("working");
    recordRunEvent(harnessMode === "harness" ? "Starting a bounded agent run" : "Starting a chat turn");
    const filesToUpload = [...pendingFiles];
    setInput("");
    setPendingFiles([]);
    setIsProcessing(true);

    let convId = activeConvId;
    if (!convId) {
      try {
        const conv = await createConversation(generateTitle(userText || "Attachment"));
        convId = conv.id;
        setActiveConvId(convId);
        await updateConversationModel(convId, selectedModel);
        await loadConversations();
      } catch {
        toast.error("Failed to create conversation.");
        setRunError("Could not create this conversation. Restore your prompt and try again.");
        setRunOutcome("blocked");
        setIsProcessing(false);
        return;
      }
    }

    // ── Slash Commands ──
    if (harnessMode === "chat" && userText.startsWith('/')) {
      const slashResult = await handleSlashCommand(userText, convId);
      if (slashResult) {
        const sysMsg: DisplayMessage = {
          id: Date.now().toString(),
          role: "assistant",
          content: slashResult,
          timestamp: new Date(),
          memoryTier: 1,
        };
        setMessages((prev) => [...prev, sysMsg]);
        try { await saveMessage({ conversation_id: convId, role: "assistant", content: slashResult }); } catch {}
        setIsProcessing(false);
        setRunOutcome("complete");
        recordRunEvent("App command completed", "success");
        scrollToBottom();
        return;
      }
    }

    // Upload attachments
    let uploadedAttachments: Attachment[] = [];
    if (filesToUpload.length > 0) {
      try {
        uploadedAttachments = await Promise.all(
          filesToUpload.map((pf) => uploadAttachment(pf.file, convId!))
        );
        // Clean up previews
        filesToUpload.forEach((pf) => { if (pf.preview) URL.revokeObjectURL(pf.preview); });
      } catch {
        toast.error("Failed to upload attachments.");
      }
    }

    const displayContent = userText || (uploadedAttachments.length > 0 ? `[${uploadedAttachments.length} file(s) attached]` : "");

    const userMsg: DisplayMessage = {
      id: Date.now().toString(),
      role: "user",
      content: displayContent,
      timestamp: new Date(),
      attachments: uploadedAttachments,
    };
    setMessages((prev) => [...prev, userMsg]);
    scrollToBottom();

    try {
      await saveMessage({ conversation_id: convId, role: "user", content: displayContent });
    } catch {
      console.error("Failed to persist user message");
    }

    const newHistory: ChatMessage[] = [...chatHistory, { role: "user", content: displayContent }];
    setChatHistory(newHistory);

    const assistantTempId = (Date.now() + 1).toString();
    let assistantContent = "";

    setMessages((prev) => [
      ...prev,
      { id: assistantTempId, role: "assistant", content: "", timestamp: new Date(), memoryTier: 1 },
    ]);

    const gameContext = getGameStateContext();
    // Inject Jackie's memory + tasks into context
    let jackieContext = gameContext;
    try {
      const [memCtx, taskCtx, fileCtx] = await Promise.all([
        buildMemoryContext(),
        buildTaskContext(),
        convId ? buildFileContext(convId) : Promise.resolve(""),
      ]);
      jackieContext = [gameContext, memCtx, taskCtx, fileCtx].filter(Boolean).join("\n");
    } catch { /* graceful degradation */ }

    // `streamChat` calls exactly one of onDone/onError, or neither when the
    // user stopped it. This records which happened, so the stopped-answer
    // handling below cannot also fire if a stop lands in the same tick as a
    // completion and save the answer twice.
    let settled = false;

    setRouteNote(null);

    const routeOptions: RouteChatOptions = {
      messages: newHistory,
      engine: selectedEngine,
      model: selectedModel,
      context: jackieContext,
      signal: controller.signal,
      // Reported, never swallowed. An answer that quietly came from a different
      // engine than the one named on screen is how a chat ends up lying about
      // what it is.
      onRoute: ({ engine, from, reason }) => {
        recordRunEvent(`Calling ${findEngine(engine)?.short ?? engine}`);
        if (!from) return;
        const to = findEngine(engine)?.short ?? engine;
        const failed = findEngine(from)?.short ?? from;
        setRouteNote(`${failed} could not answer — trying ${to}.`);
        console.warn(`[jackie] ${failed} → ${to}: ${reason}`);
      },
      onStatus: setEngineStatus,
      onIssue: setProfileIssue,
      // A failover after partial output starts the answer over; the half from
      // the engine that broke must not be kept in front of it.
      onReset: () => {
        assistantContent = "";
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantTempId ? { ...m, content: "" } : m))
        );
      },
      onDelta: (chunk) => {
        assistantContent += chunk;
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantTempId ? { ...m, content: assistantContent } : m))
        );
        scrollToBottom();
      },
      onDone: async ({ engine, model, fellBackFrom }) => {
        settled = true;
        abortRef.current = null;
        setRunOutcome("complete");
        setEngineStatus(null);
        recordRunEvent(`Answer received from ${findEngine(engine)?.short ?? engine}`, "success");
        const securityFlag = detectSecurityFlag(assistantContent);
        const memoryTier = detectMemoryTier(assistantContent, userText);

        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantTempId
              ? { ...m, securityFlag, memoryTier, servedBy: engine, servedModel: model, fellBackFrom }
              : m
          )
        );

        if (fellBackFrom.length) {
          const served = findEngine(engine)?.short ?? engine;
          const failed = fellBackFrom.map((id) => findEngine(id)?.short ?? id).join(", ");
          setRouteNote(`Answered by ${served} after ${failed} could not.`);
        } else {
          setRouteNote(null);
        }

        setChatHistory((prev) => [...prev, { role: "assistant", content: assistantContent }]);

        try {
          await saveMessage({
            conversation_id: convId!,
            role: "assistant",
            content: assistantContent,
            memory_tier: memoryTier,
            security_flag: securityFlag,
          });

          if (newHistory.length === 1) {
            await updateConversationTitle(convId!, generateTitle(userText));
            await loadConversations();
          }
        } catch {
          console.error("Failed to persist assistant message");
        }

        // Auto-extract memories from conversation
        try {
          // A read-only harness must not write memories through the chat's
          // automatic extractor after its tools correctly refused a write.
          const candidates = harnessMode === "chat" ? extractMemoryCandidates(userText, assistantContent) : [];
          for (const c of candidates) {
            await upsertMemory(c.key, c.value, c.category, convId!);
          }
        } catch { /* silent */ }

        setIsProcessing(false);
      },
      onError: (err) => {
        settled = true;
        setRunOutcome("blocked");
        setRunError(err);
        setEngineStatus(null);
        recordRunEvent("Run blocked: " + err, "error");
        abortRef.current = null;
        if (err.includes("Rate limit") || err.includes("rate limit")) {
          const seconds = 30;
          setRateLimitCooldown(seconds);
          if (cooldownRef.current) clearInterval(cooldownRef.current);
          cooldownRef.current = setInterval(() => {
            setRateLimitCooldown((prev) => {
              if (prev <= 1) {
                clearInterval(cooldownRef.current!);
                cooldownRef.current = null;
                return 0;
              }
              return prev - 1;
            });
          }, 1000);
        } else if (selectedEngine !== "device") {
          toast.error(err);
        }
        setMessages((prev) => prev.filter((m) => m.id !== assistantTempId));
        setRouteNote(null);
        setIsProcessing(false);
      },
    };
    try {
      if (harnessMode === "harness") {
        if (!user?.id) throw new Error("Sign in before running an agent harness.");
        const result = await runChatHarness({
          userId: user.id, messages: newHistory, engine: selectedEngine, model: selectedModel,
          context: jackieContext, signal: controller.signal, reviewWrites,
          onEvent: recordRunEvent, onStatus: setEngineStatus, onIssue: setProfileIssue,
          requestApproval: (action) => new Promise<boolean>((resolve) => {
            if (controller.signal.aborted) { resolve(false); return; }
            setPendingApproval(action);
            const stop = () => finish(false);
            const finish = (approved: boolean) => {
              controller.signal.removeEventListener("abort", stop);
              if (approvalRef.current === finish) approvalRef.current = null;
              setPendingApproval(null);
              resolve(approved);
            };
            approvalRef.current = finish;
            controller.signal.addEventListener("abort", stop, { once: true });
          }),
        });
        if (!controller.signal.aborted) {
          if (result.ok && result.route) {
            assistantContent = result.answer;
            setMessages((prev) => prev.map((m) => m.id === assistantTempId ? { ...m, content: assistantContent } : m));
            await routeOptions.onDone(result.route);
          } else routeOptions.onError(result.error ?? "The harness did not produce a final answer.");
        }
      } else await routeChat(routeOptions);
    } catch (error) {
      if (!controller.signal.aborted && !settled) routeOptions.onError(error instanceof Error ? error.message : "This run failed unexpectedly.");
    } finally {
      setEngineStatus(null);
      decideAction(false);
    }

    // Stopping is neither success nor failure, so `streamChat` calls neither
    // callback. What already streamed is still worth keeping — throwing away a
    // half-written answer the moment someone stops it is the wrong instinct.
    if (controller.signal.aborted && !settled) {
      setRunOutcome("stopped");
      recordRunEvent("Stopped by you");
      abortRef.current = null;
      if (assistantContent.trim()) {
        setChatHistory((prev) => [...prev, { role: "assistant", content: assistantContent }]);
        try {
          await saveMessage({
            conversation_id: convId!,
            role: "assistant",
            content: assistantContent,
            memory_tier: 1,
          });
        } catch { /* the message is on screen either way */ }
      } else {
        setMessages((prev) => prev.filter((m) => m.id !== assistantTempId));
      }
      setIsProcessing(false);
    }
  };

  /** Stops the answer in flight, keeping whatever has already arrived. */
  const handleStop = () => {
    abortRef.current?.abort();
    abortRef.current = null;
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData.items);
    const imageItems = items.filter((item) => item.type.startsWith("image/"));
    if (imageItems.length === 0) return;

    e.preventDefault();
    const newPending: PendingFile[] = imageItems
      .map((item) => {
        const file = item.getAsFile();
        if (!file) return null;
        return {
          file,
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          preview: URL.createObjectURL(file),
        };
      })
      .filter(Boolean) as PendingFile[];

    if (newPending.length > 0) {
      setPendingFiles((prev) => [...prev, ...newPending]);
      toast.success(`${newPending.length} image${newPending.length > 1 ? "s" : ""} pasted`);
    }
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current++;
    if (e.dataTransfer.types.includes("Files")) setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current === 0) setIsDragging(false);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current = 0;
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;
    const newPending: PendingFile[] = files.map((file) => ({
      file,
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      preview: file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined,
    }));
    setPendingFiles((prev) => [...prev, ...newPending]);
    toast.success(`${files.length} file${files.length > 1 ? "s" : ""} added`);
  };

  const exportChat = () => {
    if (messages.length === 0) return;
    const conv = conversations.find((c) => c.id === activeConvId);
    const lines = messages.map(
      (m) => `[${m.timestamp.toISOString()}] ${m.role.toUpperCase()}: ${m.content}`
    );
    const blob = new Blob([lines.join("\n\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `jackie-chat_${conv?.title || "export"}_${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Chat exported.");
  };

  return (
    <div className="flex h-[100dvh] bg-background overflow-hidden relative">
      {/* Epic neutron-star ambient backdrop — sits behind everything, low opacity for readability */}
      {!focusMode && <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden opacity-30">
        <AnimatedCanvas theme={bgSettings.theme} opacity={bgSettings.opacity} glow={bgSettings.glow} />
        <div className="absolute inset-0 bg-gradient-to-b from-background/40 via-background/20 to-background/60" />
      </div>}
      {!focusMode && <NeutronBackgroundSettings value={bgSettings} onChange={setBgSettings} />}
      <div className="relative z-10 flex h-full w-full overflow-hidden">
      <Sidebar
        conversations={conversations}
        activeId={activeConvId}
        onSelect={selectConversation}
        onNew={startNewConversation}
        onDelete={handleDeleteConversation}
        onSignOut={signOut}
        userEmail={user?.email ?? ""}
        coreFiles={CORE_FILES}
        isMobileOpen={sidebarOpen}
        onCloseMobile={() => setSidebarOpen(false)}
        theme={theme}
        onToggleTheme={toggleTheme}
        tags={tags}
        tagMap={tagMap}
        activeTagFilter={activeTagFilter}
        onSetTagFilter={setActiveTagFilter}
        onCreateTag={handleCreateTag}
        onDeleteTag={handleDeleteTag}
        onToggleTag={handleToggleTag}
        onExportArchive={handleExportArchive}
        onImportArchive={handleImportArchive}
      />

      <main
        className="flex-1 flex flex-col h-full overflow-hidden relative"
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        {isDragging && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/80 border-2 border-dashed border-primary rounded-sm pointer-events-none">
            <div className="flex flex-col items-center gap-2">
              <Download size={32} className="text-primary" />
              <span className="font-mono text-xs uppercase tracking-widest text-primary">
                Drop files here
              </span>
            </div>
          </div>
        )}
        {/* Mobile header */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-background/95 md:hidden flex-shrink-0 pt-[max(.5rem,env(safe-area-inset-top))]">
          <button
            onClick={() => setSidebarOpen(true)}
            className="min-h-11 min-w-11 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          >
            <Menu size={18} />
          </button>
          <span className="font-mono text-sm font-bold text-primary tracking-wider">J</span>
          <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Jackie</span>
          
          <div className="flex-1" />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={startNewConversation}
            className="h-9 rounded-sm border-primary/60 px-3 font-mono text-xs text-primary hover:bg-primary/10 hover:text-primary"
            disabled={isProcessing}
            aria-label="Start a new chat"
          >
            <Plus size={16} />
            New chat
          </Button>
          {messages.length > 0 && (
            <button
              onClick={exportChat}
              className="min-h-11 min-w-11 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
              title="Export chat"
            >
              <Download size={16} />
            </button>
          )}
          <button
            onClick={toggleTheme}
            className="min-h-11 min-w-11 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
            title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
          >
            {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </div>

        {isProcessing && (
          <div className="h-[2px] bg-secondary overflow-hidden flex-shrink-0">
            <div className="h-full bg-primary" style={{ animation: "progressSlide 1.5s ease-in-out infinite" }} />
          </div>
        )}

        <div className="max-h-[42dvh] flex-shrink-0 overflow-y-auto overscroll-contain px-3 pt-3 md:px-5">
          <div className="mx-auto max-w-3xl">
            <ChatWorkbench key={`${user?.id}:${selectedEngine}`} device={selectedEngine === "device"}
              model={selectedModel} mode={harnessMode} onMode={setHarnessMode}
              reviewWrites={reviewWrites} onReviewWrites={setReviewWrites}
              focus={focusMode} onFocus={() => setFocusMode((value) => !value)}
              running={isProcessing} status={engineStatus} outcome={runOutcome} events={runEvents}
              issue={profileIssue} error={runError} approval={pendingApproval} onDecision={decideAction}
              onIssue={(issue) => { setProfileIssue(issue); if (!issue) { setRunError(null); setRunOutcome("idle"); } }}
              onRestore={runError && lastPromptRef.current ? () => { setInput(lastPromptRef.current); textareaRef.current?.focus(); } : null} />
          </div>
        </div>
        <ScrollNav targetRef={feedRef} />
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain" ref={feedRef}>
          <div className="mx-auto max-w-3xl p-4 space-y-5 md:p-6">
            {messages.length === 0 && (
              <div className="flex flex-col items-start justify-center min-h-[25dvh] space-y-4">
                <span className="font-mono text-4xl font-bold text-primary">J</span>
                <div className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
                  Your session. Your tools. Your control.
                </div>
                <p className="text-muted-foreground text-sm max-w-md">
                  Ask a question in Chat, or choose Agent harness to inspect your tasks and memories with a visible action trail. On-device chat needs both downloaded weights and an accessible owner profile.
                </p>
              </div>
            )}
            {messages.map((msg) =>
              msg.role === "assistant" ? (
                <JackieMessage key={msg.id} message={msg} />
              ) : (
                <UserMessage key={msg.id} message={msg} />
              )
            )}
          </div>
        </div>

        {/* Command input */}
        <div className="border-t border-border bg-background/95 p-3 pb-[max(.75rem,env(safe-area-inset-bottom))] flex-shrink-0 md:p-5">
          <div className="mx-auto max-w-3xl">
            {routeNote && (
              <div className="mb-2 font-mono text-[10px] text-yellow-500" role="status">
                ⇄ {routeNote}
              </div>
            )}
            {engineDef?.kind === "device" && <DeviceModelPanel modelId={selectedModel} />}
            {engineStatus && isProcessing && (
              <div className="mb-2 font-mono text-[10px] text-muted-foreground" role="status">
                … {engineStatus}
              </div>
            )}
            <div className="mb-2 flex min-h-11 flex-wrap items-center gap-1 border-b border-border pb-2">
              <button
                onClick={saveCurrentAsPreset}
                className={`p-2 rounded-sm transition-colors ${
                  isPinnedDefault ? "text-primary min-h-11 min-w-11" : "text-muted-foreground hover:text-primary min-h-11 min-w-11"
                }`}
                title={isPinnedDefault ? "Default engine + model for new chats" : "Pin as default"}
                aria-label={isPinnedDefault ? "Default engine and model for new chats" : "Pin engine and model as default"}
              >
                <Pin size={14} className={isPinnedDefault ? "fill-primary" : ""} />
              </button>

              {/* Engine picker — which brain answers first. */}
              <div className="relative">
                <button
                  disabled={isProcessing}
                  onClick={() => setEngineMenuOpen((prev) => !prev)}
                  className="flex min-h-11 items-center gap-1 rounded-sm px-2 font-mono text-xs text-foreground hover:bg-secondary transition-colors"
                  aria-label="Choose engine"
                  aria-expanded={engineMenuOpen}
                >
                  <Cpu size={12} className={engineDef?.local ? "text-primary" : "text-muted-foreground"} />
                  {engineDef?.short ?? "Engine"}
                  <ChevronDown size={12} />
                </button>
                {engineMenuOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setEngineMenuOpen(false)} />
                    <div className="absolute bottom-full left-0 mb-2 z-50 bg-popover border border-border rounded-md shadow-lg py-1 min-w-[300px] max-w-[calc(100vw-2rem)]">
                      {ENGINES.map((e, i) => (
                        <button
                          key={e.id}
                          onClick={() => { changeEngine(e.id); setEngineMenuOpen(false); }}
                          className={`w-full text-left px-3 py-2 font-mono text-xs hover:bg-secondary transition-colors flex items-start gap-3 ${
                            selectedEngine === e.id ? "text-primary bg-secondary/50" : "text-popover-foreground"
                          }`}
                        >
                          <span className="mt-[2px] text-[10px] text-muted-foreground w-3 flex-shrink-0">
                            {e.kind === "device" ? "·" : i + 1}
                          </span>
                          <span className="flex-1 min-w-0">
                            <span className="flex items-center gap-2">
                              <span className="font-semibold">{e.label}</span>
                              {selectedEngine === e.id && <span className="text-[9px] text-primary">●</span>}
                            </span>
                            <span className="block text-[10px] text-muted-foreground">{e.description}</span>
                            <span className="block text-[10px] text-muted-foreground/70">
                              {e.kind === "device" ? "in this browser · not in the fallback chain" : e.local ? "on your hardware" : "leaves your hardware"}
                              {e.requiresSecret ? ` · needs ${e.requiresSecret}` : ""}
                            </span>
                          </span>
                        </button>
                      ))}
                      <div className="px-3 py-2 border-t border-border font-mono text-[10px] text-muted-foreground">
                        Numbered order is the fallback chain. If your pick cannot answer, the next one does.
                      </div>
                    </div>
                  </>
                )}
              </div>
              {/* Model picker. Jacky routes to its own model, so it has none. */}
              {engineModels.length > 0 ? (
                <div className="relative">
                  <button
                    disabled={isProcessing}
                    onClick={() => setModelMenuOpen((prev) => !prev)}
                    className="flex min-h-11 items-center gap-1 rounded-sm px-2 font-mono text-xs text-foreground hover:bg-secondary transition-colors"
                    aria-label="Choose AI model"
                    aria-expanded={modelMenuOpen}
                  >
                    {engineModels.find((m) => m.id === selectedModel)?.label ?? "Model"}
                    <ChevronDown size={12} />
                  </button>
                  {modelMenuOpen && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setModelMenuOpen(false)} />
                      <div className="absolute bottom-full right-0 md:left-0 md:right-auto mb-2 z-50 bg-popover border border-border rounded-md shadow-lg py-1 min-w-[260px] max-w-[calc(100vw-2rem)]">
                        {engineModels.map((m) => (
                          <button
                            key={m.id}
                            onClick={() => { changeModel(m.id); setModelMenuOpen(false); }}
                            className={`w-full text-left px-3 py-2 font-mono text-xs hover:bg-secondary transition-colors flex items-center gap-3 ${
                              selectedModel === m.id ? "text-primary bg-secondary/50" : "text-popover-foreground"
                            }`}
                          >
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-semibold">{m.label}</span>
                                {selectedModel === m.id && <span className="text-[9px] text-primary">●</span>}
                              </div>
                              {m.note && <span className="text-[10px] text-muted-foreground">{m.note}</span>}
                            </div>
                          </button>
                        ))}
                        <a
                          href="/providers"
                          className="block px-3 py-2 border-t border-border font-mono text-[10px] text-muted-foreground hover:text-primary hover:bg-secondary transition-colors"
                        >
                          → More providers (Groq, OpenRouter, Mistral…)
                        </a>
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <span className="h-9 flex items-center px-2 font-mono text-xs text-muted-foreground" title="Jacky picks its own route and model">
                  auto model
                </span>
              )}
              {messages.length > 0 && (
                <button
                  onClick={exportChat}
                  className="ml-auto p-2 rounded-sm text-muted-foreground hover:text-primary transition-colors"
                  title="Export chat"
                  aria-label="Export chat"
                >
                  <Download size={14} />
                </button>
              )}
            </div>
            <ChatMediaBar
              pendingFiles={pendingFiles}
              onFilesAdded={(files) => setPendingFiles((prev) => [...prev, ...files])}
              onFileRemoved={(id) => setPendingFiles((prev) => prev.filter((f) => f.id !== id))}
              disabled={isProcessing}
            />
            <div className="flex items-end gap-2">
              <span className="font-mono text-xs text-muted-foreground select-none pb-3">›</span>
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                placeholder={harnessMode === "harness" ? "Give the harness a task…" : "Message Jackie…"}
                aria-label="Message Jackie"
                className="jackie-input flex-1 resize-none overflow-hidden rounded-xl text-base leading-relaxed"
                style={{ minHeight: "44px", maxHeight: "200px" }}
                disabled={isProcessing}
                rows={1}
              />
              <VoiceRecorder
                onRecordingComplete={(file) => {
                  const pf: PendingFile = {
                    file,
                    id: `${Date.now()}-voice`,
                    preview: URL.createObjectURL(file),
                  };
                  setPendingFiles((prev) => [...prev, pf]);
                }}
                disabled={isProcessing}
              />
              {rateLimitCooldown > 0 ? (
                <div className="p-3 rounded-sm bg-destructive/20 border border-destructive/40 text-destructive font-mono text-xs flex items-center gap-2 flex-shrink-0 animate-pulse">
                  <Zap size={14} />
                  {rateLimitCooldown}s
                </div>
              ) : isProcessing ? (
                <button
                  onClick={handleStop}
                  className="p-3 rounded-sm bg-destructive/20 border border-destructive/40 text-destructive hover:bg-destructive/30 transition-colors btn-mechanical flex-shrink-0"
                  title="Stop generating"
                  aria-label="Stop generating"
                >
                  <Square size={16} />
                </button>
              ) : (
                <button
                  onClick={handleSubmit}
                  disabled={!input.trim() && pendingFiles.length === 0}
                  className="p-3 rounded-sm bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-30 transition-opacity btn-mechanical flex-shrink-0"
                  title="Send (Enter)"
                  aria-label="Send message"
                >
                  <Send size={16} />
                </button>
              )}
            </div>
          </div>
        </div>

      </main>

      <style>{`
        @keyframes progressSlide {
          0% { width: 0%; margin-left: 0%; }
          50% { width: 60%; margin-left: 20%; }
          100% { width: 0%; margin-left: 100%; }
        }
        .prose pre { background: hsl(var(--secondary)); border: 1px solid hsl(var(--border)); border-radius: 2px; }
        .prose code { font-family: var(--font-mono); font-size: 13px; }
        .prose p code { background: hsl(var(--secondary)); padding: 2px 6px; border-radius: 2px; }
        .prose a { color: hsl(var(--primary)); }
        .prose strong { color: hsl(var(--foreground)); }
        .prose h1, .prose h2, .prose h3 { font-family: var(--font-mono); text-transform: uppercase; letter-spacing: 0.05em; color: hsl(var(--foreground)); }
        .prose ul, .prose ol { color: hsl(var(--foreground) / 0.8); }
      `}</style>
      </div>
    </div>
  );
};

export default Index;
