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

## 차이와 한계

- AI 작성은 웹 검색을 하지 않습니다. 결과에 "최신 확인 미완료"가 표시되고 현재 정보는 확인할 정보로 분리됩니다.
- PDF는 AI가 직접 읽지 못합니다(사진·텍스트 파일은 읽음). 결과에 그 사실을 표시합니다.
- 외부 트렌드 RSS, 네이버 통계 자동 갱신, ChatGPT 플러그인, 자동화 경로는 아티팩트 안에서 연결되지 않습니다.
- 예전 사이트 자료는 그쪽의 **전체 자료 백업** JSON을 **관리자 설정 → 백업 파일로 복원**으로 옮깁니다. 사진·PDF 원본은 다시 올립니다.
