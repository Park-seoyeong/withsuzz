# Claude 아티팩트 버전

같은 사이트를 Claude(claude.ai) 안의 비공개 아티팩트로 엽니다. 서버·API 키·배포가 필요 없습니다.

- 주소: https://claude.ai/artifact/MAzah1CyrAVTgsLMZ1cRDK (소유자만 열 수 있음)
- 빌드: `npm ci && npm run build:artifact` → `dist/artifact/index.html`을 Artifact로 다시 게시합니다(같은 URL 유지).

## 구조

`scripts/build-artifact.mjs`가 화면(`public/app.js`, `app.css`)과 서버 코드(`worker/*`)를 한 HTML로 묶습니다. `artifact/shim.js`가 `fetch('/api/...')`를 가로채 같은 서버 코드를 브라우저 안에서 실행하고, 저장소를 Claude 기능으로 바꿔 끼웁니다.

| 원래(Cloudflare/Sites) | Claude 아티팩트 |
|---|---|
| D1 `workspace` 문서 | `db` 기능 `workspace/meta` + 6만 자 단위 조각(`workspace/meta/chunks/c0000`…) |
| R2 첨부 파일 | `assets` 기능(파일 id는 `blobs/*` 문서에 기록) |
| 관리자 비밀번호·세션 | claude.ai 계정 접근 관리(`ARTIFACT` 모드에서 서버 로그인 생략) |
| OpenAI/Claude API 키 | `sample` 기능: 보는 사람의 Claude 계정으로 작성(첫 사용 때 허락 창) |
| 파일 내려받기 | `downloads` 기능(저장 확인 창) |

db 접근 규칙은 루트 읽기·쓰기 모두 `admin` 이상이라, 공유하더라도 Editor 이상만 자료를 봅니다.

## 막힌 기능을 다른 길로 연결한 방법

| 원래 막힌 것 | 아티팩트에서 쓰는 방법 |
|---|---|
| AI 웹 검색·외부 RSS | Claude 클라우드 예약 작업 `써즈 동네방네 · 여행 뉴스·최신 정보 조사`(trig_01UYFbcWM6A6JUG1JS6BE8B6, 매일 06:47 KST)이 WebSearch로 여행 뉴스를 찾아 `feeds/trends`에, 글별 조사 요청을 `research/<글감 id>`에 씁니다. 글쓰기의 ‘최신 정보 조사 요청’은 `mcp`(Claude Code Remote · fire_trigger)로 바로 실행을 시작합니다. 조사 결과는 7일 동안 AI 초안의 근거·출처로 쓰입니다. |
| PDF 읽기 | cdnjs의 pdf.js(3.11.174)를 처음 PDF를 만났을 때 불러와 글자를 뽑고, 글자 없는 쪽은 그림으로 바꿔 보냅니다. |
| 네이버 통계·브랜드 커넥트·세시간전·SNS 자동 연동 | 성과·리포트 → ‘캡처로 성과 입력’: 화면 캡처나 복사한 표를 Claude가 읽고, 사용자가 숫자를 확인·수정한 뒤 저장합니다(출처 ‘캡처 판독’). |
| 네이버 자동·예약 발행 | 발행 관리 → ‘예약 꾸러미’: 제목·서식 본문·태그 복사, 사진 순서대로 저장, 예약 시각(10분 단위) 안내, Claude 데스크톱(Claude in Chrome)에 붙여넣을 지시 복사. 네이버 편집기의 예약 발행으로 올린 뒤 ‘예약 완료 기록’(글감 → 예약됨), 시각이 지나면 ‘게시 확인’에 써즈 블로그 글 주소를 남기면 게시됨·발행 경험치가 기록됩니다. 직접 기록(method: manual)은 원격 재조회 확인과 구분해 저장합니다. 글쓰기의 ‘네이버용 서식 복사’도 그대로 씁니다. |
| 노션 연결 | 관리자 설정 → ‘노션 내보내기 파일로 이전·누락 점검’: 노션 내보내기(Markdown & CSV) ZIP·CSV·MD를 읽어 사이트에 없는 글감만 가져옵니다(ZIP은 cdnjs JSZip). |

## 남은 한계

- 뉴스 피드는 검색량 지수가 아니라 뉴스 제목입니다. 날짜가 안 보이는 기사는 ‘기사 날짜 미확인 · 찾은 시각’으로 표시합니다.
- 캡처 판독 값은 사용자가 확인한 수동 입력으로 다룹니다. 네이버 원격 수집과 같은 근거로 보지 않습니다.
- 네이버 사진 업로드·예약 발행 자동화, ChatGPT 플러그인, 자동화 경로는 아티팩트에서 연결되지 않습니다.
- 예전 사이트 자료는 그쪽의 **전체 자료 백업** JSON을 **관리자 설정 → 백업 파일로 복원**으로 옮깁니다. 사진·PDF 원본은 다시 올립니다.
