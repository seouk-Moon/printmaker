import { createClient } from "@supabase/supabase-js";
import type { Worksheet } from "./model";
import { parseWorksheet } from "./model";
export const moonwordsUrl = import.meta.env.VITE_MOONWORDS_URL || "https://seouk-moon.github.io/moonwords/";
const authStorage = {
  getItem(key: string) { return localStorage.getItem("moonwords-auto-login") === "false" ? sessionStorage.getItem(key) : localStorage.getItem(key) ?? sessionStorage.getItem(key); },
  setItem(key: string, value: string) { const persistent = localStorage.getItem("moonwords-auto-login") !== "false"; (persistent ? localStorage : sessionStorage).setItem(key,value); (persistent ? sessionStorage : localStorage).removeItem(key); },
  removeItem(key: string) { localStorage.removeItem(key); sessionStorage.removeItem(key); },
};
export const supabase = import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
  ? createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY, {auth:{storage:authStorage,persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}}) : null;
export async function aiRequest(body: Record<string, unknown>) {
  if (!supabase) throw new Error("Supabase 환경 변수 설정 후 사용할 수 있습니다.");
  const {data:{session}} = await supabase.auth.getSession();
  if (!session) throw new Error("Moonwords 계정으로 먼저 로그인해 주세요.");
  const {data,error} = await supabase.functions.invoke("printmaker-ai", {body});
  if (error) {
    let message = error.message;
    try { const json = await error.context?.json(); if (json?.error) message = json.error; } catch { /* network error */ }
    throw new Error(message || "AI 연결 실패: printmaker-ai 배포와 키 설정을 확인해 주세요.");
  }
  if (data?.error) throw new Error(data.error);
  if (!data || typeof data !== "object") throw new Error("AI 응답을 읽을 수 없습니다.");
  return data;
}
export async function saveCloud(worksheet: Worksheet, id?: string) {
  if (!supabase) throw new Error("Supabase 연결이 필요합니다.");
  parseWorksheet(worksheet);
  const {data:{user}} = await supabase.auth.getUser();
  if (!user) throw new Error("로그인이 필요합니다.");
  const row = {user_id:user.id,title:worksheet.title || "제목 없는 학습지",payload:worksheet,updated_at:new Date().toISOString()};
  const query = id ? supabase.from("printmaker_worksheets").update(row).eq("id",id).eq("user_id",user.id) : supabase.from("printmaker_worksheets").insert(row);
  const {data,error} = await query.select("id").single();
  if(error) throw new Error(`저장 실패: ${error.message}. Printmaker SQL 적용 여부를 확인해 주세요.`);
  return data.id as string;
}
export function sendToMoonwords(title: string, text: string) {
  if(text.trim().length < 40 || text.length > 120000) throw new Error("Moonwords로 보낼 본문은 40~120,000자여야 합니다.");
  const target = new URL(moonwordsUrl,location.href);
  if(target.origin !== location.origin) throw new Error("본문 전송은 두 앱이 같은 도메인에 있을 때 가능합니다. 텍스트를 복사해 Moonwords에 붙여 넣어 주세요.");
  sessionStorage.setItem("moonwords:pdf-text-transfer:v1",JSON.stringify({title,text,sourceName:"Printmaker",createdAt:Date.now()}));
  location.assign(target.href);
}
