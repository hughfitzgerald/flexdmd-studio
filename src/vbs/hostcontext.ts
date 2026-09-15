import type { Span } from './ast';

// Information about the script call currently being dispatched to a host object.
// Host objects (FlexDMD actors) read this to remember which script literal produced a given value,
// so the WYSIWYG editor can write a dragged position back into the script text.
export interface HostCallContext {
  // For each argument: the span of the numeric literal that produced it, or null when the value was computed.
  argSpans: (Span | null)[];
  statementSpan: Span | null;
  // Name of the user procedure that was executing (null at top level)
  procName: string | null;
}

export const hostCallContext: HostCallContext = { argSpans: [], statementSpan: null, procName: null };
