# 採寸の目安（cm）の推定式を、BodyM の train（2018人）で合わせる。
# 入力は run.ts の出力（アプリの採寸コードで測った値）。testA は使わない（確かめるのは score.ts）。
# 使い方: python3 tools/body-eval/fit.py <train.jsonl> <testB.jsonl> > src/body/sizeModel.json
#   （testB は、画面に出す「平均のずれ」を測るためだけに使う。式は train だけで決める）
#
# 式は「身長・体重・体格指数・メンズ/レディース・写真で測った値」の一次式。
# 体重が分からないときは「身長・メンズ/レディース・写真」の式。横の写真がないときは、厚みを幅から見積もった値で合わせた式。
import json, math, sys

import numpy as np

KEYS = ["chest", "waist", "hip", "thigh", "calf", "shoulder"]
GT = {"chest": "chest", "waist": "waist", "hip": "hip", "thigh": "thigh", "calf": "calf", "shoulder": "shoulder-breadth"}
# 腕の太さ（3Dの体型に使う）。写真で測れた人は「写真＋身長（・体重）」の式、測れなかった人用に身長・体重だけの式
ARMS = {"upperArm": "bicep", "wrist": "wrist"}


def ellipse(w, d):
    a, b = w / 2, d / 2
    return math.pi * (3 * (a + b) - math.sqrt((3 * a + b) * (a + 3 * b)))


def photo(m, key, rho, side):
    """写真で測った値を、周の長さ（身長を1とした割合）にする"""
    if key in ("chest", "waist", "hip"):
        s = m[key]
        d = s.get("depth") if side and key != "hip" else None
        return ellipse(s["width"], d if d else s["width"] * rho[key])
    if key in ("thigh", "calf"):
        return math.pi * m[key]
    return m[key]  # shoulder


# どの式を使うか（src/body/sizes.ts の variant と同じ）。ヒップは横の写真の厚みを使わない（下ろした手が重なって厚く出やすく、
# train でも正面の幅だけのほうがよく当たった）。太もも・ふくらはぎ・肩は横の写真を使わないので1つだけ
def variant(m, key):
    if key in ("chest", "waist"):
        return f"{key}.{'side' if m[key].get('depth') else 'front'}"
    if key == "hip":
        return "hip.front"
    return f"{key}.side"


def load(path):
    rows = [json.loads(l) for l in open(path)]
    return [r for r in rows if "scan" in r and r["scan"].get("marks")]


def cols(rows):
    h = np.array([r["profile"]["heightCm"] for r in rows])
    w = np.array([r["profile"]["weightKg"] for r in rows])
    bmi = w / (h / 100) ** 2
    fem = np.array([r["profile"]["fit"] == "womens" for r in rows], float)
    return h, w, bmi, fem


def main(train_path, test_path):
    rows = load(train_path)
    # 横の写真がないときの厚み/幅の比（中央値）
    rho = {}
    for key in ("chest", "waist", "hip"):
        v = [r["scan"]["marks"][key]["depth"] / r["scan"]["marks"][key]["width"] for r in rows if r["scan"]["marks"][key].get("depth")]
        rho[key] = round(float(np.median(v)), 4)
    h, w, bmi, fem = cols(rows)
    out = {"source": "BodyM train (tools/body-eval/fit.py)", "n": len(rows), "rho": rho, "models": {}, "error": {}}

    def lsq(X, y):
        A = np.c_[X, np.ones(len(y))]
        c = np.linalg.lstsq(A, y, rcond=None)[0]
        return [float(f"{v:.5g}") for v in c]

    for key in KEYS:
        y = np.array([r["gt"][GT[key]] for r in rows])
        for tag in (("side", "front") if key in ("chest", "waist") else ("front",) if key == "hip" else ("side",)):
            side = tag == "side"
            # 横の写真ありの式は、横の写真で厚みが測れた人だけで合わせる
            m = np.array([(not side) or key not in ("chest", "waist") or bool(r["scan"]["marks"][key].get("depth")) for r in rows])
            x = np.array([photo(r["scan"]["marks"], key, rho, side) for r in rows]) * h
            out["models"][f"{key}.{tag}"] = {"hw": lsq(np.c_[h, w, bmi, fem, x][m], y[m]), "h": lsq(np.c_[h, fem, x][m], y[m])}
    for key, gt in ARMS.items():
        y = np.array([r["gt"][gt] for r in rows])
        out["models"][key] = {"hw": lsq(np.c_[h, w, bmi, fem], y)}
        m = np.array([bool(r["scan"]["marks"].get(key)) for r in rows])
        x = np.array([math.pi * (r["scan"]["marks"].get(key) or 0) for r in rows]) * h
        out["models"][f"{key}.photo"] = {"hw": lsq(np.c_[h, w, bmi, fem, x][m], y[m]), "h": lsq(np.c_[h, fem, x][m], y[m])}

    # 画面に出す「平均のずれ」は、合わせるのに使っていない testB で測る
    test = load(test_path)
    th, tw, tbmi, tfem = cols(test)
    for key in KEYS:
        errs = [[], []]
        for i, r in enumerate(test):
            mk = r["scan"]["marks"]
            v = variant(mk, key)
            c = out["models"][v]
            x = photo(mk, key, rho, v.endswith(".side")) * th[i]
            a = np.dot(c["hw"][:-1], [th[i], tw[i], tbmi[i], tfem[i], x]) + c["hw"][-1]
            b = np.dot(c["h"][:-1], [th[i], tfem[i], x]) + c["h"][-1]
            g = r["gt"][GT[key]]
            errs[0].append(abs(a - g))
            errs[1].append(abs(b - g))
        out["error"][key] = [round(float(np.mean(errs[0])), 1), round(float(np.mean(errs[1])), 1)]
    json.dump(out, sys.stdout, indent=1)
    print()


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
