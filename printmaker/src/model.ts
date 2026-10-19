export type SourceBox = [number, number, number, number];
export type Provenance = { sourceId?: string; sourceBox?: SourceBox };
export type Figure = Provenance & { id: string; dataUrl: string; caption: string; sourceName?: string; sourcePage?: number };
export type Question = {
  id: string; label: string; text: string; answer: string; explanation: string;
  origin: "original" | "variant" | "moonwords" | "manual";
  answerSource: "none" | "source" | "ai" | "manual";
  reviewed: boolean; sourceName: string; sourcePage: number; figures: Figure[];
  sourceId?: string; sourceBox?: SourceBox;
};
export type Worksheet = { version: 1; title: string; fontSize: number; questions: Question[] };
export type SourcePage = { id?: string; number: number; name: string; text: string; image: string };
export const isSourceBox = (box: unknown): box is SourceBox => Array.isArray(box) && box.length === 4 && box.every(value => Number.isFinite(value) && value >= 0 && value <= 1000) && box[2] > box[0] && box[3] > box[1];
const validProvenance = (value: Provenance) => (value.sourceId === undefined || (typeof value.sourceId === 'string' && value.sourceId.length <= 200)) && (value.sourceBox === undefined || isSourceBox(value.sourceBox));
export type Message = { role: "user" | "assistant"; text: string };
export const newQuestion = (patch: Partial<Question> = {}): Question => ({
  id: crypto.randomUUID(), label: "", text: "", answer: "", explanation: "", origin: "manual",
  answerSource: "none", reviewed: false, sourceName: "", sourcePage: 0, figures: [], ...patch,
});
export const emptyWorksheet = (): Worksheet => ({ version: 1, title: "", fontSize: 11, questions: [] });
export const isSafeImage = (value: unknown): value is string =>
  typeof value === "string" && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value) && value.length <= 4_000_000;
export function parseWorksheet(value: unknown): Worksheet {
  if (!value || typeof value !== "object") throw new Error("Printmaker 파일이 아닙니다.");
  const doc = value as Worksheet;
  if (doc.version !== 1 || typeof doc.title !== "string" || doc.title.length > 100 || !Array.isArray(doc.questions) || doc.questions.length > 100) throw new Error("지원하지 않는 학습지 형식입니다 (최대 100문제).");
  const ids = new Set<string>();
  for (const q of doc.questions) {
    if (!q || typeof q.id !== "string" || ids.has(q.id) || ![q.label,q.text,q.answer,q.explanation,q.sourceName].every(v => typeof v === "string" && v.length <= 30000)
      || !["original","variant","moonwords","manual"].includes(q.origin) || !["none","source","ai","manual"].includes(q.answerSource)
      || typeof q.reviewed !== "boolean" || !Number.isInteger(q.sourcePage) || !validProvenance(q) || !Array.isArray(q.figures) || q.figures.length > 8
      || q.figures.some(f => !f || typeof f.id !== "string" || typeof f.caption !== "string" || f.caption.length > 300 || !isSafeImage(f.dataUrl) || !validProvenance(f)
        || (f.sourceName !== undefined && (typeof f.sourceName !== 'string' || f.sourceName.length > 30000))
        || (f.sourcePage !== undefined && (!Number.isInteger(f.sourcePage) || f.sourcePage < 1)))) throw new Error("학습지 데이터가 손상됐거나 너무 큽니다.");
    ids.add(q.id);
  }
  if (!Number.isFinite(doc.fontSize) || doc.fontSize < 9 || doc.fontSize > 15) throw new Error("글자 크기는 9~15pt입니다.");
  if (JSON.stringify(doc).length > 8_000_000) throw new Error("학습지가 8MB를 넘습니다. 그림 수를 줄이거나 학습지를 나눠 주세요.");
  return doc;
}
export function moonwordsQuestions(doc: { id: string; title: string; original_text: string; analysis?: { questions?: { question: string; options: string[]; answer: number; explanation: string }[] } }): Question[] {
  const source = doc.analysis?.questions ?? [];
  if (!source.length) return [newQuestion({text: doc.original_text, origin: "moonwords", sourceName: doc.title})];
  return source.map((q, i) => newQuestion({
    label: String(i + 1), origin: "moonwords", sourceName: doc.title,
    text: `${doc.original_text}\n\n${q.question}\n${q.options.map((o,j) => `${j+1}. ${o}`).join("\n")}`,
    answer: q.answer >= 0 && q.answer < q.options.length ? `${q.answer+1}. ${q.options[q.answer]}` : "",
    explanation: q.explanation, answerSource: "ai",
  }));
}
