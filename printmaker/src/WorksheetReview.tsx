import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist/types/src/display/api';
import type { Question, SourcePage, Worksheet } from './model';
import { makePdfWithRegions, type PreviewRegion } from './export';
import { Cropper } from './Cropper';
import { applySourceCrop, findSourcePage } from './source-review';
import './worksheet-review.css';

function PdfPage({ pdf, pageNumber, regions, selectedId, figureId, onSelect }: {
  pdf: PDFDocumentProxy; pageNumber: number; regions: PreviewRegion[];
  selectedId: string; figureId: string | null;
  onSelect: (questionId: string, figureId: string | null) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    let render: { cancel: () => void } | null = null;
    setError('');
    void pdf.getPage(pageNumber + 1).then(async page => {
      if (cancelled || !canvas.current) return;
      const viewport = page.getViewport({ scale: 1.7 });
      const element = canvas.current;
      element.width = Math.ceil(viewport.width); element.height = Math.ceil(viewport.height);
      const task = page.render({ canvas: element, viewport }); render = task;
      await task.promise;
    }).catch(caught => { if (!cancelled) setError(caught instanceof Error ? caught.message : '미리보기를 표시하지 못했어요.'); });
    return () => { cancelled = true; render?.cancel(); };
  }, [pdf, pageNumber]);
  return <div className="review-pdf-page">
    <canvas ref={canvas} aria-label={`최종 학습지 ${pageNumber + 1}페이지`} />
    {regions.filter(region => region.page === pageNumber).map((region,index) => <button
      key={`${region.questionId}-${region.figureId ?? 'question'}-${index}`}
      type="button" className={`review-hitbox ${region.figureId ? 'figure-hitbox' : 'question-hitbox'}`}
      style={{ top:`${region.box[0]/10}%`,left:`${region.box[1]/10}%`,width:`${(region.box[3]-region.box[1])/10}%`,height:`${(region.box[2]-region.box[0])/10}%` }}
      aria-label={`문제 ${region.questionNumber}${region.figureId ? ' 그림 편집' : ' 원본 확인'}${region.answer ? ' · 답지' : ''}`}
      aria-pressed={selectedId === region.questionId && (region.figureId ? figureId === region.figureId : figureId === null)}
      onClick={() => onSelect(region.questionId, region.figureId ?? null)}>
      <span>{region.figureId ? '그림 편집' : `문제 ${region.questionNumber} 원본`}</span>
    </button>)}
    {error && <p className="error" role="alert">{error}</p>}
  </div>;
}

