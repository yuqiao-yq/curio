#!/usr/bin/env bash
#
# 一键发布脚本：bump version → commit → tag → push → 给出 GitHub Release 链接
#
# 用法：
#   pnpm release v0.21.20                       # tag message 默认 = 版本号
#   pnpm release v0.21.20 -m "v0.21.20 - 修复xxx"   # 自定义 tag message
#   pnpm release v0.21.20 -F docs/release-notes.md  # 用文件做 tag message
#   pnpm release v0.21.20 --dry-run                 # 仅校验与预览，不实际写入
#   pnpm release --help                             # 帮助
#
# 行为顺序：
#   1) 校验：版本号格式 / 工作区干净 / tag 本地与远端均无冲突 / 当前分支
#   2) bump  package.json 的 version 字段（用 node 改 JSON 比 sed 稳）
#   3) pnpm build 验证构建产物，失败自动还原 package.json
#   4) git commit "chore(release): vX.Y.Z" + git tag -a vX.Y.Z
#   5) git push origin <branch> && git push origin <tag>
#   6) 输出 .output/chrome-mv3/ 产物与 GitHub Release 网页链接

set -euo pipefail

# ─── 颜色 ─────────────────────────────────────────
if [[ -t 1 ]]; then
  RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'
  CYAN=$'\033[36m'; BOLD=$'\033[1m'; NC=$'\033[0m'
else
  RED=''; GREEN=''; YELLOW=''; CYAN=''; BOLD=''; NC=''
fi
log()   { printf "%s▸%s %s\n"  "$CYAN"   "$NC" "$*"; }
ok()    { printf "%s✓%s %s\n"  "$GREEN"  "$NC" "$*"; }
warn()  { printf "%s!%s %s\n"  "$YELLOW" "$NC" "$*"; }
fatal() { printf "%s✗%s %s\n"  "$RED"    "$NC" "$*" >&2; exit 1; }

usage() {
  sed -n '3,18p' "$0" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

# ─── 参数解析 ─────────────────────────────────────
[[ $# -ge 1 ]] || usage 1
case "$1" in
  -h|--help) usage 0 ;;
esac

VERSION="$1"; shift
[[ "$VERSION" =~ ^v[0-9]+\.[0-9]+\.[0-9]+([.-][a-zA-Z0-9.]+)?$ ]] \
  || fatal "版本号格式错误，要 vX.Y.Z（例如 v0.21.20）"

DRY_RUN=0
TAG_MSG_ARGS=("-m" "$VERSION")
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    -m|-F)
      [[ $# -ge 2 ]] || fatal "$1 后面缺少参数"
      TAG_MSG_ARGS=("$1" "$2"); shift 2 ;;
    *) fatal "未识别参数：$1（支持 --dry-run / -m / -F）" ;;
  esac
done

# ─── 切换到项目根 ─────────────────────────────────
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" \
  || fatal "未在 git 仓库内"
cd "$REPO_ROOT"

# ─── 前置检查 ─────────────────────────────────────
log "检查工作区状态 ..."
if [[ -n "$(git status --porcelain)" ]]; then
  git --no-pager status --short
  fatal "工作区有未提交的改动，先 commit / stash 后再发布"
fi
ok "工作区干净"

log "检查 tag $VERSION 是否已存在 ..."
if git rev-parse "$VERSION" >/dev/null 2>&1; then
  fatal "本地已存在 tag $VERSION，请换个版本号或先 git tag -d $VERSION"
fi
if git ls-remote --tags origin "refs/tags/$VERSION" 2>/dev/null \
  | grep -q "refs/tags/$VERSION"; then
  fatal "远端已存在 tag $VERSION（git push origin --delete $VERSION 可删除）"
fi
ok "tag $VERSION 可用"

log "检查当前分支 ..."
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$BRANCH" != "main" && "$BRANCH" != "master" ]]; then
  warn "当前不在 main/master 分支（实际：$BRANCH），3 秒后继续，Ctrl+C 取消 ..."
  sleep 3
fi

# ─── 预览模式 ─────────────────────────────────────
if [[ $DRY_RUN -eq 1 ]]; then
  printf "\n%s%sDry Run 预览%s\n"  "$BOLD" "$CYAN" "$NC"
  printf "   分支          : %s\n" "$BRANCH"
  printf "   版本号        : %s （package.json: %s → %s）\n" \
    "$VERSION" "$(node -p "require('./package.json').version")" "${VERSION#v}"
  printf "   tag message   : %s\n" "${TAG_MSG_ARGS[*]}"
  printf "   预期执行 commit: chore(release): %s\n" "$VERSION"
  printf "   预期 push      : origin %s + origin %s\n\n" "$BRANCH" "$VERSION"
  ok "预览完成，未对仓库做任何修改"
  exit 0
fi

# ─── bump package.json version ────────────────────
PLAIN_VER="${VERSION#v}"
log "bump package.json version → $PLAIN_VER ..."
# 失败回滚：保存原始内容到临时文件，trap 在异常时还原
PKG_BACKUP="$(mktemp -t tabit-pkg-backup-XXXX)"
cp package.json "$PKG_BACKUP"
restore_pkg() {
  if [[ -f "$PKG_BACKUP" ]]; then
    mv "$PKG_BACKUP" package.json
    warn "已回滚 package.json"
  fi
}
trap restore_pkg ERR EXIT

# 用 node 改 JSON：保留缩进 / 尾换行 / 字段顺序
node -e '
  const fs = require("fs");
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
  pkg.version = process.argv[1];
  fs.writeFileSync("package.json", JSON.stringify(pkg, null, 2) + "\n");
' "$PLAIN_VER"
ok "package.json version = $PLAIN_VER"

# ─── pnpm build 验证 ──────────────────────────────
BUILD_LOG="$(mktemp -t tabit-build-log-XXXX)"
log "pnpm build 验证（日志：$BUILD_LOG）..."
if ! pnpm build >"$BUILD_LOG" 2>&1; then
  tail -30 "$BUILD_LOG"
  fatal "pnpm build 失败，已回滚 package.json，详细日志：$BUILD_LOG"
fi
ok "构建通过（产物在 .output/chrome-mv3/）"

# 走到这里 build 成功，清掉备份与 trap，避免后续步骤出错时把已 commit 的 version 也回滚
rm -f "$PKG_BACKUP"
trap - ERR EXIT

# ─── git commit + tag ─────────────────────────────
log "git commit ..."
git add package.json
git commit -m "chore(release): $VERSION" >/dev/null
ok "commit: chore(release): $VERSION"

log "git tag $VERSION ..."
git tag -a "$VERSION" "${TAG_MSG_ARGS[@]}"
ok "tag $VERSION 已创建（local）"

# ─── push ─────────────────────────────────────────
log "推送 branch + tag 到 origin ..."
git push origin "$BRANCH"
git push origin "$VERSION"
ok "已推送：$BRANCH + $VERSION"

# ─── 完成提示 ─────────────────────────────────────
REPO_URL=$(git remote get-url origin \
  | sed -E 's|^git@github.com:|https://github.com/|; s|\.git$||')

printf "\n%s%s🎉 Release %s 完成%s\n" "$BOLD" "$GREEN" "$VERSION" "$NC"
printf "   产物目录       : %s.output/chrome-mv3/%s\n" "$BOLD" "$NC"
printf "   GitHub Release : %s%s/releases/new?tag=%s%s\n\n" \
  "$BOLD" "$REPO_URL" "$VERSION" "$NC"
