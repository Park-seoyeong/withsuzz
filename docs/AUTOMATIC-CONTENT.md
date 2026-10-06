# 자동 글 제작

자동 글은 직접 작성하는 여행 글과 별도로 관리합니다. 아시아 이슈·브랜드 커넥트 각 하루 하나, 한국 시간 새벽 01:00의 기획 슬롯으로 준비합니다. 조사 확인 → 검수한 원고 → 실제 사진과 이용 권한 → 발행 준비를 이어갑니다. 준비 저장은 네이버 예약 완료가 아닙니다.

owner-private Sites dispatch의 `/api/automatic-agent`는 관리자 브라우저의 로그인·Origin 검증을 유지합니다. 외부 서비스 토큰은 사이트에만 전달하고 TinyFish·네이버에는 제공하지 않습니다.

- GET: 자동 기획 요약; `?itemId=...`: 한 기획의 실제 자료·원고·revision·첨부 권한.
- POST `op: brief`: 고유 requestId, lane, 미래 한국 시각 `YYYY-MM-DDT01:00`, 추천 이유, 최근 36시간 이내 확인한 공식 sources의 url/title/checkedAt/facts. 같은 날짜·종류를 중복 생성하지 않습니다. 브랜드 커넥트는 실제 본인 구매 제휴 링크와 제공 조건 고지가 필요합니다. 관리 화면 주소·검색량 추측·후기 수를 검색량으로 바꾸는 입력을 사용하지 않습니다.
- POST `op: draft`: itemId/revision/title/body/reviewed/latestInformationVerified/checkedSourceUrls. 새로 생성된 자동 기획에만 원고를 저장하며 기존 직접 글과 예약·게시 원고는 변경하지 않습니다. 출처·자료가 바뀌면 거절합니다.
- POST `?op=asset`: multipart file/itemId/name/rights/sourceUrl/licenseUrl/permissionText/attribution/caption. 실제 JPG·PNG·WebP 파일(8MB 이하), 파일 서명과 권한 근거를 확인합니다. R2에 보관하고 콘텐츠 해시로 중복 첨부를 막습니다. 출처·크레딧은 발행 준비의 사진 설명에 포함합니다.
- POST `op: prepare`: itemId/requestId. 검수 원고와 실제 사진·권한을 기존 발행 검수 경로에 연결합니다. 첫 사진은 대표사진 위치에 두고 나머지는 제목을 제외한 본문 문단 사이에 고르게 배치합니다. 실제 업로드 경로를 확인하지 못한 사진은 준비 중으로 표시합니다.

## 확인 범위

2026-10-06 실행 `925923a7-974e-49a7-be13-3d72b3e47594`에서 네이버 글쓰기 로그인이 유지되고 사진의 로컬 파일 선택, 별도 MYBOX·라이브러리 메뉴를 확인했습니다. 직접 이미지 URL 삽입과 TinyFish의 실제 파일 업로드 기능은 확인되지 않았습니다. 메뉴 존재만으로 사진 업로드 완료를 기록하지 않으며 이미지가 있는 발행은 실제 업로드 경로 확인이 필요합니다. 사용자 기존 원고는 변경하지 않았습니다.

실제 예약·게시 결과는 기존 publishing-agent의 실행권·네이버 재조회 증거를 통해서만 기록합니다. 원고 제작 자체로 게시 상태·경험치를 변경하지 않습니다. 현재 이 제작 API는 주제를 스스로 조사하는 백그라운드 AI 서버나 새벽 발행 실행 서비스를 대체하지 않습니다.
