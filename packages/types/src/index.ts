export type ID = string;

export type OrderStatus =
  | "pending"
  | "awaiting_payment"
  | "payment_submitted"
  | "payment_verified"
  | "fulfilled"
  | "cancelled";

export type PaymentVerificationStatus =
  | "not_submitted"
  | "pending_review"
  | "verified"
  | "rejected";

export type ConversationChannel =
  | "telegram"
  | "tiktok"
  | "dashboard";

export interface Merchant {
  id: ID;
  name: string;
  phone?: string;
  isActive: boolean;
  createdAt: string;
}

export interface Product {
  id: ID;
  merchantId: ID;
  name: string;
  description?: string;
  priceInCents: number;
  currency: "ETB";
  isActive: boolean;
  createdAt: string;
}

export interface Customer {
  id: ID;
  merchantId: ID;
  displayName?: string;
  phone?: string;
  createdAt: string;
}

export interface Conversation {
  id: ID;
  merchantId: ID;
  customerId: ID;
  channel: ConversationChannel;
  externalId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Order {
  id: ID;
  merchantId: ID;
  customerId: ID;
  status: OrderStatus;
  totalInCents: number;
  currency: "ETB";
  createdAt: string;
  updatedAt: string;
}

export interface OrderItem {
  id: ID;
  orderId: ID;
  productId: ID;
  quantity: number;
  unitPriceInCents: number;
}

export interface PaymentVerification {
  id: ID;
  orderId: ID;
  status: PaymentVerificationStatus;
  provider: "telebirr" | "cbe_birr";
  reference?: string;
  submittedAt?: string;
  verifiedAt?: string;
  rejectionReason?: string;
}