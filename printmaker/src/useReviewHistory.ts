import { useEffect, useRef, useState } from 'react';
export type ReviewTarget = { questionId: string; figureId: string | null; source: boolean };
const key = 'printmakerReviewV1';
export function useReviewHistory(questionIds: string[]) {
  const [target,setTarget] = useState<ReviewTarget | null>(null);
  const validIds = useRef(questionIds); validIds.current = questionIds;
  const opened = useRef(false);
  useEffect(() => {
    // A reload starts with no worksheet; an old review entry is not restorable.
    if (window.history.state?.[key]) {
      const state = { ...window.history.state }; delete state[key];
      window.history.replaceState(state,'',location.href);
    }
    const pop = (event: PopStateEvent) => {
      const next = event.state?.[key] as ReviewTarget | undefined;
      if (next && typeof next.questionId === 'string' && validIds.current.includes(next.questionId)
        && (next.figureId === null || typeof next.figureId === 'string') && typeof next.source === 'boolean') {
        opened.current = true; setTarget(next);
      } else { opened.current = false; setTarget(null); }
    };
    window.addEventListener('popstate',pop);
    return () => window.removeEventListener('popstate',pop);
  },[]);
  return {
    target,
    open: (next: ReviewTarget) => {
      if (!opened.current) window.history.pushState({...window.history.state,[key]:next},'',location.href);
      else window.history.replaceState({...window.history.state,[key]:next},'',location.href);
      opened.current = true; setTarget(next);
    },
    close: () => {
      if (window.history.state?.[key]) window.history.back();
      else { opened.current = false; setTarget(null); }
    },
  };
}
