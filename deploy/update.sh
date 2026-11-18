#!/usr/bin/env bash
# 서버에서 cron으로 실행: 최신 릴리스 태그(또는 지정 브랜치)를 웹 루트에 반영한다.
#   사용: deploy/update.sh [브랜치]   (브랜치를 주면 그 브랜치 최신 커밋, 없으면 최신 v* 태그)
#   예) */10 * * * * /srv/compose/deploy/update.sh >> ~/coding-proj/compose-deploy.log 2>&1
#   dev 서브도메인용 사본은 `update.sh main` 으로 돌리면 된다.
set -euo pipefail

REPO_DIR="${REPO_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
cd "$REPO_DIR"

git fetch --quiet --tags origin

if [[ $# -ge 1 ]]; then
  target="origin/$1"
else
  target="$(git tag --list 'v*' --sort=-v:refname | head -n1)"
  [[ -z "$target" ]] && { echo "$(date '+%F %T') 릴리스 태그 없음"; exit 0; }
fi

current="$(git rev-parse HEAD)"
wanted="$(git rev-parse "$target^{commit}")"
if [[ "$current" == "$wanted" ]]; then
  exit 0
fi

git checkout --quiet --detach "$wanted"
echo "$(date '+%F %T') 배포: $target ($(git rev-parse --short HEAD))"
