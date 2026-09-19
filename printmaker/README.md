# Printmaker

학습지의 텍스트와 그림을 추출·편집하고, 제공된 `학프.pdf` 양식에 맞춰 문제지와 답지를 만드는 앱입니다. Moonwords와 **같은 Supabase**, **별도 GitHub 저장소**를 사용합니다. 기존 Moonwords 테이블을 수정하지 않습니다.

## 사용 순서

1. 상단에 학습지 제목을 입력합니다. 출력물 전체의 제목으로 사용됩니다.
2. 문제 원본 또는 답지 원본을 선택하고 PDF / PNG / JPG / WEBP / TXT 파일을 올립니다.
3. 디지털 PDF 텍스트는 브라우저에서 먼저 읽습니다. AI 전송에 동의한 후 **한 페이지씩** 문제와 그림을 추출합니다. 스캔 PDF는 페이지 이미지를 AI가 읽습니다. 빈 양식은 문제 원본이 아닙니다.
4. 원본과 추출 결과를 비교합니다. 드래그로 그림·표·수식을 다시 잘라 넣을 수 있고, 원문 텍스트를 직접 넣으면 AI 없이도 편집할 수 있습니다.
5. 답지 파일에서 추출한 답은 원본 번호를 확인한 뒤 선택 문제에 직접 연결합니다. 자동 추측으로 덮어쓰지 않습니다. AI 정답 초안 생성도 별도로 가능합니다.
6. 변형·토의 탭에서 출제 방향을 적고 최대 10문제를 추가하거나, 선택 문제에 대해 후속 질문을 나눕니다. 원본은 보존합니다.
7. 검토한 문제의 ‘직접 검토했습니다’에 체크하고 다운로드합니다.

| 구성 | Word | PDF |
|---|---|---|
| 문제만 | 편집 가능한 DOCX | 정답 제외 |
| 답지만 | 정답·해설 DOCX | 정답·해설 |
| 합본 | 문제 전체 뒤 답지 | 문제 전체 뒤 새 페이지에 답지 |

A4 세로, 초록색 제목과 페이지 번호, 중앙 세로선, **페이지당 최대 두 문제**입니다. 홀수 문제의 오른쪽은 비워 둡니다. 긴 문항은 번호를 유지하고 ‘계속’으로 다음 칸/페이지에 이어집니다. 각 문제는 새 칸에서 시작합니다. Word는 글자와 그림이 편집 가능하지만 기기 글꼴과 Word 버전에 따라 줄 배치가 달라질 수 있습니다. 함께 제공하는 나눔고딕을 설치하면 차이가 줄어듭니다. 고정 인쇄는 PDF를 권장합니다.

## 1. GitHub 설정

새 `seouk-Moon/printmaker` 저장소의 **최상단**에 이 폴더 안의 파일을 올립니다. `printmaker/` 폴더가 저장소 안에 한 번 더 중첩되면 안 됩니다.

Settings → Secrets and variables → Actions → **Variables**에 기존 Moonwords와 같은 값을 등록합니다.

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

Settings → Pages → Source를 **GitHub Actions**로 선택합니다. 포함된 `.github/workflows/deploy-pages.yml`이 빌드·배포합니다. 주소는 `https://seouk-moon.github.io/printmaker/`입니다. Gemini 키와 service_role 키는 프런트엔드나 GitHub 파일에 넣지 않습니다.

## 2. 기존 Supabase에 SQL 한 번 실행

기존 Moonwords Supabase 프로젝트 → SQL Editor → New query에서 `supabase/migrations/202609200001_printmaker.sql` **전체**를 붙여 넣고 Run합니다.

추가되는 것은 `printmaker_worksheets`, `printmaker_ai_usage`와 요청 수 제한 함수뿐입니다. 기존 사용자와 Moonwords 데이터는 그대로 유지됩니다. 학습지 및 추출 그림은 소유자 RLS로 보호된 JSON 데이터로 저장되며, 별도 Storage 버킷은 이 버전에서는 필요 없습니다. 저장 크기는 브라우저 검증 기준 학습지당 약 8MB입니다.

## 3. Edge Function 새로 하나 배포

기존 `process-document`를 덮어쓰지 마세요.

1. Supabase → Edge Functions → 새 함수 → 이름 **`printmaker-ai`**.
2. `supabase/functions/printmaker-ai/index.ts`의 전체 코드를 넣고 Deploy.
3. 함수 설정에서 **Verify JWT with legacy secret**을 끕니다. 코드는 요청마다 `auth.getUser()`로 실제 사용자를 검증하므로 익명 AI 호출은 허용되지 않습니다. 새로운 publishable key 환경과의 호환을 위한 설정입니다.
4. 기존 `GEMINI_API_KEY` Secret을 공동 사용합니다.
5. `PRINTMAKER_GEMINI_MODEL`에는 Google AI Studio에서 사용 가능한 이미지 입력 지원 모델 ID를 넣습니다. 미설정이면 기존 `GEMINI_MODEL` 값을 사용합니다. 둘 다 없으면 오류로 안내합니다. 모델 지원 여부는 계정과 시점에 따라 다르므로 앱에 고정하지 않았습니다.
6. 선택 사항: `PRINTMAKER_FALLBACK_MODELS`에 대체 모델 ID를 쉼표로 구분해 넣습니다. 429/503/일시 장애에는 지수 간격 재시도(총 최대 3회)를 합니다.

