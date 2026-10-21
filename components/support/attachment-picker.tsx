"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { formatBytes, uploadProblem } from "@/lib/shipping/customs-labels";
import { openSignedLink } from "@/lib/shipping/download";
import type { Attachment } from "@/lib/support/schemas";

export const MAX_FILES = 5;

/** Which of the files just chosen can be added, and a sentence for each one that can't. Pure so it can be tested on its own. */
export function addFiles(current: File[], chosen: File[]): { files: File[]; problems: string[] } {
  const files = [...current];
  const problems: string[] = [];

  for (const file of chosen) {
    const problem = uploadProblem(file);

    if (problem) problems.push(`“${file.name}”: ${problem}`);
    else if (files.some((f) => f.name === file.name && f.size === file.size && f.lastModified === file.lastModified)) continue;
    else if (files.length >= MAX_FILES) problems.push(`“${file.name}” wasn't added: you can attach at most ${MAX_FILES} files at a time.`);
    else files.push(file);
  }

  return { files, problems };
}

/**
 * Choose photos or documents to send. Images get a small preview so people can see what they are sending.
 * The server checks the real content; this only saves a round trip for obvious mistakes.
 */
export function AttachmentPicker({ files, onChange, disabled = false, hint }: { files: File[]; onChange: (files: File[]) => void; disabled?: boolean; hint?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const labelId = useId();
  const [problems, setProblems] = useState<string[]>([]);
  const previews = useMemo(() => files.map((f) => (f.type.startsWith("image/") ? URL.createObjectURL(f) : null)), [files]);

  useEffect(() => () => previews.forEach((url) => url && URL.revokeObjectURL(url)), [previews]);

  function choose(list: FileList | null) {
    if (!list) return;
    const result = addFiles(files, Array.from(list));
    setProblems(result.problems);
    onChange(result.files);
    if (input.current) input.current.value = "";
  }

  return (
    <div className="space-y-2">
      <p id={labelId} className="text-sm font-medium">Photos or documents (optional)</p>
      {hint ? <p className="text-sm opacity-80">{hint}</p> : null}
      <input ref={input} type="file" multiple accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" className="sr-only" tabIndex={-1} aria-labelledby={labelId} data-testid="attachment-input" onChange={(e) => choose(e.target.files)} disabled={disabled} />
      <Button type="button" variant="outline" size="sm" className="min-h-11" onClick={() => input.current?.click()} disabled={disabled || files.length >= MAX_FILES}>Add photos or documents</Button>
      <p className="text-xs opacity-75">PDF, JPEG or PNG, up to 10 MB each, at most {MAX_FILES} at a time.</p>

      {problems.length > 0 ? <ul role="alert" className="list-disc pl-5 text-sm text-red-900">{problems.map((p) => <li key={p}>{p}</li>)}</ul> : null}

      {files.length > 0 ? (
        <ul aria-label="Files to send" className="space-y-2">
          {files.map((file, i) => (
            <li key={`${file.name}-${file.size}-${file.lastModified}`} className="flex items-center gap-3 rounded-md border border-foreground/20 p-2 text-sm">
              {/* a local preview of a file the person just chose (a blob: address), which next/image can't optimise */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {previews[i] ? <img src={previews[i]!} alt="" className="size-12 rounded object-cover" /> : <span aria-hidden className="flex size-12 items-center justify-center rounded bg-foreground/10 text-xs">PDF</span>}
              <span className="min-w-0 flex-1"><span className="block break-all font-medium">{file.name}</span><span className="opacity-75">{formatBytes(file.size)}</span></span>
              <Button type="button" variant="ghost" size="sm" className="min-h-11" disabled={disabled} onClick={() => onChange(files.filter((_, j) => j !== i))} aria-label={`Remove ${file.name}`}>Remove</Button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** Files already sent, each opened through a fresh short-lived link. */
export function AttachmentLinks({ attachments, load }: { attachments: Attachment[]; load: (attachmentId: string) => Promise<{ url: string }> }) {
  const [error, setError] = useState<string | null>(null);

  if (attachments.length === 0) return null;

  return (
    <div className="mt-2">
      <ul aria-label="Attachments" className="flex flex-wrap gap-2">
        {attachments.map((a) => (
          <li key={a.id}>
            <Button type="button" variant="outline" size="sm" className="min-h-11 h-auto whitespace-normal text-left" onClick={async () => setError(await openSignedLink(() => load(a.id)))} aria-label={`Download ${a.name}`}>
              <span aria-hidden>{a.type === "application/pdf" ? "PDF" : "Photo"}</span> <span className="max-w-48 truncate">{a.name}</span> <span className="opacity-70">({formatBytes(a.size)})</span>
            </Button>
          </li>
        ))}
      </ul>
      {error ? <p role="alert" className="mt-1 text-sm text-red-900">{error}</p> : null}
    </div>
  );
}
