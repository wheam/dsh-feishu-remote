#!/usr/bin/env bash
# dsh 版本兼容诊断（docs/12 第 1 节的可执行版）。
# 用途：任何插件安装/更新/升级操作之前、以及 Mac App 可能自动升级之后，
# 跑一遍，输出 GO / NO-GO 与原因。基准 = Mac App 实际使用的 dsh。
set -u

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PIN="$(node -p "require('${REPO_DIR}/package.json').peerDependencies['@deepseek-ai/dsh-agent']" 2>/dev/null || echo '?')"

echo "== dsh 可执行文件枚举 =="
PATH_DSH="$(command -v dsh 2>/dev/null || echo '(无)')"
printf 'PATH 上的 dsh        : %s' "${PATH_DSH}"
if [ "${PATH_DSH}" != "(无)" ]; then printf ' -> %s' "$("${PATH_DSH}" --version 2>/dev/null || echo '版本读取失败')"; fi
echo

for BIN in "${HOME}/.local/bin/dsh" "/opt/homebrew/bin/dsh"; do
  if [ -x "${BIN}" ]; then
    printf '%-21s: %s\n' "${BIN}" "$("${BIN}" --version 2>/dev/null || echo '版本读取失败')"
  else
    printf '%-21s: (不存在)\n' "${BIN}"
  fi
done

MACAPP="$(/opt/homebrew/bin/dsh --version 2>/dev/null || echo '')"
if [ -z "${MACAPP}" ] && [ -f /opt/homebrew/lib/node_modules/@deepseek-ai/dsh/package.json ]; then
  MACAPP="$(node -p "require('/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/package.json').version" 2>/dev/null || echo '')"
fi

echo
echo "== 兼容性判定（基准 = Mac App 实际使用的 dsh）=="
echo "插件 dsh-feishu-remote 锁定 : ${PIN}"
echo "Mac App 使用的 dsh          : ${MACAPP:-（无法读取）}"
echo

if [ -z "${MACAPP}" ]; then
  echo "NO-GO：无法读取 Mac App 的 dsh 版本，先手工确认后再操作。"
  exit 1
fi
if [ "${PIN}" != "${MACAPP}" ]; then
  echo "NO-GO：版本漂移。禁止安装/更新/启用插件；先按 docs/12 适配插件到 ${MACAPP}，或报告并停止。"
  echo "（注意 PATH 上的 dsh 可能与 Mac App 不一致，一切以 Mac App 为准。）"
  exit 2
fi
echo "GO：插件锁定版本与 Mac App 运行时一致。可继续操作；仍须完成 docs/12 第 5 节的端到端验收。"
exit 0
