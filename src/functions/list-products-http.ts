import { app, HttpRequest, HttpResponseInit } from '@azure/functions';
import { listProducts } from '../app/list-products';
import { makeListProductsDeps } from '../config/appServices';

const listProductsHandler = async (
  _request: HttpRequest
): Promise<HttpResponseInit> => {
  const deps = makeListProductsDeps();
  const result = await listProducts(deps);

  if (!result.success) {
    return {
      status: 500,
      jsonBody: {
        success: false,
        message: 'Failed to list products',
        error: result.error,
      },
    };
  }

  const products = result.data ?? [];
  return {
    status: 200,
    jsonBody: products.map((product) => ({
      ...product,
      updatedAt: product.updatedAt.toISOString(),
    })),
  };
};

app.http('listProductsHttp', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'products',
  handler: listProductsHandler,
});
