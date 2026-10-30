// コーデ1案の「着たときのイメージ」（3Dのマネキンと手持ちの服）と、ネット上の似た着こなし写真。
import { ExternalLink } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import type { LookPhotosResult } from "../ai/schemas";
import { Figure3D } from "../body/Figure3D";
import type { BodyScan } from "../body/types";
import type { Profile } from "../domain/profile";
import type { Garment } from "../domain/types";
import { lookPhotoFinder } from "../shop/lookPhotos";
import { referenceLinks } from "../shop/reference";

export function OutfitLook({
  items,
  profile,
  bodyScan,
  children,
}: {
  items: Garment[];
  profile: Profile;
  bodyScan?: BodyScan;
  children: ReactNode;
}) {
  return (
    <div className="look-row">
      <figure className="look-figure">
        <Figure3D items={items} profile={profile} scan={bodyScan} />
        <figcaption>着たときのイメージ</figcaption>
      </figure>
      <div className="grid look-items">{children}</div>
    </div>
  );
}

/** ネット上の似た着こなし写真。写真検索が使えないときは検索リンクだけ */
export function LookPhotos({ items, profile }: { items: Garment[]; profile: Profile }) {
  const [found, setFound] = useState<LookPhotosResult | null>();
  const key = items.map((g) => `${g.category}:${g.color}:${g.subType}`).join("|") + (profile.fit ?? "");

  useEffect(() => {
    let alive = true;
    setFound(undefined);
    void lookPhotoFinder.find(items, profile.fit).then((r) => alive && setFound(r));
    return () => {
      alive = false;
    };
    // 服の種類・色・体型が変わったときだけ探し直す
  }, [key]);

  const photos = found?.photos ?? [];
  return (
    <>
      {photos.length > 0 && found && (
        <div className="look-photos">
          <p className="hint">ネット上の似た着こなし</p>
          <div className="photo-strip">
            {photos.map((p) => (
              <a key={p.id} href={p.pageUrl} target="_blank" rel="noopener noreferrer" title={`${p.alt}（撮影：${p.photographer}）`}>
                <img src={p.image} alt={p.alt} loading="lazy" />
              </a>
            ))}
          </div>
          <p className="credit">
            写真：
            <a href={found.source.url} target="_blank" rel="noopener noreferrer">
              {found.source.name}
            </a>
            （{[...new Set(photos.map((p) => p.photographer))].slice(0, 3).join("、")}
            {photos.length > 3 ? " ほか" : ""}）
          </p>
        </div>
      )}

      <p className="hint refs">
        {photos.length > 0 ? "もっと見る：" : "似た着こなしを探す："}
        {referenceLinks(items).map((l) => (
          <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer">
            {l.label}
            <ExternalLink size={13} aria-hidden />
          </a>
        ))}
      </p>
    </>
  );
}