export function WorksheetReview({ doc, sources, initialQuestionId, initialFigureId = null, initialPane = 'preview', busy, loadError, onChange, onSelectQuestion, onLoadSource, onClose }: {
  doc: Worksheet; sources: SourcePage[]; initialQuestionId: string; initialFigureId?: string | null;
  initialPane?: 'preview' | 'source';
  busy: boolean; loadError?: string; onChange: (doc: Worksheet) => void;
  onSelectQuestion: (id: string) => void; onLoadSource: (file: File) => void; onClose: () => void;
}) {
  const dialog = useRef<HTMLElement>(null);
  const sourceFile = useRef<HTMLInputElement>(null);
  const [questionId, setQuestionId] = useState(initialQuestionId || doc.questions[0]?.id || '');
  const [figureId, setFigureId] = useState<string | null>(initialFigureId);
  const [pane, setPane] = useState<'preview' | 'source'>(initialFigureId ? 'source' : initialPane);
  const [sourceId, setSourceId] = useState('');
  const [pdfPage, setPdfPage] = useState(0);
  const [rendering, setRendering] = useState(true);
  const [built, setBuilt] = useState<{ pdf: PDFDocumentProxy; regions: PreviewRegion[]; url: string } | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [editError, setEditError] = useState('');
  const question = doc.questions.find(item => item.id === questionId);
  const figure = question?.figures.find(item => item.id === figureId);
  const matched = question ? findSourcePage(question, sources, figure) : undefined;
  const page = sources.find(item => item.id === sourceId) ?? matched;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.current?.querySelector<HTMLButtonElement>('.review-close')?.focus();
    return () => { document.body.style.overflow = overflow; previous?.focus(); };
  }, []);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
      if (event.key !== 'Tab') return;
      const elements = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary') ?? [])].filter(item => item.getClientRects().length);
      const first = elements[0], last = elements.at(-1);
      if (!dialog.current?.contains(document.activeElement)) { event.preventDefault(); (event.shiftKey ? last : first)?.focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [onClose]);

  useEffect(() => { setSourceId(''); }, [questionId, figureId]);

  useEffect(() => {
    let cancelled = false;
    let owned: PDFDocumentProxy | null = null;
    let url = '';
    setRendering(true); setError('');
    void makePdfWithRegions(doc,'combined').then(async result => {
      if (cancelled) return;
      const pdfjs = await import('pdfjs-dist');
      pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
      const pdf = await pdfjs.getDocument({ data: await result.blob.arrayBuffer() }).promise;
      if (cancelled) { await pdf.destroy(); return; }
      owned = pdf; url = URL.createObjectURL(result.blob);
      setBuilt({pdf,regions:result.regions,url});
      setPdfPage(old => Math.min(old,pdf.numPages-1)); setRendering(false);
    }).catch(caught => { if (!cancelled) { setError(caught instanceof Error ? caught.message : '최종 미리보기를 만들지 못했어요.'); setRendering(false); } });
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); if (owned) void owned.destroy(); };
  }, [doc]);

  const select = (id: string, targetFigure: string | null) => {
      setQuestionId(id); setFigureId(targetFigure); setMessage(''); setEditError(''); setPane('source'); onSelectQuestion(id);
  };
  const initialBox = page === matched ? figure?.sourceBox ?? question?.sourceBox : undefined;

  return <section ref={dialog} className="worksheet-review" role="dialog" aria-modal="true" aria-labelledby="worksheet-review-title"
    >
    <header className="review-header"><div><span className="eyebrow">FINAL CHECK</span><h2 id="worksheet-review-title">최종본 확인 · 그림 수정</h2></div><button type="button" className="review-close" onClick={onClose}>편집으로 돌아가기 ×</button></header>
    <p className="review-intro">문제를 누르면 원본 위치가 열려요. 그림을 누르면 원본에서 다시 잘라 교체할 수 있어요.</p>
    <div className="review-mobile-tabs" aria-label="미리보기와 원본 전환"><button type="button" aria-pressed={pane === 'preview'} onClick={() => setPane('preview')}>최종 미리보기</button><button type="button" aria-pressed={pane === 'source'} onClick={() => setPane('source')}>원본 · 그림 편집</button></div>
    <div className="review-columns" data-pane={pane}>
      <section className="review-output" aria-label="클릭해서 수정하는 최종 학습지">
        <div className="review-output-toolbar"><button type="button" aria-label="미리보기 이전 페이지" disabled={rendering || pdfPage === 0} onClick={() => setPdfPage(value => value-1)}>←</button>
          <label>최종본 페이지<select disabled={!built || rendering} value={pdfPage} onChange={event => setPdfPage(Number(event.target.value))}>{Array.from({length:built?.pdf.numPages ?? 1},(_,i) => <option key={i} value={i}>{i+1} / {built?.pdf.numPages ?? '…'}</option>)}</select></label>
          <button type="button" aria-label="미리보기 다음 페이지" disabled={rendering || !built || pdfPage >= built.pdf.numPages-1} onClick={() => setPdfPage(value => value+1)}>→</button>
          {built && !rendering && <a href={built.url} target="_blank" rel="noreferrer">PDF로 열기 ↗</a>}
        </div>
        {rendering ? <div className="review-loading" role="status">수정한 내용으로 최종본을 만드는 중…</div> : error ? <p className="error" role="alert">{error}</p> : built && <PdfPage pdf={built.pdf} pageNumber={pdfPage} regions={built.regions} selectedId={questionId} figureId={figureId} onSelect={select}/>}
      </section>
      <section className="review-source" aria-label="문제 원본과 그림 편집">
        <label className="review-question-picker">편집할 문제<select value={questionId} onChange={event => {
          const id = event.target.value; select(id,null);
          const region = built?.regions.find(item => item.questionId === id && !item.answer);
          if (region) setPdfPage(region.page);
        }}>{doc.questions.map((item,i) => <option key={item.id} value={item.id}>문제 {i+1}{item.label ? ` · 원본 ${item.label}번` : ''}</option>)}</select></label>
        {question && <>
          <div className="review-figure-list" aria-label="교체할 그림 선택"><button type="button" aria-pressed={figureId === null} onClick={() => setFigureId(null)}>＋ 빠진 그림 추가</button>{question.figures.map((item,i) => <button type="button" key={item.id} aria-pressed={figureId === item.id} onClick={() => setFigureId(item.id)}><img src={item.dataUrl} alt=""/>그림 {i+1} 교체</button>)}</div>
          <div className="review-edit-target"><b>{figure ? `그림 ${question.figures.indexOf(figure)+1} 교체 중` : '빠진 그림 추가'}</b><p>{figure ? '선택한 그림만 교체해요. 문제 글과 다른 그림은 유지합니다.' : '원본에서 그림·표·수식을 선택해 이 문제에 추가하세요.'}</p></div>
          {sources.length > 0 && <label className="review-source-picker">원본 파일·페이지<select value={page?.id ?? ''} onChange={event => setSourceId(event.target.value)}><option value="">원본 페이지 선택</option>{sources.map((item,i) => <option key={item.id ?? i} value={item.id}>{item.name} · {item.number}페이지</option>)}</select></label>}
          {!matched && <p className="review-source-missing" role="status">이 문제의 원본을 찾지 못했어요. 같은 원본 파일을 다시 올리거나 위에서 페이지를 직접 선택해 주세요. 원본 전체는 브라우저를 닫으면 보관되지 않습니다.</p>}
          {page && <div className="review-source-caption">{page.name} · {page.number}페이지{initialBox ? ' · 원래 영역 표시' : ''}</div>}
          {page?.image ? <Cropper key={`${question.id}-${figureId ?? 'new'}-${page.id}`} page={page} disabled={busy || rendering} initialBox={initialBox} buttonLabel={figure ? '선택 영역으로 이 그림 교체' : '선택 영역을 새 그림으로 추가'} onCrop={(dataUrl,box) => {
            try {
              setEditError('');
              onChange(applySourceCrop(doc,question.id,figureId,page,dataUrl,box));
              setMessage(figure ? '그림을 교체했어요. 최종 미리보기에 반영했습니다.' : '그림을 추가했어요. 최종 미리보기에 반영했습니다.');
              setPane('preview');
            } catch(caught) { setMessage(''); setEditError(caught instanceof Error ? caught.message : '그림을 수정하지 못했어요.'); }
          }}/> : page && <p className="hint">이 원본에는 사진이 없습니다. PDF나 이미지 원본을 올려 주세요.</p>}
          <button type="button" className="review-load-source" disabled={busy} onClick={() => sourceFile.current?.click()}>원본 파일 다시 불러오기</button>
          <input ref={sourceFile} type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.md" hidden onChange={event => { const file = event.target.files?.[0]; if (file) onLoadSource(file); event.target.value=''; }}/>
        </>}
        {busy && <p role="status">원본을 읽고 있어요…</p>}
        {loadError && <p className="error" role="alert">{loadError}</p>}
        {editError && <p className="error" role="alert">{editError}</p>}
      </section>
    </div>
    {message && <div className="review-result" role="status">{message}<button type="button" onClick={() => setPane('source')}>원본 다시 보기</button></div>}
  </section>;
}
