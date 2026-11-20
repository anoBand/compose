# Compose — 코드 악보 편집기

악보 화면을 직접 눌러서 편집하는 코드 악보 웹앱입니다. 빌드 없이 정적 파일만으로 동작합니다.

## 사용법
- **악보에서 마디의 박 자리를 바로 누르면** 그 박이 선택되고 아래에 입력 패널이 열립니다(예: 1마디 3박 = 1마디의 오른쪽 절반 앞쪽).
  - 선택한 박은 악보에 파란 표시로 보이고, 마우스를 올리면 그 박 자리가 옅게 표시됩니다. 휴대폰에서는 패널의 박 버튼(1~4)으로도 고를 수 있습니다(넓은 화면에서는 숨김).
  - 코드는 다음 코드가 나올 때까지 유지됩니다. 근음 줄 맨 앞의 **·** 버튼(Delete 키)은 선택한 박을 비워서 앞 코드가 이어지게 합니다.
  - 다이어토닉 줄(I ii iii …)을 누르면 현재 키의 코드가 한 번에 들어갑니다. 줄 맨 앞 버튼으로 3화음 ↔ 7화음(Imaj7 ii7 …)을 바꾼다(브라우저에 기억, 따라 하기에서는 3화음).
  - 근음 → ♯/♭ → 종류(m, 7, maj7 …) 순서로 조합하고, ／ 다음에 근음을 누르면 슬래시 베이스가 됩니다.
  - 아래 패널은 코드 입력만: 다이어토닉 줄, 근음(·, ♯/♭, ／), 코드 종류(m, 7, m7, maj7, sus4, sus2, add9, 2, 6, 9, dim, dim7, m7♭5, aug, 7sus4, m9, maj9, m(add9), 13, 7♭9. 메이저로 되돌리려면 근음을 다시 누름)
  - 텍스트 가져오기에서는 `C6/9`, `C°7`, `C△7`, `C(omit3)`, `Cno3` 같은 표기도 읽는다
  - **마디·구간 도구는 위쪽 보기 줄**(조옮김 옆)에 마디를 골랐을 때만 나옵니다. 보기 줄은 스크롤해도 위에 붙어 있습니다.
    - 마디: 추가, 복제, 삭제, % 반복, 줄바꿈, 반복 시작/끝(누를 때마다 ×2 → ×3 → ×4 → 해제), 겹세로줄, 박자 변경
    - 구간: 추가, 이름 바꾸기, 삭제
- **곡 정보는 악보 머리말에서 바로**: 제목·키·박자·템포를 눌러 고친다. (아티스트 칸은 뺐다. 예전 악보의 `meta.artist`는 데이터에 남고 목록 검색에만 쓰인다)
- **메모**: 머리말 아래 곡 메모(상자로 강조), 구간 이름 오른쪽 구간 메모(구간 이름 상자나 그 오른쪽 여백을 누르거나, 마디를 고른 뒤 보기 줄의 "구간 메모"). 여러 줄 가능, Esc로 빠져나옴. PDF·JPG·인쇄에도 나온다.
  텍스트 가져오기에서는 `note: …`(곡 메모), 구간 안의 `> …`(구간 메모, 구간 앞이면 곡 메모).
- **조옮김**: 원본은 그대로 두고 보기만 옮깁니다. `C Key +2 › D Key`로 표시하고, 바뀐 코드는 파란색입니다. 조옮김 보기 중에는 편집이 잠깁니다.
- **실행 취소/다시 실행**, 가져오기(JSON 또는 텍스트 악보 붙여넣기)
- **사용법 따라 하기**(`#/tutorial`): 예시 곡으로 실제 편집기를 눌러 보며 16단계로 배운다(박 선택 → 코드 바꾸기 → 다른 박 → 다이어토닉 → 코드 종류 → 다음 마디 → · 로 비우기 → % 반복 → 실행 취소 → 마디 추가 → 조옮김 → 머리말에서 곡 정보 고치기 → 내보내기).
  - **처음 온 사람은 자동으로 시작**: 게스트는 이 브라우저에서 처음 편집기를 열 때, 로그인 사용자는 계정으로 처음 로그인했을 때. "나중에 하기"·✕로 건너뛸 수 있다.
  - 끝내거나 건너뛰면 본 것으로 기록한다: 브라우저(`localStorage` `compose:tutorial-done:v1`) + 로그인했으면 계정(`profile.json`의 `tutorialDoneAt`, `POST /api/me/tutorial`).
    게스트로 이미 본 브라우저에서 처음 로그인하면 다시 띄우지 않고 계정에만 기록한다.
  - 다시 보기: 편집기의 `?` 버튼, 홈의 "사용법", 로그인 화면의 링크. 튜토리얼의 악보는 저장하지 않고, 끝나면 원래 화면으로 돌아간다.
- **내보내기**: PDF(A4, 줄 중간에서 쪽을 나누지 않음, 쪽 번호), JPG(한 장), JSON(원본), 인쇄. PDF·JPG는 지금 보이는 키(조옮김) 그대로 만든다.
- **Google 로그인**(서버가 있을 때): 로그인하면 홈에 "내 악보" 목록(검색, 복제, 삭제)이 보이고, 악보는 서버에 자동 저장된다.
  다른 기기에서 같은 악보를 먼저 고쳤으면 덮어쓸지 물어본다. 로그인 없이 쓰면 이 브라우저에만 저장되고,
  나중에 로그인하면 그 악보를 계정으로 옮길 수 있다. 서버가 없는 곳(정적 호스팅)에서는 예전처럼 바로 편집기가 열린다.

