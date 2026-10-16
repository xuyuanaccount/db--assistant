#!/bin/zsh -l
set -e
cd -- "${0:A:h}"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  print '请先安装 Node.js 24 或更新版本（包含 npm），然后重新启动。'
  read '?按回车关闭…'
  exit 1
fi
if ! node --input-type=module -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 24 ? 0 : 1)'; then
  print '当前 Node.js 版本过低，请升级到 24 或更新版本。'
  read '?按回车关闭…'
  exit 1
fi
if [[ ! -d node_modules ]]; then
  npm ci
fi
npm run build
print '\n浏览器打开 http://127.0.0.1:3210/ ，按 Control+C 停止。'
exec npm start
