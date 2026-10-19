import type { Figure, Question, SourcePage, SourceBox, Worksheet } from './model.ts';
import { isSafeImage, isSourceBox, parseWorksheet } from './model.ts';

export function findSourcePage(question: Question, pages: SourcePage[], figure?: Figure) {
  const id = figure?.sourceId ?? question.sourceId;
  if (id) return pages.find(page => page.id === id);
  const name = figure?.sourceName ?? question.sourceName;
  const number = figure?.sourcePage ?? question.sourcePage;
  const matches = pages.filter(page => page.name === name && page.number === number);
  return matches.length === 1 ? matches[0] : undefined;
}

export function mergeSourcePages(existing: SourcePage[], incoming: SourcePage[]) {
  const next = existing.filter(page => !incoming.some(item => item.id && item.id === page.id)).concat(incoming);
  if (next.length > 60) throw new Error('원본은 한 편집 세션에서 최대 60페이지까지 보관합니다. 새 학습지로 나눠 주세요.');
  return next;
}

export function applySourceCrop(doc: Worksheet, questionId: string, figureId: string | null, page: SourcePage, dataUrl: string, box: SourceBox): Worksheet {
  if (!isSafeImage(dataUrl) || !isSourceBox(box)) throw new Error('그림이 너무 크거나 영역이 올바르지 않아요. 영역을 작게 선택해 주세요.');
  const question = doc.questions.find(item => item.id === questionId);
  if (!question) throw new Error('편집할 문제가 더 이상 없습니다.');
  if (figureId && !question.figures.some(item => item.id === figureId)) throw new Error('교체할 그림이 더 이상 없습니다.');
  if (!figureId && question.figures.length >= 8) throw new Error('문제당 그림은 8개까지입니다. 기존 그림을 선택해 교체해 주세요.');
  const patch = { dataUrl, sourceId: page.id, sourceName: page.name, sourcePage: page.number, sourceBox: box };
  const figures = figureId
    ? question.figures.map(figure => figure.id === figureId ? { ...figure, ...patch } : figure)
    : [...question.figures, { id: crypto.randomUUID(), caption: '', ...patch }];
  return parseWorksheet({ ...doc, questions: doc.questions.map(item => item.id === questionId ? { ...item, figures, reviewed: false } : item) });
}
