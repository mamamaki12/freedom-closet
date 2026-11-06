#!/usr/bin/env sh
# ブーツの 3D データ（Sketchfab の「Photoscanned Female Ankle Boots」、作者 TunnelVisionStudio、CC BY 4.0。
# https://sketchfab.com/3d-models/photoscanned-female-ankle-boots-81ff219398e348b79497b0ccd98316b9 ）を取ってくる。
# Sketchfab から落とすにはログインがいるので、同じデータ（glTF の中に作者とライセンスが書いてある）を置いている
# GitHub の公開リポジトリから取り、中身が同じかを確かめる。取ってきたものは tools/body/.cache/boot に置く（git には入れない）。
set -eu
dir="$(cd "$(dirname "$0")" && pwd)/.cache/boot"
base="https://raw.githubusercontent.com/allbreaker68/TestArWebPage.github.io/HEAD/Assets/photoscanned_female_ankle_boots"
mkdir -p "$dir/textures"
for f in scene.gltf scene.bin textures/blinn1SG_baseColor.png textures/blinn1SG_metallicRoughness.png textures/blinn1SG_normal.png; do
  [ -s "$dir/$f" ] || curl -fsSL -o "$dir/$f" "$base/$f"
done
if command -v sha256sum >/dev/null 2>&1; then sum="sha256sum"; else sum="shasum -a 256"; fi
cd "$dir"
$sum -c - <<'EOF'
215fb3f0a1803b17bff17929b816dd20f8433156c5b69036c768083a0547fa41  scene.gltf
2b1668051e2f7cc16ba7c52769d44c806347f59104d322570c1271c0044a6802  scene.bin
f4cd9bdfa188d2e1cdaa529848b2a729aa211bce50ee4d51c0ebfe3bffc9294c  textures/blinn1SG_baseColor.png
8299b4da331da04756d353e6ad26ba0bade816c6b341db5e4ad731b9fe27780f  textures/blinn1SG_metallicRoughness.png
3b26d5eb81de9e977eccab08416eea26c427c83ce4dbfc15fe9c60165d6f87ad  textures/blinn1SG_normal.png
EOF
echo "ok: $dir"
