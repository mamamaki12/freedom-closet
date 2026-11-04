#!/usr/bin/env sh
# MakeHuman の素体データ（CC0）のうち、必要な分だけを GitHub から取ってくる。
# 取ってきたものは tools/body/.cache/makehuman に置く（git には入れない）。
set -eu
dir="$(cd "$(dirname "$0")" && pwd)/.cache/makehuman"
if [ ! -d "$dir/.git" ]; then
  git clone --depth 1 --filter=blob:none --sparse https://github.com/makehumancommunity/makehuman.git "$dir"
fi
cd "$dir"
git sparse-checkout set makehuman/data/3dobjs makehuman/data/targets/macrodetails makehuman/data/rigs LICENSE.ASSETS.md
echo "ok: $dir"