### 데스크톱 단축키
| 키 | 동작 |
| --- | --- |
| ← → | 이전/다음 마디 |
| Space, Tab | 다음 박 (마지막 박이면 다음 마디) |
| A–G | 근음 입력 |
| `#` / `-` | ♯ / ♭ |
| `m`, `7` | 마이너, 7 추가 |
| `/` 후 A–G | 슬래시 베이스 |
| Delete | 선택한 박의 코드 지우기 |
| Enter | 뒤에 마디 추가 |
| Ctrl+Z / Ctrl+Shift+Z | 실행 취소 / 다시 실행 |
| Esc | 패널 닫기 |

## 저장 형식 (JSON)
```json
{
  "version": 1,
  "meta": { "title": "", "artist": "", "key": "C", "time": { "beats": 4, "unit": 4 }, "tempo": 92 },
  "sections": [{ "name": "Verse", "measures": [{
    "chords": [{ "beat": 0, "text": "C" }, { "beat": 2, "text": "G/B" }],
    "simile": false, "repeatStart": false, "repeatEnd": false, "repeatCount": 2,
    "doubleBar": false, "time": null, "lineBreak": false
  }] }]
}
```

## 구조
```
src/core/music.js        음이름·키·코드 파싱, 도수 기반 조옮김, 다이어토닉 (DOM 없음)
src/core/doc.js          JSON 문서 ↔ 렌더 모델 변환
src/core/parser.js       텍스트 악보 → 모델 (가져오기 전용)
src/render/chordChart.js 모델 → HTML
src/app.js               편집 UI, 실행 취소, 화면 전환(#/ 홈, #/c/<id> 서버 악보, #/local), 로그인, 자동 저장
src/api.js               /api 호출
src/export.js            PDF/JPG: 캔버스에 직접 그림 (jsPDF는 src/vendor/, 내보낼 때만 불러옴)
src/tutorial.js          따라 하기: 단계 정의(조건을 채우면 다음 단계), 강조 테두리·안내 카드
server/index.js          API 서버 (Node 22+, 외부 의존성 없음): 로그인, 악보 CRUD
server/auth.js           Google ID 토큰 검증(Google 공개키로 서명 확인), 세션 쿠키(HMAC)
server/store.js          사용자별 JSON 파일 저장 (지운 악보는 .trash/ 로)
deploy/update.sh         서버 자동 배포 스크립트
```

## 개발
```bash
python3 -m http.server 8080   # ES 모듈이라 file:// 로는 안 열림
npm test                      # 단위·API 테스트 (Node 22+)
# E2E: node test/e2e/run.mjs (전체), node test/e2e/tutorial.mjs (따라 하기 15단계, 데스크톱·모바일·다크)
# API까지 띄우려면 (로그인 없이 저장 API만 확인할 때는 GOOGLE_CLIENT_ID 생략)
SESSION_SECRET=$(openssl rand -hex 32) COOKIE_SECURE=0 node server/index.js
```

## 서버 배포
웹 루트에는 `index.html`과 `src/`만 내보내고, `/api/`는 API 서버로 넘긴다. 나머지(`.git`, `server/`, `test/` …)는 막는다.

### 1. Google OAuth 클라이언트 ID
Google Cloud Console → API 및 서비스 → OAuth 동의 화면(외부, 범위는 기본 email·profile·openid)을 만든 뒤
사용자 인증 정보 → OAuth 클라이언트 ID → 웹 애플리케이션:
- 승인된 JavaScript 원본: `https://<도메인>` (리디렉션 URI는 필요 없음)

클라이언트 ID만 쓴다(비밀번호는 필요 없음). 동의 화면이 "테스트" 상태면 테스트 사용자로 등록한 계정만 로그인된다.

### 2. API 환경 변수 (`compose-api.env`, 권한 600)
```
GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com
SESSION_SECRET=<openssl rand -hex 32 결과>
ALLOWED_EMAILS=me@gmail.com            # 비우면 모든 Google 계정 허용
MAX_CHARTS_PER_USER=200                # 사용자당 악보 수 (기본 200)
```

### 3. docker compose 예시
```yaml
  compose:          # 정적 파일 + /api 프록시
    image: nginx:alpine
    volumes:
      - ./compose:/usr/share/nginx/html:ro
      - ./compose.nginx.conf:/etc/nginx/conf.d/default.conf:ro
  compose-api:
    image: node:22-alpine
    user: "1000:1000"
    working_dir: /app
    command: ["node", "--watch", "server/index.js"]   # 배포로 파일이 바뀌면 자동 재시작
    env_file: ./compose-api.env
    environment: { DATA_DIR: /data }
    volumes:
      - ./compose:/app:ro
      - ./compose-data:/data
```
nginx에서는 `location /api/ { proxy_pass http://compose-api:3000; }` (resolver를 쓰면 API가 꺼져 있어도 nginx가 뜬다).
악보는 `compose-data/users/<Google sub>/charts/*.json`에 저장되니 이 폴더를 백업한다.

### 4. 자동 반영 (crontab)
```
*/10 * * * * REPO_DIR=$HOME/coding-proj/compose $HOME/coding-proj/compose-deploy.sh main >> ~/coding-proj/compose-deploy.log 2>&1
```
`deploy/update.sh`는 배포 폴더 밖에 복사해서 실행한다(체크아웃이 실행 중인 스크립트를 바꾸지 않게).
인자를 빼면 최신 `v*` 태그를 배포한다. 릴리스는 `git tag v0.2.0 && git push --tags`.
