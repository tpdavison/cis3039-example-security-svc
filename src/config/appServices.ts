import { ListProductsDeps } from '../app/list-products';
import { UpsertProductDeps } from '../app/upsert-product';
import { ProductRepo } from '../domain/product-repo';
import { FakeProductRepo } from '../infra/fake-product-repo';
import { DummyProductUpdatedNotifier } from '../infra/dummy-product-updated-notifier';
import { HttpProductUpdatedNotifier } from '../infra/http-product-updated-notifier';
import { ProductUpdatedNotifier } from '../app/product-updated-notifier';

let cachedProductUpdatedNotifier: ProductUpdatedNotifier | null = null;

export const getProductUpdatedNotifier = (): ProductUpdatedNotifier => {
  if (!cachedProductUpdatedNotifier) {
    const baseUrl = process.env.PRODUCT_UPDATED_BASE_URL;
    if (baseUrl && baseUrl.trim() !== '') {
      cachedProductUpdatedNotifier = new HttpProductUpdatedNotifier({
        baseUrl,
        fetch: (globalThis as any).fetch,
      });
    } else {
      cachedProductUpdatedNotifier = new DummyProductUpdatedNotifier();
    }
  }
  return cachedProductUpdatedNotifier;
};

let cachedProductRepo: ProductRepo | null = null;

export const getProductRepo = (): ProductRepo => {
  if (!cachedProductRepo) {
    cachedProductRepo = new FakeProductRepo();
  }
  return cachedProductRepo;
};

export const makeListProductsDeps = (): ListProductsDeps => ({
  productRepo: getProductRepo(),
});

export const makeUpsertProductDeps = (): UpsertProductDeps => ({
  productRepo: getProductRepo(),
  now: () => new Date(),
  productUpdatedNotifier: getProductUpdatedNotifier(),
});
