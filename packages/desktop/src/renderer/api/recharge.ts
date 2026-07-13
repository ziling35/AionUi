import { createApiClient } from './client';
import { getCloudApiBase } from './config';

export type RechargeProductType = 'balance' | 'subscription';
export type RechargePlanType = 'balance' | 'reset_window';
export type PaymentOrderStatus = 'PENDING' | 'PAID';

export type RechargeProduct = {
  id: string;
  name: string;
  description?: string | null;
  productType: RechargeProductType;
  priceCents: number;
  priceYuan: string;
  amount: number;
  planType: RechargePlanType;
  windowHours?: number | null;
  validDays?: number | null;
  badge?: string | null;
  sortOrder: number;
  enabled: boolean;
};

export type PaymentSummary = {
  enabled: boolean;
  provider: 'epay';
  allowedTypes: string[];
  siteName: string;
};

export type PaymentOrder = {
  id: string;
  orderNo: string;
  productId: string | null;
  product?: RechargeProduct | null;
  paymentProvider: 'epay';
  paymentType: string;
  amountCents: number;
  amountYuan: string;
  quotaAmount: number;
  planType: RechargePlanType;
  windowHours?: number | null;
  validDays?: number | null;
  status: PaymentOrderStatus;
  providerTradeNo?: string | null;
  paidAt?: string | null;
  createdAt: string;
};

export type RechargeProductsResponse = {
  success: boolean;
  products: RechargeProduct[];
  payment: PaymentSummary;
};

export type CreateRechargeOrderResponse = {
  success: boolean;
  order: PaymentOrder;
  paymentUrl: string;
};

export type PaymentOrderResponse = {
  success: boolean;
  order: PaymentOrder;
};

function client() {
  return createApiClient(getCloudApiBase());
}

function authHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
  };
}

export const rechargeApi = {
  listProducts: async (): Promise<RechargeProductsResponse> => {
    return client().get('/api/recharge/products');
  },

  createOrder: async (token: string, productId: string, paymentType: string): Promise<CreateRechargeOrderResponse> => {
    return client().post(
      '/api/recharge/orders',
      { productId, paymentType },
      {
        headers: authHeaders(token),
      }
    );
  },

  getOrder: async (token: string, orderNo: string): Promise<PaymentOrderResponse> => {
    return client().get(`/api/recharge/orders/${encodeURIComponent(orderNo)}`, {
      headers: authHeaders(token),
    });
  },
};
