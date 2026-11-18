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
- **실행 취소/다시 실행**, 자동 저장(브라우저), **내보내기(JSON)**, 가져오기(JSON 또는 텍스트 악보 붙여넣기), 인쇄

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
src/app.js               편집 UI, 실행 취소, 저장
deploy/update.sh         서버 자동 배포 스크립트
```

## 개발
```bash
python3 -m http.server 8080   # ES 모듈이라 file:// 로는 안 열림
npm test                      # 단위 테스트 (Node 18+)
```

## 서버 배포
웹 루트에는 `index.html`과 `src/`만 있으면 됩니다.

```bash
git clone https://github.com/anoBand/compose.git /srv/compose
docker run -d --name compose --restart unless-stopped -p 8081:80 \
  -v /srv/compose:/usr/share/nginx/html:ro nginx:alpine
# 자동 반영 (crontab -e)
*/10 * * * * /srv/compose/deploy/update.sh >> ~/coding-proj/compose-deploy.log 2>&1        # 최신 v* 태그
*/10 * * * * REPO_DIR=/srv/compose-dev /srv/compose-dev/deploy/update.sh main >> ...       # 개발용: main
```
릴리스는 `git tag v0.2.0 && git push --tags`로 만듭니다.
