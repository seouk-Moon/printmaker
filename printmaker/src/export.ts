import type { Worksheet } from "./model";
import { parseWorksheet } from "./model";
import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";

export type OutputKind = "questions" | "answers" | "combined";
type Block = {type:"line"; text:string} | {type:"image"; data:string; width:number; height:number};
export type Slot = {number:number; continued:boolean; blocks:Block[]};
export type SheetPage = {answer:boolean; slots:Slot[]};
const WIDTH=236, BODY_HEIGHT=526;
export const outputLabels={questions:"문제",answers:"답지",combined:"문제와답지"};
let fontPromise:Promise<ArrayBuffer>|undefined;
async function fontBytes() {
  if(!fontPromise) fontPromise=fetch(`${import.meta.env.BASE_URL}fonts/NanumGothic-Regular.ttf`).then(r=>{if(!r.ok)throw new Error("한글 글꼴을 불러오지 못했습니다. 새로고침 후 다시 시도해 주세요.");return r.arrayBuffer();}).catch(e=>{fontPromise=undefined;throw e;});
  return fontPromise;
}
export function wrapText(text:string, measure:(s:string)=>number, width:number):string[] {
  const lines:string[]=[];
  for(const paragraph of text.replace(/\r\n?/g,"\n").replace(/\t/g,"    ").split("\n")) {
    if(!paragraph) {lines.push("");continue;}
    let current="";
    for(const char of paragraph) {
      if(current && measure(current+char)>width) {
        const space=current.lastIndexOf(" ");
        if(space>current.length/2) {lines.push(current.slice(0,space));current=current.slice(space+1)+char;}
        else {lines.push(current);current=char;}
      } else current+=char;
    }
    if(current) lines.push(current);
  }
  return lines;
}
export async function prepareLayout(doc:Worksheet, kind:OutputKind) {
  parseWorksheet(doc);
  if(!doc.title.trim()) throw new Error("상단에 표시할 제목을 먼저 입력해 주세요.");
  if(!doc.questions.length) throw new Error("문제를 먼저 추가해 주세요.");
  const pdf=await PDFDocument.create();pdf.registerFontkit(fontkit);
  // Full embedding preserves NanumGothic composite glyphs in PDF viewers.
  const font=await pdf.embedFont(await fontBytes(),{subset:false});
  const supported=new Set(font.getCharacterSet());
  const check=(text:string)=>{
    const unsupported=[...new Set([...text].filter(c=>!/[\n\r\t]/.test(c)&&!supported.has(c.codePointAt(0)!)))];
    if(unsupported.length) throw new Error(`글꼴이 지원하지 않는 문자(${unsupported.slice(0,8).join(" ")})가 있습니다. 복잡한 수식·기호는 원본에서 그림으로 잘라 넣어 주세요.`);
  };
  check(doc.title);
  const pages:SheetPage[]=[];
  for(const answer of kind==="combined"?[false,true]:[kind==="answers"]) {
    const slots:Slot[]=[];
    for(const [index,q] of doc.questions.entries()) {
      const text=answer ? `${q.answer || "정답 미입력"}\n\n${q.explanation}${q.reviewed?"":"\n\n[검토 필요: 정답과 해설을 확인해 주세요.]"}` : q.text;
      check(text);
      const lines=wrapText(text,s=>font.widthOfTextAtSize(s,doc.fontSize),WIDTH);
      const blocks:Block[]=lines.map(line=>({type:"line",text:line}));
      if(!answer) for(const fig of q.figures) {
        const img=new Image();img.src=fig.dataUrl;await img.decode();
        const scale=Math.min(WIDTH/img.naturalWidth,270/img.naturalHeight,1);
        // Normalize WEBP to PNG for both PDF and Word compatibility.
        const canvas=document.createElement("canvas");canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;canvas.getContext("2d")!.drawImage(img,0,0);
        blocks.push({type:"image",data:canvas.toDataURL("image/png"),width:img.naturalWidth*scale,height:img.naturalHeight*scale});
        if(fig.caption) {check(fig.caption);blocks.push(...wrapText(fig.caption,s=>font.widthOfTextAtSize(s,doc.fontSize),WIDTH).map(text=>({type:"line" as const,text})));}
      }
      let slot:Slot={number:index+1,continued:false,blocks:[]};let used=0;
      for(const block of blocks) {
        const height=block.type==="line"?doc.fontSize*1.6:block.height+10;
        if(used+height>BODY_HEIGHT && slot.blocks.length) {slots.push(slot);slot={number:index+1,continued:true,blocks:[]};used=0;}
        slot.blocks.push(block);used+=height;
      }
      slots.push(slot);
    }
    for(let i=0;i<slots.length;i+=2) pages.push({answer,slots:slots.slice(i,i+2)});
  }
  if(pages.length>300) throw new Error("300페이지를 넘습니다. 학습지를 나눠 주세요.");
  return {pdf,font,pages};
}
export async function makePdf(doc:Worksheet,kind:OutputKind):Promise<Blob> {
  const {pdf,font,pages}=await prepareLayout(doc,kind);
  pdf.setTitle(`${doc.title} ${outputLabels[kind]}`);pdf.setCreator("Printmaker");
  for(const [index,sheet] of pages.entries()) {
    const page=pdf.addPage([595.28,841.89]);
    page.drawRectangle({x:0,y:780,width:40,height:32,color:rgb(.36,.48,.25)});
    page.drawText(String(index+1),{x:17,y:788,font,size:18,color:rgb(1,1,1)});
    const title=doc.title+(sheet.answer?" · 정답 및 해설":"");
    const titleLines=wrapText(title,s=>font.widthOfTextAtSize(s,18),510);
    if(titleLines.length>2) throw new Error("제목이 너무 길어 두 줄을 넘습니다. 제목을 줄여 주세요.");
    titleLines.forEach((line,i)=>page.drawText(line,{x:45,y:791-i*23,font,size:18,color:rgb(.25,.39,.18)}));
    page.drawLine({start:{x:297.64,y:756},end:{x:297.64,y:163},thickness:1,color:rgb(0,0,0)});
    for(const [column,slot] of sheet.slots.entries()) {
      const x=column?309:35;
      page.drawText(`[${sheet.answer?"정답":"문제"} ${slot.number}]${slot.continued?" (계속)":""}`,{x,y:744,font,size:13});
      let y=716;
      for(const block of slot.blocks) {
        if(block.type==="line") {if(block.text)page.drawText(block.text,{x,y,font,size:doc.fontSize});y-=doc.fontSize*1.6;}
        else {const image=await pdf.embedPng(block.data);page.drawImage(image,{x,y:y-block.height,width:block.width,height:block.height});y-=block.height+10;}
      }
    }
  }
  const bytes=await pdf.save();return new Blob([new Uint8Array(bytes)],{type:"application/pdf"});
}
export async function makeWord(doc:Worksheet,kind:OutputKind):Promise<Blob> {
  const {pages}=await prepareLayout(doc,kind);
  const {Document,Packer,Paragraph,TextRun,Table,TableRow,TableCell,WidthType,BorderStyle,HeightRule,ImageRun,LineRuleType,TableLayoutType}=await import("docx");
  const none={style:BorderStyle.NONE,size:0,color:"FFFFFF"};
  const fontName="NanumGothic";
  const sections=pages.map((sheet,index)=>({
    properties:{page:{size:{width:11906,height:16838},margin:{top:580,bottom:1200,left:700,right:700}}},
    children:[
      new Paragraph({spacing:{after:440},children:[new TextRun({text:` ${index+1} `,color:"FFFFFF",shading:{fill:"5D7B40"},size:36,font:fontName}),new TextRun({text:` ${doc.title}${sheet.answer?" · 정답 및 해설":""}`,font:fontName,color:"40632E",bold:true,size:36})]}),
      new Table({width:{size:10506,type:WidthType.DXA},columnWidths:[5253,5253],layout:TableLayoutType.FIXED,borders:{top:none,bottom:none,left:none,right:none,insideHorizontal:none,insideVertical:{style:BorderStyle.SINGLE,size:8,color:"000000"}},rows:[
        new TableRow({cantSplit:true,height:{value:11600,rule:HeightRule.ATLEAST},children:[0,1].map(column=>{
          const slot=sheet.slots[column];
          return new TableCell({width:{size:5253,type:WidthType.DXA},margins:{top:0,bottom:0,left:column?220:0,right:column?0:240},children:!slot?[new Paragraph("")]:[
            new Paragraph({spacing:{after:220},children:[new TextRun({text:`[${sheet.answer?"정답":"문제"} ${slot.number}]${slot.continued?" (계속)":""}`,font:fontName,size:26})]}),
            ...slot.blocks.map(block=>block.type==="line"?new Paragraph({spacing:{before:0,after:0,line:doc.fontSize*32,lineRule:LineRuleType.EXACT},children:[new TextRun({text:block.text||" ",font:fontName,size:doc.fontSize*2})]}):new Paragraph({spacing:{before:0,after:200},children:[new ImageRun({type:"png",data:Uint8Array.from(atob(block.data.split(",")[1]),c=>c.charCodeAt(0)),transformation:{width:block.width*4/3,height:block.height*4/3},altText:{title:"문제 그림",description:"원본에서 추출한 그림",name:"figure"}})]})),
          ]});
        })}),
      ]}),
    ],
  }));
  const document=new Document({creator:"Printmaker",title:doc.title,styles:{default:{document:{run:{font:fontName,size:doc.fontSize*2},paragraph:{spacing:{after:0}}}}},sections});
  return Packer.toBlob(document);
}
export function downloadBlob(blob:Blob,name:string) {const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}
export const safeFilename=(title:string)=>title.replace(/[\\/:*?"<>|\x00-\x1f]/g,"_").slice(0,70)||"학습지";
