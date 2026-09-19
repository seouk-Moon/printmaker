import { useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { aiRequest, moonwordsUrl, saveCloud, sendToMoonwords, supabase } from "./cloud";
import { emptyWorksheet, moonwordsQuestions, newQuestion, parseWorksheet } from "./model";
import type { Message, Question, SourcePage, Worksheet } from "./model";
import { Cropper } from "./Cropper";
import type { OutputKind } from "./export";

type AnswerCandidate={label:string;answer:string;explanation:string};
const originLabels={original:"원본 추출",variant:"AI 변형",moonwords:"Moonwords",manual:"직접 편집"};
const answerLabels={none:"정답 없음",source:"원본 답지",ai:"AI 초안",manual:"직접 입력"};
const initialChat:Message={role:"assistant",text:"왼쪽에서 문제를 선택해 주세요. 풀이 방법을 비교하거나, 선생님이 강조한 출제 유형을 함께 분석할 수 있어요. 토의 내용은 문제를 자동으로 덮어쓰지 않습니다."};

export default function App() {
  const [doc,setDoc]=useState<Worksheet>(emptyWorksheet);
  const [selectedId,setSelectedId]=useState("");
  const selected=doc.questions.find(q=>q.id===selectedId);
  const [source,setSource]=useState<SourcePage[]>([]);const [pageIndex,setPageIndex]=useState(0);
  const page=source[pageIndex];const [processed,setProcessed]=useState<number[]>([]);
  const [busy,setBusy]=useState("");const [message,setMessage]=useState("");const [error,setError]=useState("");
  const [consent,setConsent]=useState(false);const [sourceRole,setSourceRole]=useState<"extract"|"answers">("extract");
  const [answers,setAnswers]=useState<AnswerCandidate[]>([]);const [answerIndex,setAnswerIndex]=useState(0);
  const [session,setSession]=useState<Session|null>(null);const [email,setEmail]=useState("");const [password,setPassword]=useState("");
  const [panel,setPanel]=useState<"export"|"ai"|"cloud">("export");
  const [instruction,setInstruction]=useState("");const [count,setCount]=useState(2);
  const [chatInput,setChatInput]=useState("");const [chats,setChats]=useState<Record<string,Message[]>>({});
  const [cloudId,setCloudId]=useState<string|undefined>();const [saved,setSaved]=useState<{id:string;title:string}[]>([]);
  const [moonDocs,setMoonDocs]=useState<Parameters<typeof moonwordsQuestions>[0][]>([]);
  const [preview,setPreview]=useState("");const previewRef=useRef("");
  const dirty=useRef(false);const fileRef=useRef<HTMLInputElement>(null);
  const messages=chats[selectedId]||[initialChat];

  useEffect(()=>{if(!supabase)return;let active=true;let userId:string|undefined;const applySession=(s:Session|null)=>{if(!active)return;if(userId!==s?.user.id){setSaved([]);setMoonDocs([]);setCloudId(undefined);userId=s?.user.id;}setSession(s);};void supabase.auth.getSession().then(({data})=>applySession(data.session));const {data}=supabase.auth.onAuthStateChange((_e,s)=>applySession(s));return ()=>{active=false;data.subscription.unsubscribe();};},[]);
  useEffect(()=>{const leave=(event:BeforeUnloadEvent)=>{if(dirty.current){event.preventDefault();event.returnValue="";}};window.addEventListener("beforeunload",leave);return ()=>{window.removeEventListener("beforeunload",leave);if(previewRef.current)URL.revokeObjectURL(previewRef.current);};},[]);
  const update=(next:Worksheet|((old:Worksheet)=>Worksheet))=>{dirty.current=true;setDoc(next);if(previewRef.current){URL.revokeObjectURL(previewRef.current);previewRef.current="";setPreview("");}};
  const patchQuestion=(patch:Partial<Question>)=>update(old=>({...old,questions:old.questions.map(q=>q.id===selectedId?{...q,...patch}:q)}));
  const append=(questions:Question[])=>{
    if(doc.questions.length+questions.length>100)throw new Error("한 학습지는 최대 100문제입니다. 학습지를 나눠 주세요.");
    update(old=>({...old,questions:[...old.questions,...questions]}));if(questions[0])setSelectedId(questions[0].id);
  };
  const run=async(label:string,fn:()=>Promise<void>)=>{if(busy)return;setBusy(label);setError("");setMessage("");try{await fn();}catch(e){setError(e instanceof Error?e.message:"처리 중 오류가 발생했습니다.");}finally{setBusy("");}};
  const requireAi=()=>{if(!consent)throw new Error("AI 전송 동의에 체크해 주세요. 선택한 원본과 문제만 전송합니다.");if(!session)throw new Error("상단에서 Moonwords 계정으로 로그인해 주세요.");};
  const loadFile=(file:File)=>run("파일 읽는 중",async()=>{const {readSource}=await import("./extract");const pages=await readSource(file,setBusy);setSource(pages);setPageIndex(0);setProcessed([]);setMessage(`${pages.length}페이지를 읽었습니다. 텍스트·그림을 직접 넣거나 AI로 문제를 분리하세요.`);});
  const extractPage=()=>run("텍스트·그림 추출 중",async()=>{
    requireAi();if(!page)throw new Error("파일을 먼저 올려 주세요.");
    if(processed.includes(pageIndex))throw new Error("이미 추출한 페이지입니다. 다음 페이지를 선택해 주세요.");
    const data=await aiRequest({action:sourceRole,text:page.text,images:page.image?[page.image]:[]});
    if(!Array.isArray(data.questions))throw new Error("문제 목록을 받지 못했습니다.");
    if(sourceRole==="answers") {setAnswers(old=>[...old,...data.questions]);setAnswerIndex(answers.length);setMessage(`${data.questions.length}개 답안을 추출했습니다. 아래에서 대응 문제를 선택해 적용해 주세요. ${data.message||""}`);}
    else {
      const {cropFigure}=await import("./extract");
      const questions:Question[]=[];
      for(const item of data.questions) {
        const figures=[];
        for(const box of item.boxes||[]) if(page.image)figures.push({id:crypto.randomUUID(),dataUrl:await cropFigure(page.image,box),caption:""});
        questions.push(newQuestion({label:item.label,text:item.text,answer:item.answer,explanation:item.explanation,origin:"original",answerSource:item.answer?"source":"none",sourceName:page.name,sourcePage:page.number,figures}));
      }
      append(questions);setMessage(`${questions.length}문제를 추출했습니다. 원본과 비교해 누락·그림 영역을 확인하세요. ${data.message||""}`);
    }
    setProcessed(old=>[...old,pageIndex]);
  });
  const questionContext=()=>{if(!selected)throw new Error("문제를 먼저 선택해 주세요.");return {text:`문제: ${selected.text}\n현재 답안 (${answerLabels[selected.answerSource]}): ${selected.answer}\n해설: ${selected.explanation}`,images:selected.figures.map(f=>f.dataUrl).slice(0,4)};};
  const generate=(action:"variant"|"solve")=>run(action==="variant"?"변형 문제 생성 중":"정답·해설 초안 작성 중",async()=>{
    requireAi();const data=await aiRequest({action,...questionContext(),instruction,count});
    if(action==="variant") {
      if(data.questions.length!==count)throw new Error("요청한 문제 수와 응답이 다릅니다. 다시 시도해 주세요.");
      append(data.questions.map((q:AnswerCandidate&{text:string})=>newQuestion({text:q.text,answer:q.answer,explanation:q.explanation,origin:"variant",answerSource:"ai",sourceName:`변형 기준: ${selected?.label||doc.questions.findIndex(q=>q.id===selectedId)+1}`})));
    } else {
      const result=data.questions[0];if(!result?.answer)throw new Error(data.message||"정답을 확정할 수 없습니다. 원본 정보와 그림을 확인해 주세요.");
      patchQuestion({answer:result.answer,explanation:result.explanation,answerSource:"ai",reviewed:false});
    }
    setMessage(`${data.message||"생성했습니다."} AI 생성 결과는 배포 전에 반드시 검토해 주세요.`);
  });
  const sendChat=()=>run("문제 토의 중",async()=>{
    requireAi();if(!chatInput.trim())return;
    const input=chatInput.trim();const data=await aiRequest({action:"chat",...questionContext(),instruction:input,history:messages.slice(-8)});
    setChats(old=>({...old,[selectedId]:[...messages,{role:"user",text:input},{role:"assistant",text:data.message}]}));setChatInput("");
  });
  const exportFile=(kind:OutputKind,format:"pdf"|"docx",view=false)=>run("파일 만드는 중",async()=>{
    const {makePdf,makeWord,downloadBlob,safeFilename,outputLabels}=await import("./export");
    const blob=await(format==="pdf"?makePdf(doc,kind):makeWord(doc,kind));
    if(view){if(previewRef.current)URL.revokeObjectURL(previewRef.current);previewRef.current=URL.createObjectURL(blob);setPreview(previewRef.current);}
    else downloadBlob(blob,`${safeFilename(doc.title)}_${outputLabels[kind]}.${format}`);
    setMessage(view?"실제 PDF 출력 미리보기입니다.":"파일을 만들었습니다. 다운로드 목록을 확인해 주세요.");
  });
  const loadSaved=(id:string)=>run("학습지 불러오는 중",async()=>{
    if(dirty.current&&!confirm("현재 편집 내용을 바꿀까요? 저장하지 않은 내용은 사라집니다."))return;
    const {data,error}=await supabase!.from("printmaker_worksheets").select("payload").eq("id",id).single();if(error)throw error;
    const next=parseWorksheet(data.payload);update(next);setCloudId(id);setSelectedId(next.questions[0]?.id||"");setChats({});dirty.current=false;
  });
  return <div className="app">
    <header className="topbar"><a className="brand" href="./index.html"><span className="brand-icon">P</span>printmaker<span className="brand-tag">WORKSHEET STUDIO</span></a><nav><a href={moonwordsUrl}>Moonwords ↗</a><a href="./templates/worksheet-reference.pdf" target="_blank" rel="noreferrer">기본 양식</a></nav><span className="account">{session?session.user.email:"로컬 편집 모드"}</span>{session&&<button disabled={!!busy} onClick={()=>run("로그아웃 중",async()=>{await supabase?.auth.signOut({scope:"local"});})}>로그아웃</button>}</header>
    <main>
      <section className="intro"><div><span className="eyebrow">YOUR QUESTIONS. YOUR FORMAT.</span><h1>문제는 그대로, 학습지는 새롭게.</h1><p>텍스트와 그림을 꺼내고, 나만의 양식으로 완성하세요.</p></div><div className="format-pill"><b>A4</b><span>세로 · 2단 양식<br/>한 페이지 최대 2문제</span></div></section>
      {!session&&<details className="login-box"><summary>Moonwords 계정 연결 <span>AI 기능 · 저장 본문 · 클라우드 학습지</span></summary>{supabase?<form onSubmit={e=>{e.preventDefault();void run("로그인 중",async()=>{const {error}=await supabase!.auth.signInWithPassword({email,password});if(error)throw error;setPassword("");});}}><input type="email" aria-label="이메일" placeholder="Moonwords 이메일" autoComplete="email" required value={email} onChange={e=>setEmail(e.target.value)}/><input type="password" aria-label="비밀번호" placeholder="비밀번호" autoComplete="current-password" required value={password} onChange={e=>setPassword(e.target.value)}/><button className="primary" disabled={!!busy}>로그인</button><a href={moonwordsUrl}>계정 만들기 ↗</a></form>:<p>환경 변수 설정 전에도 직접 편집·그림 자르기·6종 다운로드를 사용할 수 있습니다. AI와 클라우드는 Supabase 설정 후 열립니다.</p>}</details>}
      <section className="title-bar"><label>학습지 상단 제목<input value={doc.title} maxLength={100} disabled={!!busy} placeholder="예: 2학년 2학기 중간고사 대비" onChange={e=>update({...doc,title:e.target.value})}/></label><label className="font-field">본문 크기<select value={doc.fontSize} disabled={!!busy} onChange={e=>update({...doc,fontSize:Number(e.target.value)})}>{[9,10,11,12,13,14,15].map(n=><option key={n} value={n}>{n} pt</option>)}</select></label><button disabled={!!busy} onClick={()=>{if(dirty.current&&!confirm("저장하지 않은 편집을 비우고 새 학습지를 만들까요?"))return;update(emptyWorksheet());setSelectedId("");setCloudId(undefined);setChats({});setAnswers([]);setSource([]);setProcessed([]);dirty.current=false;}}>새 학습지</button></section>
      <div className="feedback" aria-live="polite">{busy&&<span className="working"><i/>{busy}</span>}{error&&<p role="alert" className="error">{error}</p>}{message&&<p className="success">{message}</p>}</div>
      <fieldset disabled={!!busy} className="workspace">
        <section className="panel source-panel"><div className="panel-heading"><span className="step">01</span><div><h2>원본 가져오기</h2><p>학습지와 답지를 따로 읽을 수 있어요</p></div></div>
          <div className="segmented"><button className={sourceRole==="extract"?"active":""} onClick={()=>{setSourceRole("extract");setProcessed([]);}}>문제 원본</button><button className={sourceRole==="answers"?"active":""} onClick={()=>{setSourceRole("answers");setProcessed([]);}}>답지 원본</button></div>
          <label className="dropzone"><span className="file-icon">↥</span><b>{page?page.name:"학습지 파일 올리기"}</b><small>PDF · 이미지 · TXT<br/>최대 30MB / PDF 20페이지</small><input ref={fileRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.md" onChange={e=>{const f=e.target.files?.[0];if(f)void loadFile(f);e.target.value="";}}/></label>
          <label className="consent"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/><span>AI 사용 시 선택한 원본 이미지·문제·최근 대화를 Gemini에 전송하는 데 동의합니다.</span></label>
          {page&&<><div className="row page-picker"><button disabled={pageIndex===0} onClick={()=>setPageIndex(n=>n-1)}>←</button><select aria-label="원본 페이지" value={pageIndex} onChange={e=>setPageIndex(Number(e.target.value))}>{source.map((p,i)=><option key={i} value={i}>{i+1} / {source.length}페이지 {processed.includes(i)?"· 추출 완료":""}</option>)}</select><button disabled={pageIndex===source.length-1} onClick={()=>setPageIndex(n=>n+1)}>→</button></div>
            <button className="primary wide" disabled={!session||!consent||processed.includes(pageIndex)} onClick={()=>void extractPage()}>{sourceRole==="answers"?"이 페이지 답안 추출":"이 페이지 문제·그림 추출"}</button><p className="hint">한 페이지씩 처리합니다. 스캔본은 이미지로 읽으며, 판독이 어려운 부분은 검토 표시합니다.</p>
            <details><summary>추출 전 원문 텍스트 보기</summary><textarea aria-label="원문 텍스트" rows={7} value={page.text} onChange={e=>setSource(old=>old.map((p,i)=>i===pageIndex?{...p,text:e.target.value}:p))}/><button onClick={()=>{append([newQuestion({text:page.text,sourceName:page.name,sourcePage:page.number})]);}}>텍스트를 한 문제로 추가</button></details>
            {page.image&&<Cropper key={`${page.name}-${page.number}`} page={page} disabled={!!busy} onCrop={dataUrl=>{const figure={id:crypto.randomUUID(),dataUrl,caption:""};if(selected){if(selected.figures.length>=8){setError("문제당 그림은 8개까지입니다.");return;}patchQuestion({figures:[...selected.figures,figure]});}else append([newQuestion({figures:[figure],sourceName:page.name,sourcePage:page.number})]);}}/>}
          </>}
          {answers.length>0&&<div className="answer-import"><h3>답안 연결</h3><select aria-label="추출 답안" value={answerIndex} onChange={e=>setAnswerIndex(Number(e.target.value))}>{answers.map((a,i)=><option key={i} value={i}>원본 {a.label||i+1}번</option>)}</select><p>{answers[answerIndex]?.answer}</p><small>{answers[answerIndex]?.explanation}</small><button disabled={!selected} onClick={()=>{const a=answers[answerIndex];if(!a)return;if(selected?.answer&&!confirm("선택 문제의 기존 답안을 바꿀까요?"))return;patchQuestion({answer:a.answer,explanation:a.explanation,answerSource:"source",reviewed:false});setMessage(`선택 문제에 원본 ${a.label}번 답안을 연결했습니다. 번호를 확인해 주세요.`);}}>현재 선택 문제에 적용</button></div>}
        </section>
        <section className="panel editor-panel"><div className="panel-heading"><span className="step">02</span><div><h2>문제 편집</h2><p>원문·그림·정답을 확인하세요</p></div><span className="count">{doc.questions.length}문제</span></div>
          <div className="question-strip">{doc.questions.map((q,i)=><button key={q.id} className={selectedId===q.id?"selected":""} onClick={()=>setSelectedId(q.id)} title={q.text.slice(0,70)}>문제 {i+1}<small>{originLabels[q.origin]}</small></button>)}<button className="add-question" onClick={()=>append([newQuestion()])} disabled={doc.questions.length>=100}>＋ 문제 추가</button></div>
          {selected?<div className="question-editor"><div className="row between"><span className="tag">{originLabels[selected.origin]} {selected.label&&`· 원본 ${selected.label}번`}</span><div className="row"><button aria-label="문제 앞으로" disabled={doc.questions[0].id===selected.id} onClick={()=>{const qs=[...doc.questions];const i=qs.findIndex(q=>q.id===selected.id);[qs[i-1],qs[i]]=[qs[i],qs[i-1]];update({...doc,questions:qs});}}>←</button><button aria-label="문제 뒤로" disabled={doc.questions.at(-1)?.id===selected.id} onClick={()=>{const qs=[...doc.questions];const i=qs.findIndex(q=>q.id===selected.id);[qs[i+1],qs[i]]=[qs[i],qs[i+1]];update({...doc,questions:qs});}}>→</button><button className="danger" onClick={()=>{if(!confirm("이 문제를 학습지에서 뺄까요?"))return;const qs=doc.questions.filter(q=>q.id!==selected.id);update({...doc,questions:qs});setSelectedId(qs[0]?.id||"");}}>삭제</button></div></div>
            {selected.sourceName&&<p className="hint">출처: {selected.sourceName}{selected.sourcePage>0?` · ${selected.sourcePage}페이지`:""}</p>}
            <label>문제와 보기<textarea aria-label="문제와 보기" rows={12} maxLength={30000} value={selected.text} onChange={e=>patchQuestion({text:e.target.value,reviewed:false})} placeholder="지문, 질문과 보기를 입력하세요. 복잡한 수식은 원본 그림으로 넣을 수 있습니다."/></label>
            <div className="figures">{selected.figures.map(fig=><div key={fig.id}><img src={fig.dataUrl} alt={fig.caption||"문제 그림"}/><input aria-label="그림 설명" maxLength={300} placeholder="그림 설명 (선택)" value={fig.caption} onChange={e=>patchQuestion({figures:selected.figures.map(f=>f.id===fig.id?{...f,caption:e.target.value}:f)})}/><button onClick={()=>patchQuestion({figures:selected.figures.filter(f=>f.id!==fig.id),reviewed:false})}>그림 빼기</button></div>)}</div>
            <details className="answers-editor" open><summary>정답 및 해설 <span className="tag">{answerLabels[selected.answerSource]}</span></summary><label>정답<input aria-label="정답" maxLength={30000} value={selected.answer} onChange={e=>patchQuestion({answer:e.target.value,answerSource:"manual",reviewed:false})}/></label><label>해설<textarea aria-label="해설" rows={5} maxLength={30000} value={selected.explanation} onChange={e=>patchQuestion({explanation:e.target.value,reviewed:false})}/></label><label className="consent"><input type="checkbox" checked={selected.reviewed} onChange={e=>patchQuestion({reviewed:e.target.checked})}/><span>원문·그림·정답을 직접 검토했습니다.</span></label></details>
          </div>:<div className="empty-state"><span>▤</span><h3>첫 문제를 넣어 보세요</h3><p>왼쪽에서 원본을 추출하거나<br/>‘문제 추가’로 직접 시작할 수 있어요.</p><button onClick={()=>append([newQuestion({text:"다음 글의 중심 내용을 설명하시오.\n\nLearning is not simply remembering facts. It is connecting new ideas with what we already know.",answer:"학습은 새로운 생각을 기존 지식과 연결하는 과정이다.",explanation:"두 번째 문장에서 학습의 의미를 설명합니다.",origin:"manual",answerSource:"manual",reviewed:true})])}>예시 문제로 살펴보기</button></div>}
        </section>
        <aside className="panel tools-panel"><div className="tool-tabs"><button className={panel==="export"?"active":""} onClick={()=>setPanel("export")}>다운로드</button><button className={panel==="ai"?"active":""} onClick={()=>setPanel("ai")}>변형·토의</button><button className={panel==="cloud"?"active":""} onClick={()=>setPanel("cloud")}>저장·연동</button></div>
          {panel==="export"&&<><span className="eyebrow">READY TO PRINT</span><h2>나만의 학습지 완성</h2><div className="mini-sheet"><header><b>1</b><span>{doc.title||"입력한 제목"}</span></header><div><article>[문제 1]<p>{doc.questions[0]?.text.slice(0,100)||"첫 번째 문제"}</p></article><article>[문제 2]<p>{doc.questions[1]?.text.slice(0,100)||"두 번째 문제"}</p></article></div></div><p className="hint">A4 · 최대 2문제/페이지 · 홀수면 오른쪽 빈칸<br/>긴 문제는 ‘계속’ 표시로 이어집니다.</p>
            <div className="downloads">{(["questions","answers","combined"] as OutputKind[]).map((kind,i)=><div key={kind}><b>{["문제만","답지만","문제 뒤에 답지"][i]}</b><button disabled={!doc.questions.length} onClick={()=>void exportFile(kind,"docx")}>Word ↓</button><button disabled={!doc.questions.length} onClick={()=>void exportFile(kind,"pdf")}>PDF ↓</button></div>)}</div>
            <button className="primary wide" disabled={!doc.questions.length} onClick={()=>void exportFile("combined","pdf",true)}>실제 합본 PDF 미리보기</button><p className="hint">Word는 편집 가능한 텍스트와 그림으로 저장됩니다. Word용 한글 글꼴은 아래에서 받을 수 있어요.</p><a href="./fonts/NanumGothic-Regular.ttf" download>나눔고딕 글꼴 받기</a>
            {doc.questions.some(q=>!q.reviewed)&&<p className="warning">미검토 문제가 있습니다. 미검토 답안에는 ‘검토 필요’가 표시됩니다. AI 정답은 실제 답지와 다를 수 있습니다.</p>}
          </>}
          {panel==="ai"&&<><span className="eyebrow">THINK & REMIX</span><h2>문제의 다음 가능성</h2><p className="hint">현재 선택한 문제와 그림(최대 4개)을 기준으로 작동합니다. 실제 시험 출제를 보장하지 않습니다.</p><label>선생님이 알려준 출제 방향<textarea aria-label="출제 방향" rows={4} maxLength={2000} value={instruction} onChange={e=>setInstruction(e.target.value)} placeholder="예: 이 개념을 조건을 바꾼 서술형으로 내신대요. 풀이 과정을 묻는 문제로 바꿔 줘."/></label><div className="row"><select aria-label="변형 문제 수" value={count} onChange={e=>setCount(Number(e.target.value))}>{Array.from({length:10},(_,i)=><option key={i} value={i+1}>{i+1}문제</option>)}</select><button className="primary" disabled={!selected||!session||!consent} onClick={()=>void generate("variant")}>변형 문제 추가</button></div><button className="wide" disabled={!selected||!session||!consent} onClick={()=>{if(selected?.answer&&!confirm("기존 답안을 AI 초안으로 바꿀까요?"))return;void generate("solve");}}>정답·해설 AI 초안 만들기</button><p className="hint">변형은 새 문제로 추가됩니다. 원본은 유지하며, 바뀐 조건과 맞지 않을 수 있는 원본 그림은 자동 복사하지 않습니다.</p>
            <h3>이 문제에 대해 토의하기</h3><div className="chat-messages" role="log">{messages.map((m,i)=><p key={i} className={m.role}>{m.text}</p>)}</div><textarea aria-label="토의 메시지" rows={3} maxLength={2000} value={chatInput} onChange={e=>setChatInput(e.target.value)} placeholder="다른 풀이도 가능해? 이 조건이 없어지면?"/><button className="primary wide" disabled={!selected||!session||!consent||!chatInput.trim()} onClick={()=>void sendChat()}>질문 보내기</button>
          </>}
          {panel==="cloud"&&<><span className="eyebrow">CONNECTED WORKSPACE</span><h2>저장하고 이어서</h2><p className="hint">파일 원본은 브라우저에서만 읽습니다. 클라우드 저장 시 편집한 문제와 잘라낸 그림만 계정에 저장됩니다.</p>
            <div className="row"><button onClick={()=>run("백업 만드는 중",async()=>{parseWorksheet(doc);const {downloadBlob,safeFilename}=await import("./export");downloadBlob(new Blob([JSON.stringify(doc)],{type:"application/json"}),`${safeFilename(doc.title)}.printmaker.json`);dirty.current=false;setMessage("편집 백업을 다운로드했습니다.");})}>편집 백업 ↓</button><label className="button-label">백업 열기<input type="file" accept=".json" onChange={e=>{const f=e.target.files?.[0];if(!f)return;void run("백업 여는 중",async()=>{if(f.size>12_000_000)throw new Error("백업이 너무 큽니다.");const next=parseWorksheet(JSON.parse(await f.text()));if(dirty.current&&!confirm("현재 편집 내용을 바꿀까요?"))return;update(next);setCloudId(undefined);setSelectedId(next.questions[0]?.id||"");setChats({});dirty.current=false;});e.target.value="";}}/></label></div>
            <button className="primary wide" disabled={!session} onClick={()=>run("클라우드 저장 중",async()=>{setCloudId(await saveCloud(doc,cloudId));dirty.current=false;setMessage("현재 학습지를 계정에 저장했습니다.");})}>클라우드에 저장</button>
            <button className="wide" disabled={!session} onClick={()=>run("저장 목록 확인 중",async()=>{const {data,error}=await supabase!.from("printmaker_worksheets").select("id,title").order("updated_at",{ascending:false}).limit(100);if(error)throw error;setSaved(data);if(!data.length)setMessage("저장한 학습지가 없습니다.");})}>내 학습지 불러오기</button><div className="saved-list">{saved.map(row=><div key={row.id}><button onClick={()=>void loadSaved(row.id)}>{row.title}</button><button className="danger" aria-label={`${row.title} 저장본 삭제`} onClick={()=>run("삭제 중",async()=>{if(!confirm(`‘${row.title}’ 클라우드 저장본을 영구 삭제할까요?`))return;const {error}=await supabase!.from("printmaker_worksheets").delete().eq("id",row.id);if(error)throw error;setSaved(old=>old.filter(x=>x.id!==row.id));if(cloudId===row.id)setCloudId(undefined);})}>×</button></div>)}</div>
            <hr/><h3>Moonwords 연결</h3><button className="wide" disabled={!session} onClick={()=>run("Moonwords 본문 읽는 중",async()=>{const {data,error}=await supabase!.from("documents").select("id,title,original_text,analysis").order("created_at",{ascending:false}).limit(50);if(error)throw error;setMoonDocs(data);if(!data.length)setMessage("Moonwords에 저장한 본문이 없습니다.");})}>내 Moonwords 본문 가져오기</button><div className="saved-list">{moonDocs.map(row=><button key={row.id} onClick={()=>{try{append(moonwordsQuestions(row));setMessage("본문과 이해 문제를 가져왔습니다. Moonwords 원본은 변경하지 않았습니다.");}catch(e){setError(String(e));}}}>{row.title} ＋</button>)}</div>
            <button className="wide" disabled={!selected} onClick={()=>{try{sendToMoonwords(doc.title,selected!.text);}catch(e){setError(e instanceof Error?e.message:String(e));}}}>선택 문제를 Moonwords 본문으로 보내기 ↗</button><p className="hint">같은 도메인·같은 Supabase 프로젝트일 때 본문 전송과 계정 공유가 가능합니다. 원본 앱의 데이터는 자동 변경하지 않습니다.</p>
          </>}
        </aside>
      </fieldset>
      <footer className="footer"><span>Printmaker · Moonwords와 함께하는 학습 도구</span><span>사용 권한이 있는 자료만 올려 주세요. AI 추출·답안은 검토가 필요합니다.</span></footer>
    </main>
    {preview&&<div className="preview-overlay" role="dialog" aria-modal="true" aria-label="합본 PDF 미리보기"><div className="row between"><b>합본 PDF 미리보기</b><button autoFocus onClick={()=>{URL.revokeObjectURL(previewRef.current);previewRef.current="";setPreview("");}}>닫기 ×</button></div><iframe src={preview} title="학습지 PDF"/></div>}
  </div>;
}
