import type { StoreChange, StoreState } from "./types";

/** Applies an approved proposal to the shop and returns the new shop state. */
export function applyChange(store: StoreState, change: StoreChange): StoreState {
  switch (change.type) {
    case "product_update":
      return {
        ...store,
        products: store.products.map((p) => {
          if (p.id !== change.productId) return p;
          const next = { ...p, updatedByAi: true };
          for (const c of change.changes) {
            if (c.field === "tags") next.tags = c.after.split(",").map((t) => t.trim()).filter(Boolean);
            else next[c.field] = c.after;
          }
          return next;
        }),
      };
    case "price_update":
      return {
        ...store,
        products: store.products.map((p) => {
          const c = change.changes.find((x) => x.productId === p.id);
          return c ? { ...p, price: c.after, compareAtPrice: c.compareAtAfter, updatedByAi: true } : p;
        }),
      };
    case "discount":
      return {
        ...store,
        discounts: [
          ...store.discounts.filter((d) => d.code !== change.discount.code),
          { id: change.id, ...change.discount },
        ],
      };
    case "announcement":
      return { ...store, announcement: change.bar };
  }
}
