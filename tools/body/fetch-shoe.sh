#!/usr/bin/env sh
# 靴の 3D データ（Khronos glTF-Sample-Assets の「Materials Variants Shoe」、© 2021 Shopify、CC BY 4.0）を
# GitHub から取ってくる。取ってきたものは tools/body/.cache/shoe に置く（git には入れない）。
set -eu
dir="$(cd "$(dirname "$0")" && pwd)/.cache/shoe"
if [ ! -d "$dir/.git" ]; then
  git clone --depth 1 --filter=blob:none --sparse https://github.com/KhronosGroup/glTF-Sample-Assets.git "$dir"
fi
cd "$dir"
git sparse-checkout set --no-cone /Models/MaterialsVariantsShoe/glTF/ /Models/MaterialsVariantsShoe/LICENSE.md
echo "ok: $dir"
