"use client";

import { useState, useTransition } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { rewriteWithAssist } from "@/app/staff/ai-assist/actions";
import { ASSIST_PRESETS, type AssistChannel } from "@/lib/ai-assist-shared";

type Props = {
  channel: AssistChannel;
  /** Current draft text — the rewrite source. Read at click time via the parent's state. */
  getText: () => string;
  /** Receives the rewritten (or drafted) text; parent sets its field state. */
  onText: (text: string) => void;
  /**
   * Optional surface-specific "write it for me" entry (e.g. draft from the
   * vehicle/reminder context). The parent owns that call and its pending UI.
   */
  onDraft?: () => void;
  draftLabel?: string;
  disabled?: boolean;
  className?: string;
};

/**
 * Slack-style opt-in AI help for a compose field: the staff member writes
 * their own message; this menu rewrites it (tone, length, grammar) or — when
 * the surface provides one — drafts from context. Never fires automatically.
 */
export function AiAssistMenu({ channel, getText, onText, onDraft, draftLabel = "Write it for me", disabled, className }: Props) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [customOpen, setCustomOpen] = useState(false);
  const [custom, setCustom] = useState("");

  const empty = !getText().trim();

  function run(instruction: string) {
    const text = getText();
    if (!text.trim()) return;
    setError(null);
    startTransition(async () => {
      const result = await rewriteWithAssist({ text, instruction, channel });
      if ("error" in result) {
        setError(result.error);
      } else {
        onText(result.text);
        setCustomOpen(false);
        setCustom("");
      }
    });
  }

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="AI assist"
            disabled={disabled || pending}
            className={cn(buttonVariants({ variant: "ghost", size: "xs" }), "text-ws-text-2")}
          >
            <Sparkles className="size-3" />
            {pending ? "Working…" : "AI assist"}
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            {onDraft && (
              <>
                <DropdownMenuItem onClick={() => { setError(null); onDraft(); }}>
                  {draftLabel}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            {ASSIST_PRESETS.map((preset) => (
              <DropdownMenuItem
                key={preset.label}
                disabled={empty}
                onClick={() => run(preset.instruction)}
              >
                {preset.label}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={empty} onClick={() => setCustomOpen(true)}>
              Custom instruction…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {error && <span className="text-xs text-ws-red">{error}</span>}
      </div>

      {customOpen && (
        <div className="flex items-center gap-2">
          <input
            type="text"
            className="h-7 flex-1 rounded-md border border-black/20 dark:border-white/25 bg-transparent px-2 text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
            placeholder="Tell AI what to change, e.g. 'mention we're closed bank holiday Monday'"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && custom.trim() && !pending) run(custom.trim());
            }}
            disabled={pending}
            autoFocus
          />
          <Button
            type="button"
            size="xs"
            variant="outline"
            disabled={!custom.trim()}
            loading={pending}
            onClick={() => run(custom.trim())}
          >
            Apply
          </Button>
          <Button
            type="button"
            size="xs"
            variant="ghost"
            disabled={pending}
            onClick={() => { setCustomOpen(false); setCustom(""); setError(null); }}
          >
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}
