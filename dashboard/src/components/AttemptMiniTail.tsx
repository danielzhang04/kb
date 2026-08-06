import { useAttemptIo } from '../lib/useAttemptIo';
import type { UseSseResult } from '../lib/sseClient';

export function AttemptMiniTail({
  runRef,
  attemptRef,
  sse,
  lines: maxLines = 3,
}: {
  runRef: string;
  attemptRef: string;
  sse: UseSseResult;
  lines?: number;
}): React.JSX.Element | null {
  const { lines, live } = useAttemptIo({ runRef, attemptRef, sse, maxLines });
  if (lines.length === 0) return null;
  return (
    <div className="v-mini-tail" data-testid={`mini-tail-${attemptRef}`}>
      {live ? <span className="v-mini-tail__live" aria-label="live" /> : null}
      {lines.slice(-maxLines).map((entry) => (
        <div key={entry.seq} className={`mc-mono v-mini-tail__line${entry.dir === 'meta' ? ' v-mini-tail__meta' : ''}`}>
          {entry.dir === 'in' ? '› ' : ''}{entry.line}
        </div>
      ))}
    </div>
  );
}
