# BodyM のシルエットを「暗い人＋明るい背景」の写真にして MediaPipe Pose（アプリと同じ pose_landmarker_full）に読ませ、
# 骨格の点と人の切り抜きをキャッシュする。アプリと同じく、まわりに 10% の余白を足す。
# 準備: pip install mediapipe numpy pillow（Linux では libegl1 も必要）
# 使い方: python3 tools/body-eval/mediapipe_cache.py <bodym_dir> <split> <pose_landmarker_full.task> <cache_dir>
import csv, gzip, json, os, sys
import numpy as np
from PIL import Image
import mediapipe as mp
from mediapipe.tasks import python as mpp
from mediapipe.tasks.python import vision

data_dir, split, model, out_dir = sys.argv[1:5]
per = int(sys.argv[5]) if len(sys.argv) > 5 else 1
MARGIN = 0.1
os.makedirs(out_dir, exist_ok=True)

opts = vision.PoseLandmarkerOptions(
    base_options=mpp.BaseOptions(model_asset_path=model),
    running_mode=vision.RunningMode.IMAGE,
    num_poses=1,
    output_segmentation_masks=True,
)
det = vision.PoseLandmarker.create_from_options(opts)

rows = list(csv.DictReader(open(f"{data_dir}/{split}/subject_to_photo_map.csv")))
by = {}
for r in rows:
    by.setdefault(r["subject_id"], []).append(r["photo_id"])

PERSON = np.array([95, 72, 60], np.uint8)
BG = np.array([236, 234, 230], np.uint8)


def run(path):
    gt = np.array(Image.open(path).convert("L")) > 127
    h, w = gt.shape
    mx, my = round(w * MARGIN), round(h * MARGIN)
    pad = np.zeros((h + 2 * my, w + 2 * mx), bool)
    pad[my : my + h, mx : mx + w] = gt
    rgb = np.where(pad[..., None], PERSON, BG).astype(np.uint8)
    res = det.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(rgb)))
    if not res.pose_landmarks:
        return None, pad
    lm = [dict(x=p.x, y=p.y, z=p.z, visibility=p.visibility, presence=p.presence) for p in res.pose_landmarks[0]]
    m = res.segmentation_masks[0].numpy_view()
    m = np.squeeze(m)
    return (lm, (np.clip(m, 0, 1) * 255).round().astype(np.uint8)), pad


n = ok = 0
for sid, photos in by.items():
    for pid in photos[:per]:
        rec = {"split": split, "subject": sid, "photo": pid, "margin": MARGIN}
        for view, sub in (("front", "mask"), ("side", "mask_left")):
            path = f"{data_dir}/{split}/{sub}/{pid}.png"
            if not os.path.exists(path):
                continue
            r, pad = run(path)
            H, W = pad.shape
            base = f"{out_dir}/{pid}_{view}"
            with gzip.open(base + ".gt.gz", "wb") as f:
                f.write(pad.astype(np.uint8).tobytes())
            if r is None:
                rec[view] = {"width": W, "height": H, "landmarks": None}
                continue
            lm, m = r
            with gzip.open(base + ".mp.gz", "wb") as f:
                f.write(m.tobytes())
            rec[view] = {"width": W, "height": H, "landmarks": lm}
        json.dump(rec, open(f"{out_dir}/{pid}.json", "w"))
        n += 1
        ok += bool(rec.get("front", {}).get("landmarks"))
        if n % 50 == 0:
            print(n, ok, flush=True)
print("done", split, n, "pairs", ok, "front detected")
