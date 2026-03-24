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

  const escapedAnchor = escapeHtml(anchorText);
  const escapedUrl = escapeHtml(targetUrl);
  const html = `<a href="${escapedUrl}">${escapedAnchor}</a>`;

  const handleCopy = () => {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(html);
    } else {
      // Fallback for non-HTTPS contexts [AAP-F3]
      const textarea = document.createElement("textarea");
      textarea.value = html;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
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
        className="rounded bg-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-600"
      >
        Copy HTML
      </button>
    </div>
  );
}
