import { Product } from '../domain/product';
import { ProductRepo } from '../domain/product-repo';

/**
 * Fake in-memory implementation of ProductRepo for tests and local dev.
 * Not safe for concurrency across processes — intended as a fake.
 */
export class FakeProductRepo implements ProductRepo {
  private store: Map<string, Product> = new Map();

  constructor(initial: Product[] = []) {
    for (const p of initial) this.store.set(p.id, { ...p });
  }

  async getById(id: string): Promise<Product | null> {
    const found = this.store.get(id) ?? null;
    // return a shallow clone to avoid accidental external mutation
    return found ? { ...found } : null;
  }

  async list(): Promise<Product[]> {
    return Array.from(this.store.values()).map((p) => ({ ...p }));
  }

  async save(product: Product): Promise<Product> {
    // upsert semantics: store the product, return the saved copy
    const toStore = { ...product } as Product;
    this.store.set(toStore.id, toStore);
    return { ...toStore };
  }

  async delete(id: string): Promise<void> {
    this.store.delete(id);
  }
}
