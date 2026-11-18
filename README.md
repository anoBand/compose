# Compose — 코드 악보 편집기

악보 화면을 직접 눌러서 편집하는 코드 악보 웹앱입니다. 빌드 없이 정적 파일만으로 동작합니다.

## 사용법
- **마디를 누르면** 아래에 입력 패널이 열립니다.
  - 박 버튼(1~4)으로 코드를 넣을 박을 고르고, 코드는 다음 코드가 나올 때까지 유지됩니다.
  - 다이어토닉 줄(I ii iii …)을 누르면 현재 키의 코드가 한 번에 들어갑니다.
  - 근음 → ♯/♭ → 종류(m, 7, maj7 …) 순서로 조합하고, ／ 다음에 근음을 누르면 슬래시 베이스가 됩니다.
  - 마디 도구: 추가, 복제, 삭제, % 반복, 줄바꿈, 반복 시작/끝(누를 때마다 ×2 → ×3 → ×4 → 해제), 겹세로줄, 박자 변경
  - 구간: 추가, 이름 바꾸기, 삭제
- **조옮김**: 원본은 그대로 두고 보기만 옮깁니다. `C Key +2 › D Key`로 표시하고, 바뀐 코드는 파란색입니다. 조옮김 보기 중에는 편집이 잠깁니다.
- **실행 취소/다시 실행**, 가져오기(JSON 또는 텍스트 악보 붙여넣기)
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
server/index.js          API 서버 (Node 22+, 외부 의존성 없음): 로그인, 악보 CRUD
server/auth.js           Google ID 토큰 검증(Google 공개키로 서명 확인), 세션 쿠키(HMAC)
server/store.js          사용자별 JSON 파일 저장 (지운 악보는 .trash/ 로)
deploy/update.sh         서버 자동 배포 스크립트
```

## 개발
```bash
python3 -m http.server 8080   # ES 모듈이라 file:// 로는 안 열림
npm test                      # 단위·API 테스트 (Node 22+)
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
