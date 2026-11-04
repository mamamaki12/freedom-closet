# Amazon BodyM（実在の人の正面・横向きのシルエットと実測値）を取ってくる。1人につき写真1組。
# データの使用条件は BodyM のページ（AWS Open Data）を確認すること。リポジトリには入れない。
# 使い方: python3 tools/body-eval/fetch_bodym.py <out_dir> <train|testA|testB>
import concurrent.futures as cf
import csv
import os
import sys
import urllib.request

out, split = sys.argv[1], sys.argv[2]
base = f"https://amazon-bodym.s3.amazonaws.com/{split}"
os.makedirs(f"{out}/{split}/mask", exist_ok=True)
os.makedirs(f"{out}/{split}/mask_left", exist_ok=True)
for name in ("hwg_metadata.csv", "measurements.csv", "subject_to_photo_map.csv"):
    urllib.request.urlretrieve(f"{base}/{name}", f"{out}/{split}/{name}")
first = {}
for r in csv.DictReader(open(f"{out}/{split}/subject_to_photo_map.csv")):
    first.setdefault(r["subject_id"], r["photo_id"])
jobs = [(f"{base}/{v}/{p}.png", f"{out}/{split}/{v}/{p}.png") for p in first.values() for v in ("mask", "mask_left")]


def get(job):
    url, path = job
    if not os.path.exists(path):
        urllib.request.urlretrieve(url, path)


with cf.ThreadPoolExecutor(16) as ex:
    list(ex.map(get, jobs))
print(split, len(first), "subjects")