CLI 사용자만:

```sh
npx supabase link --project-ref 기존_프로젝트_ID
npx supabase functions deploy printmaker-ai --no-verify-jwt
```

전체 기존 migration 이력이 없는 새 저장소에서 무작정 `db push`하지 말고, 위 SQL Editor로 새 SQL만 적용하세요.

기본 AI 사용 제한은 사용자당 하루 40회, 서비스 전체 하루 500회(UTC 자정 기준)입니다. 추출은 페이지당 1회, 재시도 포함 실패 요청도 한도를 소모합니다. `PRINTMAKER_DAILY_LIMIT`, `PRINTMAKER_GLOBAL_DAILY_LIMIT` Secrets로 조정할 수 있습니다. Google 측 별도 요금과 한도가 적용됩니다. 이 제한은 프런트엔드가 아닌 DB에서 원자적으로 검사합니다.

## 4. 로그인과 Moonwords 연결

Supabase → Authentication → URL Configuration → Redirect URLs에 `https://seouk-moon.github.io/printmaker/`를 추가합니다. Site URL은 기존 값을 유지해도 됩니다. 로그인 화면은 기존 Moonwords 이메일/비밀번호를 사용합니다. 회원가입·비밀번호 관리는 Moonwords로 연결됩니다.

같은 도메인과 같은 Supabase 프로젝트에서는 Moonwords의 기본 토큰 저장 방식과 ‘자동 로그인’ 설정을 맞춰 사용합니다. 도메인이 달라지면 자동 로그인 공유가 되지 않으며 각 앱에서 로그인해야 합니다. 사용자 계정은 같아도 브라우저 저장 공간은 도메인별입니다.

- Printmaker → 저장·연동 → ‘내 Moonwords 본문 가져오기’: `documents`를 로그인 사용자 RLS 범위 내에서 읽고 본문+문제를 가져옵니다. 기존 문서는 바꾸지 않습니다.
- ‘선택 문제를 Moonwords 본문으로 보내기’: 같은 도메인에서 선택 문제 텍스트를 기존 PDF 가져오기 통로로 전송합니다. **그림과 답안은 전송하지 않습니다.** Moonwords에서 최종 생성 버튼을 눌러야 새 본문이 저장됩니다.
- Moonwords에서 Printmaker로 들어가는 메뉴는 별도 제공하는 Moonwords 전체 ZIP에 포함됩니다.

## 편집 저장과 개인정보

파일 선택만으로 원본 전체가 서버에 올라가지 않습니다. AI 버튼을 누르면 선택 페이지/선택 문제와 그림 최대 4개, 최근 대화 최대 8개가 Edge Function을 거쳐 Gemini에 전송됩니다. 저장 버튼을 누르면 문제·답안·잘라낸 그림이 Supabase에 저장됩니다. 대화 내용은 현재 화면의 메모리에만 있고 재접속하면 사라집니다. 편집 내용은 **자동 저장되지 않으므로**, 클라우드 저장이나 ‘편집 백업’ JSON 다운로드를 이용하세요. 저장하지 않고 나가면 브라우저 경고가 표시됩니다.

## 제한과 확인 사항

- PDF 20페이지/30MB, 학습지 100문제, 문항별 30,000자·그림 8개 제한입니다. 넘는 파일은 명확히 거절하며 조용히 잘라내지 않습니다.
- 원본 페이지 경계를 가로지르는 문제, 복잡한 수식, 작은 글씨, 그림 영역은 수동 검토가 필요합니다. 문제 텍스트에서 원본 답안이 함께 인식됐다면 출력 전에 제거하세요.
- 복잡한 수식은 원본 그림으로 보존합니다. Word의 네이티브 수식(OMML) 자동 변환은 지원하지 않습니다. 지원되지 않는 문자는 출력 전에 안내하며 수식 영역을 그림으로 넣을 수 있습니다.
- 변형 문제는 새 도형을 생성하지 않습니다. 원본 그림의 수치와 충돌하지 않도록 텍스트로 완결되는 문제를 생성합니다.
- AI가 공식 정답이나 실제 출제 문제를 보장하지 않습니다. 미검토 답지에는 검토 표시가 남습니다.
- Word 배포용 글꼴은 `public/fonts/OFL.txt` 라이선스를 동봉했습니다. 원본 양식은 `public/templates/worksheet-reference.pdf`에 보관했습니다.

## 개발

```sh
npm ci
cp .env.example .env.local
npm run dev
npm test
npm run build:pages
```

GitHub Actions와 동일하게 Node 22.13 이상을 사용합니다. `src/extract.ts` 추출, `src/export.ts` 출력, `src/model.ts` 데이터 검증, `src/cloud.ts` 계정/저장/연동, `supabase/` 서버와 SQL로 나뉩니다.
