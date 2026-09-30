'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Check } from '@/components/ui/icons';

export function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be blocked (for example in an in-app browser). Fall back to a prompt to copy by hand.
      window.prompt('Copy this link:', text);
    }
  }

  return (
    <Button type="button" variant="secondary" onClick={copy} className="shrink-0">
      {copied ? <Check className="size-4 shrink-0 text-success" /> : null}
      <span aria-live="polite">{copied ? 'Copied!' : label}</span>
    </Button>
  );
}
