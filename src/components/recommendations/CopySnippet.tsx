"use client";

import { useState } from "react";

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

interface CopySnippetProps {
  anchorText: string;
  targetUrl: string;
}

export function CopySnippet({ anchorText: initialAnchor, targetUrl }: CopySnippetProps) {
  const [anchorText, setAnchorText] = useState(initialAnchor);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);

  const escapedAnchor = escapeHtml(anchorText);
  const escapedUrl = escapeHtml(targetUrl);
  const html = `<a href="${escapedUrl}">${escapedAnchor}</a>`;

  const handleCopy = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(html);
      } else {
        // Fallback for non-HTTPS contexts [AAP-F3] — execCommand is deprecated but remains the only sync alternative
        const textarea = document.createElement("textarea");
        textarea.value = html;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        const success = document.execCommand("copy");
        document.body.removeChild(textarea);
        if (!success) throw new Error("execCommand copy returned false");
      }
      setCopied(true);
      setCopyError(false);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("[CopySnippet] copy failed:", err);
      setCopyError(true);
      setTimeout(() => setCopyError(false), 3000);
    }
  };

  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-zinc-400">
        Anchor text
      </label>
      <input
        type="text"
        value={anchorText}
        onChange={(e) => setAnchorText(e.target.value)}
        className="w-full rounded border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-100"
      />
      <div
        data-testid="snippet-preview"
        className="rounded bg-zinc-900 p-3 font-mono text-xs text-zinc-300"
      >
        {html}
      </div>
      <button
        onClick={handleCopy}
        disabled={!anchorText.trim()}
        className="rounded bg-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-600 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {copied ? "Copied!" : copyError ? "Copy failed" : "Copy HTML"}
      </button>
    </div>
  );
}
