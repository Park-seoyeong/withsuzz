# 써즈 원고 보관함

`drafts/` 폴더의 `*_새서식.html` 원고를 한 페이지로 모아 보는 비공개 Claude 아티팩트예요.

- 주소: https://claude.ai/artifact/3rdva3pSny9scMGenzvBuJ (소유자만 열 수 있음)
- 할 수 있는 것: 원고 목록(미발행·날짜 지남·발행 완료·보류), 이번 주 발행 일정, 네이버 붙여넣기용 본문 미리보기와 복사, 상태·발행일·메모 저장
- 발행일·상태의 원본은 노션 '소셜 미디어 플래너'예요. 페이지가 보는 사람의 노션 연결(`mcp` 기능)로 플래너를 읽고, 상태·게시 날짜를 바꾸면 노션 페이지도 바꿔요. 이번 주 띠에는 원고 파일이 없는 노션 항목도 점선으로 보여요.
- 원고↔노션 항목 연결, 메모, '보류' 표시, 노션에 없는 원고의 상태·발행일은 아티팩트 `db`(컬렉션 `posts`, 문서 id = 파일 이름으로 만든 고정 id, 필드 `notion` = 노션 페이지 id)에 저장돼요.

## 새 원고 반영하기

```
node bogwanham/build.mjs /mnt/project-files/drafts bogwanham/dist/index.html
```

만든 `dist/index.html`을 같은 아티팩트 주소로 다시 올리면 돼요(원고 파일은 읽기만 함). 새 원고의 아티팩트 주소는 `artifact-links.json`에 추가해요.

예전 `withsuzz-manager` 사이트(저장소 나머지 폴더)는 2026-11-11부터 쓰지 않아요.
