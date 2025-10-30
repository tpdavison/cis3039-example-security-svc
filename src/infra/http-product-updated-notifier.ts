import type {
  ProductUpdatedNotifier,
  ProductUpdatedDto,
} from '../app/product-updated-notifier';

export type HttpProductUpdatedNotifierOptions = {
  baseUrl: string;
  fetch: typeof fetch;
};

export class HttpProductUpdatedNotifier implements ProductUpdatedNotifier {
  private baseUrl: string;
  private fetchFn: typeof fetch;

  constructor(options: HttpProductUpdatedNotifierOptions) {
    this.baseUrl = options.baseUrl;
    this.fetchFn = options.fetch;
  }

  async notifyProductUpdated(product: ProductUpdatedDto): Promise<void> {
    await this.fetchFn(`${this.baseUrl}/integration/events/product-updated`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(product),
    });
  }
}
