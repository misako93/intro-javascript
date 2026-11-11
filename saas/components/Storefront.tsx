"use client";

import { useApp } from "@/lib/client/state";
import { formatPrice } from "@/lib/export";
import { describeDiscount } from "@/lib/types";
import { AnnouncementPreview } from "./Deliverables";

/** A simplified view of the shop front, so approved changes can be seen at once. */
export function Storefront() {
  const { state } = useApp();
  const { store } = state;
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Aperçu du site</h1>
          <p className="muted">
            Ce que voient vos clients. Les prix, la barre d&apos;annonce et les fiches validées apparaissent ici dès que vous cliquez sur « Valider ».
          </p>
        </div>
      </header>

      <div className="browser">
        <div className="browser-bar">
          <span className="browser-dots"><i /><i /><i /></span>
          <span className="browser-url">{store.url.replace(/^https?:\/\//, "")}</span>
        </div>
        {store.announcement && <AnnouncementPreview bar={store.announcement} />}
        <div className="sf-header">
          <strong>{store.name}</strong>
          <span>Boutique · Notre histoire · Contact</span>
        </div>
        <div className="sf-hero">{store.tagline}</div>
        <div className="sf-grid">
          {store.products.map((p) => {
            const onSale = p.compareAtPrice && p.compareAtPrice > p.price;
            return (
              <div className="sf-card" key={p.id}>
                <div className="sf-thumb">
                  {p.emoji}
                  {onSale && <span className="sf-badge">-{Math.round((1 - p.price / p.compareAtPrice!) * 100)} %</span>}
                </div>
                <div className="sf-title">{p.title}</div>
                <div className="sf-price">
                  <strong>{formatPrice(p.price)}</strong>
                  {onSale && <s>{formatPrice(p.compareAtPrice!)}</s>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <h2 className="section-title">Codes promo actifs</h2>
      {store.discounts.length === 0 ? (
        <div className="empty">Aucun code promo pour l&apos;instant. Demandez-en un à l&apos;Agent Webmaster.</div>
      ) : (
        <div className="coupon-list">
          {store.discounts.map((d) => (
            <div className="coupon" key={d.id}>
              <span className="coupon-code">{d.code}</span>
              <span className="coupon-rule">{describeDiscount(d)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
