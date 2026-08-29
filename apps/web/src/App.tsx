import {
  useEffect,
  useMemo,
  useState
} from "react";

type AuthUser = {
  id: string;
  merchantId: string;
  email: string;
  displayName: string | null;
  role: string;
};

type LoginResponse = {
  token: string;
  user: AuthUser;
};

type PaymentReview = {
  id: string;
  merchantId: string;
  orderId: string;
  provider: string;
  status: string;
  amount: string | number;
  currency: string;
  transactionReference: string | null;

  receiptUrl: string | null;

  receiptMetadata: {
    extracted?: {
      provider?: string | null;
      transactionReference?: string | null;
      amount?: number | null;
      currency?: string | null;
      transactionDate?: string | null;
      transactionTime?: string | null;
      senderName?: string | null;
      senderAccount?: string | null;
      confidence?: number;
    };

    validation?: {
      status?: string;
      amountMatches?: boolean;
      currencyMatches?: boolean;
      providerMatches?: boolean;
      referencePresent?: boolean;
      reasons?: string[];
    };

    processedAt?: string;
  } | null;

  reviewNote: string | null;
  createdAt: string;

  order: {
    orderNumber: string;
    status: string;
    total: string;
    customer: {
      name: string | null;
      phone: string | null;
      telegramChatId: string | null;
    } | null;
    items: {
      productName: string;
      quantity: number;
      unitPrice: string;
      lineTotal: string;
    }[];
  };
};

function formatPaymentProvider(provider: string): string {
  switch (provider) {
    case "TELEBIRR":
      return "Telebirr";

    case "CBE_BIRR":
      return "CBE Birr";

    case "OTHER":
      return "Other";

    default:
      return provider;
  }
}

type Order = {
  id: string;
  merchantId: string;
  customerId: string | null;
  orderNumber: string;
  status: string;
  currency: string;
  subtotal: string;
  total: string;
  createdAt: string;
  updatedAt: string;
  customer: {
    name: string | null;
    phone: string | null;
    telegramChatId: string | null;
  } | null;
  items: {
    id: string;
    productName: string;
    quantity: number;
    unitPrice: string;
    lineTotal: string;
  }[];
  payments: {
    id: string;
    provider: string;
    status: string;
    amount: string;
    currency: string;
    transactionReference: string | null;
  }[];
};

type ProductCategory = {
  id: string;
  merchantId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  _count?: { products: number };
};

type ProductImage = {
  id: string;
  productId: string;
  url: string;
  altText: string | null;
  sortOrder: number;
  isPrimary: boolean;
  createdAt: string;
  updatedAt: string;
};

type Product = {
  id: string;
  merchantId: string;
  categoryId: string | null;
  name: string;
  description: string | null;
  price: string | number;
  currency: string;
  stock: number;
  status: string;
  createdAt: string;
  updatedAt: string;
  category?: ProductCategory | null;
  images?: ProductImage[];
};

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ||
  "http://localhost:3000";

const MERCHANT_ID =
  import.meta.env.VITE_MERCHANT_ID ||
  "cmsrm4og20000q8578gy73r86";

const AUTH_STORAGE_KEY =
  "ethio-commerce-auth";

type Tab =
  | "payments"
  | "orders"
  | "inventory";

export default function App() {
  const [
    auth,
    setAuth
  ] = useState<LoginResponse | null>(
    () => {
      try {
        const stored =
          localStorage.getItem(
            AUTH_STORAGE_KEY
          );

        if (!stored) {
          return null;
        }

        return JSON.parse(
          stored
        ) as LoginResponse;
      } catch {
        localStorage.removeItem(
          AUTH_STORAGE_KEY
        );

        return null;
      }
    }
  );

  const [
    loginEmail,
    setLoginEmail
  ] = useState("");

  const [
    loginPassword,
    setLoginPassword
  ] = useState("");

  const [
    loginLoading,
    setLoginLoading
  ] = useState(false);

  const [
    activeTab,
    setActiveTab
  ] = useState<Tab>("payments");

  const [
    reviews,
    setReviews
  ] = useState<PaymentReview[]>(
    []
  );


  type ReviewSort =
    | "newest"
    | "oldest"
    | "amount-high"
    | "amount-low"
    | "provider-az"
    | "provider-za"
    | "customer-az"
    | "customer-za";

  const [
    reviewSort,
    setReviewSort
  ] = useState<ReviewSort>("newest");

  const [
    expandedPaymentIds,
    setExpandedPaymentIds
  ] = useState<Set<string>>(
    new Set()
  );

  function togglePaymentReview(reviewId: string) {
    setExpandedPaymentIds((current) => {
      const next = new Set(current);

      if (next.has(reviewId)) {
        next.delete(reviewId);
      } else {
        next.add(reviewId);
      }

      return next;
    });
  }

  const [
    orders,
    setOrders
  ] = useState<Order[]>([]);

  const [
    products,
    setProducts
  ] = useState<Product[]>([]);
  const [
    categories,
    setCategories
  ] = useState<ProductCategory[]>([]);

  const [
    loadingCategories,
    setLoadingCategories
  ] = useState(false);

  const [
    productFormOpen,
    setProductFormOpen
  ] = useState(false);

  const [
    editingProductId,
    setEditingProductId
  ] = useState<string | null>(null);

  const [
    productName,
    setProductName
  ] = useState("");

  const [
    productDescription,
    setProductDescription
  ] = useState("");

  const [
    productPrice,
    setProductPrice
  ] = useState("");

  const [
    productCurrency,
    setProductCurrency
  ] = useState("ETB");

  const [
    productStock,
    setProductStock
  ] = useState("0");

  const [
    productStatus,
    setProductStatus
  ] = useState("DRAFT");

  const [
    productCategoryId,
    setProductCategoryId
  ] = useState("");

  const [
    categoryName,
    setCategoryName
  ] = useState("");

  const [
    imageProductId,
    setImageProductId
  ] = useState<string | null>(null);

  const [
    imageUrl,
    setImageUrl
  ] = useState("");

  const [
    imageAltText,
    setImageAltText
  ] = useState("");



  const [
    loadingReviews,
    setLoadingReviews
  ] = useState(true);

  const [
    loadingOrders,
    setLoadingOrders
  ] = useState(true);

  const [
    loadingProducts,
    setLoadingProducts
  ] = useState(true);

  const [
    actionId,
    setActionId
  ] = useState<string | null>(
    null
  );

  const [
    error,
    setError
  ] = useState("");

  const [
    success,
    setSuccess
  ] = useState("");

  const [
    rejectingPaymentId,
    setRejectingPaymentId
  ] = useState<string | null>(
    null
  );

  const [
    rejectNote,
    setRejectNote
  ] = useState("");

  const [
    restockingProductId,
    setRestockingProductId
  ] = useState<string | null>(
    null
  );

  const [
    restockQuantity,
    setRestockQuantity
  ] = useState("");

  const [
    restockNote,
    setRestockNote
  ] = useState("");

  function saveAuth(
    value: LoginResponse
  ) {
    localStorage.setItem(
      AUTH_STORAGE_KEY,
      JSON.stringify(value)
    );

    setAuth(value);
  }

  function logout() {
    localStorage.removeItem(
      AUTH_STORAGE_KEY
    );

    setAuth(null);

    setReviews([]);
    setOrders([]);
    setProducts([]);
    setCategories([]);

    setProductFormOpen(false);
    setEditingProductId(null);
    setImageProductId(null);

    setError("");
    setSuccess("");
    setActionId(null);
    setRejectingPaymentId(null);
    setRestockingProductId(null);
  }

  async function login() {
    const email =
      loginEmail.trim();

    if (!email) {
      setError(
        "Please enter your email."
      );
      return;
    }

    if (!loginPassword) {
      setError(
        "Please enter your password."
      );
      return;
    }

    try {
      setLoginLoading(true);
      setError("");
      setSuccess("");

      const response =
        await fetch(
          `${API_BASE_URL}/auth/login`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              email: loginEmail,
              password: loginPassword
            })
          }
        );

      console.log(
        "API RESPONSE:",
        response.status,
        response.url
      );

      const data =
        await response.json();

      if (!response.ok) {
        throw new Error(
          data?.error ||
          "Login failed"
        );
      }

      if (
        !data?.token ||
        !data?.user
      ) {
        throw new Error(
          "Login response was invalid."
        );
      }

      saveAuth(data);

      setLoginPassword("");
      setSuccess(
        "Signed in successfully."
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Login failed"
      );
    } finally {
      setLoginLoading(false);
    }
  }

  async function apiFetch(
    path: string,
    options: RequestInit = {}
  ) {
    if (!auth?.token) {
      throw new Error(
        "Authentication required"
      );
    }

    const headers =
      new Headers(
        options.headers
      );

    headers.set(
      "Authorization",
      `Bearer ${auth.token}`
    );

    if (
      options.body &&
      !headers.has(
        "Content-Type"
      )
    ) {
      headers.set(
        "Content-Type",
        "application/json"
      );
    }

    const response =
      await fetch(
        `${API_BASE_URL}${path}`,
        {
          ...options,
          headers
        }
      );

    if (
      response.status === 401
    ) {
      logout();

      throw new Error(
        "Your session has expired. Please sign in again."
      );
    }

    return response;
  }

  async function loadReviews() {
    if (!auth?.token) {
      return;
    }

    try {
      setLoadingReviews(true);
      setError("");

      const response =
        await apiFetch(
          `/merchants/${MERCHANT_ID}/payment-review`
        );

      if (!response.ok) {
        const data =
          await response.json().catch(
            () => null
          );

        throw new Error(
          data?.error ||
          `Failed to load payment reviews (${response.status})`
        );
      }

      const data =
        await response.json();

      setReviews(
        Array.isArray(data)
          ? data
          : Array.isArray(
            data?.value
          )
            ? data.value
            : []
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to load payment reviews"
      );
    } finally {
      setLoadingReviews(false);
    }
  }

  async function loadOrders() {
    if (!auth?.token) {
      return;
    }

    try {
      setLoadingOrders(true);
      setError("");

      const response =
        await apiFetch(
          `/merchants/${MERCHANT_ID}/orders`
        );

      if (!response.ok) {
        const data =
          await response.json().catch(
            () => null
          );

        throw new Error(
          data?.error ||
          `Failed to load orders (${response.status})`
        );
      }

      const data =
        await response.json();

      setOrders(
        Array.isArray(data)
          ? data
          : Array.isArray(
            data?.value
          )
            ? data.value
            : []
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to load orders"
      );
    } finally {
      setLoadingOrders(false);
    }
  }

  async function loadProducts() {
    if (!auth?.token) {
      return;
    }

    try {
      setLoadingProducts(true);
      setError("");

      const response =
        await apiFetch(
          `/merchants/${MERCHANT_ID}/products`
        );

      if (!response.ok) {
        const data =
          await response.json().catch(
            () => null
          );

        throw new Error(
          data?.error ||
          `Failed to load products (${response.status})`
        );
      }

      const data =
        await response.json();

      setProducts(
        Array.isArray(data)
          ? data
          : Array.isArray(
            data?.value
          )
            ? data.value
            : []
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to load products"
      );
    } finally {
      setLoadingProducts(false);
    }
  }

  async function loadCategories() {
    if (!auth?.token) return;

    try {
      setLoadingCategories(true);
      const response = await apiFetch(
        `/merchants/${MERCHANT_ID}/products/categories`
      );
      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data?.error ||
          `Failed to load categories (${response.status})`
        );
      }

      setCategories(
        Array.isArray(data) ? data : []
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to load categories"
      );
    } finally {
      setLoadingCategories(false);
    }
  }

  function openNewProductForm() {
    setEditingProductId(null);
    setProductName("");
    setProductDescription("");
    setProductPrice("");
    setProductCurrency("ETB");
    setProductStock("0");
    setProductStatus("DRAFT");
    setProductCategoryId("");
    setProductFormOpen(true);
    setError("");
    setSuccess("");
  }

  function openEditProductForm(product: Product) {
    setEditingProductId(product.id);
    setProductName(product.name);
    setProductDescription(product.description || "");
    setProductPrice(String(product.price));
    setProductCurrency(product.currency);
    setProductStock(String(product.stock));
    setProductStatus(product.status);
    setProductCategoryId(product.categoryId || "");
    setProductFormOpen(true);
    setError("");
    setSuccess("");
  }

  function closeProductForm() {
    if (actionId) return;
    setProductFormOpen(false);
    setEditingProductId(null);
    setError("");
  }

  async function saveProduct() {
    const name = productName.trim();
    const description = productDescription.trim();
    const numericPrice = Number(productPrice);
    const numericStock = Number(productStock);
    const currency = productCurrency.trim().toUpperCase();

    if (!name) {
      setError("Product name is required.");
      return;
    }
    if (name.length > 200) {
      setError("Product name cannot exceed 200 characters.");
      return;
    }
    if (description.length > 5000) {
      setError("Product description cannot exceed 5,000 characters.");
      return;
    }
    if (!Number.isFinite(numericPrice) || numericPrice < 0) {
      setError("Price must be a non-negative number.");
      return;
    }
    if (!Number.isInteger(numericStock) || numericStock < 0) {
      setError("Stock must be a non-negative whole number.");
      return;
    }
    if (currency.length !== 3) {
      setError("Currency must be a 3-letter code.");
      return;
    }

    const currentId =
      editingProductId || "new-product";

    try {
      setActionId(currentId);
      setError("");
      setSuccess("");

      const response = await apiFetch(
        editingProductId
          ? `/merchants/${MERCHANT_ID}/products/${editingProductId}`
          : `/merchants/${MERCHANT_ID}/products`,
        {
          method: editingProductId ? "PATCH" : "POST",
          body: JSON.stringify({
            name,
            description: description || null,
            price: numericPrice,
            currency,
            stock: numericStock,
            status: productStatus,
            categoryId: productCategoryId || null
          })
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data?.error || "Failed to save product"
        );
      }

      setProductFormOpen(false);
      setEditingProductId(null);
      setSuccess(
        editingProductId
          ? "Product updated successfully."
          : "Product created successfully."
      );

      await Promise.all([
        loadProducts(),
        loadCategories()
      ]);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to save product"
      );
    } finally {
      setActionId(null);
    }
  }

  async function createCategory() {
    const name = categoryName.trim();

    if (!name) {
      setError("Category name is required.");
      return;
    }
    if (name.length > 100) {
      setError("Category name cannot exceed 100 characters.");
      return;
    }

    try {
      setActionId("new-category");
      setError("");
      setSuccess("");

      const response = await apiFetch(
        `/merchants/${MERCHANT_ID}/products/categories`,
        {
          method: "POST",
          body: JSON.stringify({ name })
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data?.error || "Failed to create category"
        );
      }

      setCategoryName("");
      setSuccess(
        `Category "${data.name}" created successfully.`
      );
      await loadCategories();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to create category"
      );
    } finally {
      setActionId(null);
    }
  }

  async function deleteCategory(
    categoryId: string,
    name: string
  ) {
    if (
      !window.confirm(
        `Delete category "${name}"? Products in this category will become uncategorized.`
      )
    ) {
      return;
    }

    try {
      setActionId(categoryId);
      setError("");
      setSuccess("");

      const response = await apiFetch(
        `/merchants/${MERCHANT_ID}/products/categories/${categoryId}`,
        { method: "DELETE" }
      );
      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data?.error || "Failed to delete category"
        );
      }

      setSuccess("Category deleted successfully.");
      await Promise.all([
        loadCategories(),
        loadProducts()
      ]);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to delete category"
      );
    } finally {
      setActionId(null);
    }
  }

  async function addProductImage(productId: string) {
    const url = imageUrl.trim();
    const altText = imageAltText.trim();

    if (!url) {
      setError("Image URL is required.");
      return;
    }

    try {
      setActionId(`image-${productId}`);
      setError("");
      setSuccess("");

      const product =
        products.find(
          (item) => item.id === productId
        );

      const response = await apiFetch(
        `/merchants/${MERCHANT_ID}/products/${productId}/images`,
        {
          method: "POST",
          body: JSON.stringify({
            url,
            altText: altText || null,
            isPrimary:
              (product?.images?.length || 0) === 0
          })
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data?.error ||
          "Failed to add product image"
        );
      }

      setImageUrl("");
      setImageAltText("");
      setSuccess("Product image added successfully.");
      await loadProducts();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to add product image"
      );
    } finally {
      setActionId(null);
    }
  }

  async function setPrimaryImage(
    productId: string,
    imageId: string
  ) {
    try {
      setActionId(`primary-${imageId}`);
      setError("");
      setSuccess("");

      const response = await apiFetch(
        `/merchants/${MERCHANT_ID}/products/${productId}/images/${imageId}/primary`,
        { method: "PATCH" }
      );
      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data?.error ||
          "Failed to set primary image"
        );
      }

      setSuccess("Primary product image updated.");
      await loadProducts();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to set primary image"
      );
    } finally {
      setActionId(null);
    }
  }

  async function deleteProductImage(
    productId: string,
    imageId: string
  ) {
    if (!window.confirm("Delete this product image?")) {
      return;
    }

    try {
      setActionId(`delete-image-${imageId}`);
      setError("");
      setSuccess("");

      const response = await apiFetch(
        `/merchants/${MERCHANT_ID}/products/${productId}/images/${imageId}`,
        { method: "DELETE" }
      );
      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data?.error ||
          "Failed to delete product image"
        );
      }

      setSuccess("Product image deleted.");
      await loadProducts();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to delete product image"
      );
    } finally {
      setActionId(null);
    }
  }

  async function deleteProduct(
    productId: string,
    name: string
  ) {
    if (
      !window.confirm(
        `Delete product "${name}"? This cannot be undone.`
      )
    ) {
      return;
    }

    try {
      setActionId(productId);
      setError("");
      setSuccess("");

      const response = await apiFetch(
        `/merchants/${MERCHANT_ID}/products/${productId}`,
        { method: "DELETE" }
      );
      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data?.error || "Failed to delete product"
        );
      }

      setSuccess("Product deleted successfully.");
      await Promise.all([
        loadProducts(),
        loadCategories()
      ]);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to delete product"
      );
    } finally {
      setActionId(null);
    }
  }

  async function refreshDashboard() {
    if (!auth?.token) {
      return;
    }

    setError("");
    setSuccess("");

    await Promise.all([
      loadReviews(),
      loadOrders(),
      loadProducts(),
      loadCategories()
    ]);
  }

  async function verifyPayment(
    paymentId: string
  ) {
    try {
      setActionId(paymentId);
      setError("");
      setSuccess("");

      const response =
        await apiFetch(
          `/merchants/${MERCHANT_ID}/payment-review/${paymentId}/verify`,
          {
            method: "POST",
            body: JSON.stringify({
              reviewNote:
                "Verified from merchant dashboard"
            })
          }
        );

      const data =
        await response.json();

      if (!response.ok) {
        throw new Error(
          data?.error ||
          "Failed to verify payment"
        );
      }

      setSuccess(
        `Payment verified. Order ${data.order.orderNumber} is now PAID.`
      );

      await Promise.all([
        loadReviews(),
        loadOrders(),
        loadProducts()
      ]);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to verify payment"
      );
    } finally {
      setActionId(null);
    }
  }

  function openRejectForm(
    paymentId: string
  ) {
    setRejectingPaymentId(
      paymentId
    );
    setRejectNote("");
    setError("");
    setSuccess("");
  }

  function cancelReject() {
    if (actionId) {
      return;
    }

    setRejectingPaymentId(null);
    setRejectNote("");
    setError("");
  }

  async function rejectPayment(
    paymentId: string,
    reviewNote: string
  ) {
    const trimmedNote =
      reviewNote.trim();

    if (!trimmedNote) {
      setError(
        "Please enter a reason for rejecting the payment."
      );
      return;
    }

    try {
      setActionId(paymentId);
      setError("");
      setSuccess("");

      const response =
        await apiFetch(
          `/merchants/${MERCHANT_ID}/payment-review/${paymentId}/reject`,
          {
            method: "POST",
            body: JSON.stringify({
              reviewNote:
                trimmedNote
            })
          }
        );

      const data =
        await response.json();

      if (!response.ok) {
        throw new Error(
          data?.error ||
          "Failed to reject payment"
        );
      }

      setRejectingPaymentId(
        null
      );
      setRejectNote("");

      setSuccess(
        `Payment rejected. Order ${data.order.orderNumber} returned to payment pending.`
      );

      await Promise.all([
        loadReviews(),
        loadOrders()
      ]);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to reject payment"
      );
    } finally {
      setActionId(null);
    }
  }

  async function updateOrderStatus(
    orderId: string,
    status:
      | "FULFILLING"
      | "FULFILLED"
  ) {
    try {
      setActionId(orderId);
      setError("");
      setSuccess("");

      const response =
        await apiFetch(
          `/merchants/${MERCHANT_ID}/orders/${orderId}/status`,
          {
            method: "POST",
            body: JSON.stringify({
              status
            })
          }
        );

      const data =
        await response.json();

      if (!response.ok) {
        throw new Error(
          data?.error ||
          "Failed to update order status"
        );
      }

      if (
        status ===
        "FULFILLING"
      ) {
        setSuccess(
          `Order ${data.order.orderNumber} is now being prepared.`
        );
      } else {
        setSuccess(
          `Order ${data.order.orderNumber} has been fulfilled.`
        );
      }

      await loadOrders();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to update order status"
      );
    } finally {
      setActionId(null);
    }
  }

  function openRestockForm(
    productId: string
  ) {
    setRestockingProductId(
      productId
    );
    setRestockQuantity("");
    setRestockNote("");
    setError("");
    setSuccess("");
  }

  function cancelRestock() {
    if (actionId) {
      return;
    }

    setRestockingProductId(null);
    setRestockQuantity("");
    setRestockNote("");
    setError("");
  }

  async function restockProduct(
    productId: string
  ) {
    const numericQuantity =
      Number(restockQuantity);

    if (
      !Number.isInteger(
        numericQuantity
      ) ||
      numericQuantity <= 0
    ) {
      setError(
        "Restock quantity must be a positive whole number."
      );
      return;
    }

    if (
      numericQuantity > 100000
    ) {
      setError(
        "Restock quantity cannot exceed 100,000 units at once."
      );
      return;
    }

    const product =
      products.find(
        (item) =>
          item.id ===
          productId
      );

    if (!product) {
      setError(
        "Product could not be found. Please refresh inventory and try again."
      );
      return;
    }

    const projectedStock =
      product.stock +
      numericQuantity;

    if (
      projectedStock >
      1000000
    ) {
      setError(
        "The resulting stock would exceed the safe inventory limit."
      );
      return;
    }

    try {
      setActionId(productId);
      setError("");
      setSuccess("");

      const response =
        await apiFetch(
          `/merchants/${MERCHANT_ID}/products/${productId}/restock`,
          {
            method: "POST",
            body: JSON.stringify({
              quantity:
                numericQuantity,
              note:
                restockNote.trim() ||
                undefined
            })
          }
        );

      const data =
        await response.json();

      if (!response.ok) {
        throw new Error(
          data?.error ||
          "Failed to restock product"
        );
      }

      const updatedProduct =
        data?.product;

      setRestockingProductId(
        null
      );
      setRestockQuantity("");
      setRestockNote("");

      if (updatedProduct) {
        setSuccess(
          `${updatedProduct.name} restocked successfully. Stock is now ${updatedProduct.stock}.`
        );
      } else {
        setSuccess(
          "Product restocked successfully."
        );
      }

      await loadProducts();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to restock product"
      );
    } finally {
      setActionId(null);
    }
  }

  useEffect(() => {
    if (!auth?.token) {
      setLoadingReviews(false);
      setLoadingOrders(false);
      setLoadingProducts(false);
      setLoadingCategories(false);
      return;
    }

    void refreshDashboard();
  }, [auth?.token]);

  const reviewCount =
    reviews.length;

  const paidOrders =
    orders.filter(
      (order) =>
        order.status ===
        "PAID"
    ).length;

  const fulfillingOrders =
    orders.filter(
      (order) =>
        order.status ===
        "FULFILLING"
    ).length;

  const outOfStockProducts =
    products.filter(
      (product) =>
        product.stock === 0
    ).length;

  const lowStockProducts =
    products.filter(
      (product) =>
        product.stock > 0 &&
        product.stock <= 5
    ).length;

  if (!auth?.token) {
    return (
      <main
        style={styles.loginPage}
      >
        <section
          style={styles.loginCard}
        >
          <div
            style={
              styles.loginHeader
            }
          >
            <h1
              style={
                styles.loginTitle
              }
            >
              Ethio Social Commerce
            </h1>

            <p
              style={
                styles.loginSubtitle
              }
            >
              Merchant Dashboard
            </p>
          </div>

          {error && (
            <div
              style={
                styles.error
              }
            >
              <strong>
                Error:
              </strong>{" "}
              {error}
            </div>
          )}

          <form
            onSubmit={(event) => {
              event.preventDefault();
              void login();
            }}
          >
            <label
              style={
                styles.formLabel
              }
            >
              Email
            </label>

            <input
              type="email"
              value={loginEmail}
              onChange={(event) =>
                setLoginEmail(
                  event.target.value
                )
              }
              placeholder="merchant@example.com"
              autoComplete="email"
              disabled={loginLoading}
              style={
                styles.loginInput
              }
            />

            <label
              style={
                styles.formLabel
              }
            >
              Password
            </label>

            <input
              type="password"
              value={loginPassword}
              onChange={(event) =>
                setLoginPassword(
                  event.target.value
                )
              }
              placeholder="Your password"
              autoComplete="current-password"
              disabled={loginLoading}
              style={
                styles.loginInput
              }
            />

            <button
              type="submit"
              disabled={loginLoading}
              style={
                styles.loginButton
              }
            >
              {loginLoading
                ? "Signing in..."
                : "Sign in"}
            </button>
          </form>
        </section>
      </main>
    );
  }

  const sortedReviews = useMemo(() => {
    const next = [...reviews];

    next.sort((a, b) => {
      switch (reviewSort) {
        case "oldest":
          return (
            new Date(a.createdAt).getTime() -
            new Date(b.createdAt).getTime()
          );

        case "amount-high":
          return (
            Number(b.amount) -
            Number(a.amount)
          );

        case "amount-low":
          return (
            Number(a.amount) -
            Number(b.amount)
          );

        case "provider-az":
          return (a.provider || "").localeCompare(
            b.provider || ""
          );

        case "provider-za":
          return (b.provider || "").localeCompare(
            a.provider || ""
          );

        case "customer-az":
          return (
            (
              a.order.customer?.name ||
              "Unknown customer"
            ).localeCompare(
              b.order.customer?.name ||
              "Unknown customer"
            )
          );

        case "customer-za":
          return (
            (
              b.order.customer?.name ||
              "Unknown customer"
            ).localeCompare(
              a.order.customer?.name ||
              "Unknown customer"
            )
          );

        case "newest":
        default:
          return (
            new Date(b.createdAt).getTime() -
            new Date(a.createdAt).getTime()
          );
      }
    });

    return next;
  }, [reviews, reviewSort]);

  return (
    <main style={styles.page}>
      <header
        style={styles.header}
      >
        <div>
          <h1
            style={styles.title}
          >
            Ethio Social Commerce
          </h1>

          <p
            style={styles.subtitle}
          >
            Merchant Dashboard
          </p>

          <p
            style={
              styles.signedInUser
            }
          >
            Signed in as{" "}
            <strong>
              {auth.user.displayName ||
                auth.user.email}
            </strong>
          </p>
        </div>

        <div
          style={styles.headerActions}
        >
          <button
            type="button"
            onClick={() =>
              void refreshDashboard()
            }
            disabled={
              loadingReviews ||
              loadingOrders ||
              loadingProducts ||
              actionId !== null
            }
            style={
              styles.refreshButton
            }
          >
            {loadingReviews ||
              loadingOrders ||
              loadingProducts
              ? "Refreshing..."
              : "Refresh"}
          </button>

          <button
            type="button"
            onClick={logout}
            disabled={
              actionId !== null
            }
            style={
              styles.logoutButton
            }
          >
            Sign out
          </button>
        </div>
      </header>

      <section
        style={styles.summary}
      >
        <div
          style={
            styles.summaryCard
          }
        >
          <span
            style={
              styles.summaryLabel
            }
          >
            Payments awaiting review
          </span>

          <strong
            style={
              styles.summaryValue
            }
          >
            {reviewCount}
          </strong>
        </div>

        <div
          style={
            styles.summaryCard
          }
        >
          <span
            style={
              styles.summaryLabel
            }
          >
            Paid orders
          </span>

          <strong
            style={
              styles.summaryValue
            }
          >
            {paidOrders}
          </strong>
        </div>

        <div
          style={
            styles.summaryCard
          }
        >
          <span
            style={
              styles.summaryLabel
            }
          >
            Orders being prepared
          </span>

          <strong
            style={
              styles.summaryValue
            }
          >
            {fulfillingOrders}
          </strong>
        </div>

        <div
          style={
            styles.summaryCard
          }
        >
          <span
            style={
              styles.summaryLabel
            }
          >
            Inventory alerts
          </span>

          <strong
            style={
              styles.summaryValue
            }
          >
            {outOfStockProducts +
              lowStockProducts}
          </strong>

          <span
            style={
              styles.summaryHint
            }
          >
            {outOfStockProducts} out of stock
            {" · "}
            {lowStockProducts} low stock
          </span>
        </div>
      </section>

      <section
        style={styles.tabs}
      >
        <button
          type="button"
          onClick={() => {
            setActiveTab(
              "payments"
            );
            setError("");
            setSuccess("");
          }}
          style={{
            ...styles.tab,
            ...(activeTab ===
              "payments"
              ? styles.activeTab
              : {})
          }}
        >
          Payment Review

          {reviewCount > 0 && (
            <span
              style={
                styles.tabCount
              }
            >
              {reviewCount}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => {
            setActiveTab("orders");
            setError("");
            setSuccess("");
          }}
          style={{
            ...styles.tab,
            ...(activeTab ===
              "orders"
              ? styles.activeTab
              : {})
          }}
        >
          Orders
        </button>

        <button
          type="button"
          onClick={() => {
            setActiveTab(
              "inventory"
            );
            setError("");
            setSuccess("");
            void loadProducts();
          }}
          style={{
            ...styles.tab,
            ...(activeTab ===
              "inventory"
              ? styles.activeTab
              : {})
          }}
        >
          Inventory

          {outOfStockProducts >
            0 && (
              <span
                style={
                  styles.inventoryWarningCount
                }
              >
                {outOfStockProducts}
              </span>
            )}

          {lowStockProducts >
            0 && (
              <span
                style={
                  styles.inventoryLowCount
                }
              >
                {lowStockProducts}
              </span>
            )}
        </button>
      </section>

      {error && (
        <div
          style={styles.error}
        >
          <strong>
            Error:
          </strong>{" "}
          {error}
        </div>
      )}

      {success && (
        <div
          style={styles.success}
        >
          {success}
        </div>
      )}

      {activeTab ===
        "payments" ? (
        <section
          style={styles.section}
        >

          <div
            style={{
              ...styles.sectionHeader,
              alignItems: "flex-end",
            }}
          >
            <div>
              <h2
                style={
                  styles.sectionTitle
                }
              >
                Payment Review
              </h2>

              <p
                style={
                  styles.sectionDescription
                }
              >
                Verify or reject customer payment
                submissions.
              </p>
            </div>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                flexWrap: "wrap",
              }}
            >
              <label
                htmlFor="payment-review-sort"
                style={{
                  fontSize: "13px",
                  fontWeight: 600,
                  color: "#475569",
                }}
              >
                Sort by
              </label>

              <select
                id="payment-review-sort"
                value={reviewSort}
                onChange={(event) =>
                  setReviewSort(
                    event.target.value as ReviewSort
                  )
                }
                style={{
                  padding: "9px 12px",
                  borderRadius: "8px",
                  border: "1px solid #cbd5e1",
                  background: "#ffffff",
                  color: "#0f172a",
                  fontSize: "13px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                <option value="newest">
                  Newest first
                </option>

                <option value="oldest">
                  Oldest first
                </option>

                <option value="amount-high">
                  Amount: highest first
                </option>

                <option value="amount-low">
                  Amount: lowest first
                </option>

                <option value="provider-az">
                  Bank / provider: A–Z
                </option>

                <option value="provider-za">
                  Bank / provider: Z–A
                </option>

                <option value="customer-az">
                  Customer: A–Z
                </option>

                <option value="customer-za">
                  Customer: Z–A
                </option>
              </select>
            </div>
          </div>

          {loadingReviews ? (
            <div
              style={
                styles.emptyState
              }
            >
              Loading payment reviews...
            </div>
          ) : reviews.length ===
            0 ? (
            <div
              style={
                styles.emptyState
              }
            >
              <strong>
                No payments awaiting review.
              </strong>

              <p>
                New customer payment submissions
                will appear here.
              </p>
            </div>
          ) : (
            <div
              style={
                styles.reviewList
              }
            >
              {sortedReviews.map(
                (review) => {
                  const customerName =
                    review.order.customer
                      ?.name ||
                    "Unknown customer";

                  const product =
                    review.order
                      .items[0];

                  const busy =
                    actionId ===
                    review.id;

                  const isRejecting =
                    rejectingPaymentId ===
                    review.id;

                  const isExpanded =
                    expandedPaymentIds.has(review.id);

                  const extracted =
                    review.receiptMetadata?.extracted;



                  const expectedAmount = Number(review.amount);
                  const extractedAmount =
                    typeof extracted?.amount === "number"
                      ? extracted.amount
                      : null;

                  const expectedProvider =
                    review.provider || "Not specified";

                  const extractedProvider =
                    extracted?.provider || null;

                  const normalizedExpectedProvider =
                    expectedProvider
                      .toLowerCase()
                      .replace(/[\s_-]+/g, "");

                  const normalizedExtractedProvider =
                    extractedProvider
                      ?.toLowerCase()
                      .replace(/[\s_-]+/g, "") || "";

                  const providerMatches =
                    extractedProvider !== null &&
                    (
                      (
                        normalizedExpectedProvider.includes("cbebirr") ||
                        normalizedExpectedProvider === "cbe"
                      ) &&
                      (
                        normalizedExtractedProvider.includes("cbebirr") ||
                        normalizedExtractedProvider.includes("commercialbankofethiopia") ||
                        normalizedExtractedProvider === "cbe"
                      )
                    ) ||
                    (
                      normalizedExpectedProvider.includes("telebirr") &&
                      normalizedExtractedProvider.includes("telebirr")
                    ) ||
                    normalizedExpectedProvider ===
                    normalizedExtractedProvider;

                  const amountMatches =
                    extractedAmount !== null &&
                    Number.isFinite(expectedAmount) &&
                    extractedAmount === expectedAmount;

                  const expectedReference =
                    review.transactionReference?.trim() || null;

                  const extractedReference =
                    extracted?.transactionReference?.trim() || null;

                  const referenceMatches =
                    expectedReference !== null &&
                    extractedReference !== null &&
                    expectedReference === extractedReference;

                  const currencyMatches =
                    !extracted?.currency ||
                    extracted.currency.toUpperCase() ===
                    review.currency.toUpperCase();

                  const findings: Array<{
                    label: string;
                    expected: string;
                    actual: string;
                    status: "MATCH" | "MISMATCH" | "UNAVAILABLE";
                  }> = [
                      {
                        label: "Amount",
                        expected: `${review.amount} ${review.currency}`,
                        actual:
                          extractedAmount !== null
                            ? `${extractedAmount} ${extracted?.currency || review.currency
                            }`
                            : "Not available",
                        status:
                          extractedAmount === null
                            ? "UNAVAILABLE"
                            : amountMatches
                              ? "MATCH"
                              : "MISMATCH",
                      },
                      {
                        label: "Payment provider",
                        expected: expectedProvider,
                        actual:
                          extractedProvider || "Not available",
                        status:
                          !extractedProvider
                            ? "UNAVAILABLE"
                            : providerMatches
                              ? "MATCH"
                              : "MISMATCH",
                      },
                      {
                        label: "Transaction reference",
                        expected:
                          expectedReference || "Not available",
                        actual:
                          extractedReference || "Not available",
                        status:
                          !expectedReference || !extractedReference
                            ? "UNAVAILABLE"
                            : referenceMatches
                              ? "MATCH"
                              : "MISMATCH",
                      },
                      {
                        label: "Currency",
                        expected: review.currency,
                        actual:
                          extracted?.currency || "Not available",
                        status:
                          !extracted?.currency
                            ? "UNAVAILABLE"
                            : currencyMatches
                              ? "MATCH"
                              : "MISMATCH",
                      },
                    ];

                  const mismatchCount =
                    findings.filter(
                      (finding) => finding.status === "MISMATCH"
                    ).length;

                  return (
                    <article
                      key={review.id}
                      style={styles.reviewCard}
                    >
                      <div style={styles.cardTop}>
                        <div>
                          <span style={styles.orderLabel}>
                            Order
                          </span>

                          <h3 style={styles.orderNumber}>
                            {review.order.orderNumber}
                          </h3>
                        </div>

                        <span style={styles.badge}>
                          {review.status}
                        </span>
                      </div>

                      {/* ===================================================== */}
                      {/* 1. MERCHANT / ORDER INFORMATION — EXPECTED           */}
                      {/* ===================================================== */}

                      <section
                        style={{
                          marginTop: "18px",
                          padding: "18px",
                          border: "1px solid #dbe3ee",
                          borderRadius: "12px",
                          background: "#ffffff",
                        }}
                      >
                        <div style={{ marginBottom: "14px" }}>
                          <h4
                            style={{
                              margin: 0,
                              color: "#0f172a",
                              fontSize: "17px",
                            }}
                          >
                            Merchant / Order Information
                          </h4>

                          <p
                            style={{
                              margin: "5px 0 0",
                              color: "#64748b",
                              fontSize: "13px",
                            }}
                          >
                            Expected payment details from this order.
                          </p>
                        </div>

                        <div style={styles.details}>
                          <Detail
                            label="Customer"
                            value={customerName}
                          />

                          <Detail
                            label="Product"
                            value={
                              product?.productName ||
                              "Unknown product"
                            }
                          />

                          <Detail
                            label="Quantity"
                            value={
                              product?.quantity ?? "-"
                            }
                          />

                          <Detail
                            label="Order amount"
                            value={`${review.amount} ${review.currency}`}
                          />

                          <Detail
                            label="Expected provider"
                            value={formatPaymentProvider(expectedProvider)}
                          />

                          <Detail
                            label="Expected transaction reference"
                            value={
                              expectedReference ||
                              "Not provided"
                            }
                          />
                        </div>
                      </section>

                      {/* ===================================================== */}
                      {/* 2. FINDINGS — COMPARISON / WARNING SECTION            */}
                      {/* ===================================================== */}

                      <button
                        type="button"
                        onClick={() =>
                          togglePaymentReview(review.id)
                        }
                        style={{
                          width: "100%",
                          marginTop: "12px",
                          padding: "11px 14px",
                          borderRadius: "9px",
                          border: "1px solid #cbd5e1",
                          background: "#f8fafc",
                          color: "#0f172a",
                          fontWeight: 700,
                          fontSize: "13px",
                          cursor: "pointer",
                        }}
                      >
                        {isExpanded
                          ? "Collapse review details ▲"
                          : "Expand review details ▼"}
                      </button>

                      {isExpanded && (
                        <>

                          <section
                            style={{
                              marginTop: "18px",
                              padding: "18px",
                              borderRadius: "12px",
                              border:
                                mismatchCount > 0
                                  ? "1px solid #fecaca"
                                  : "1px solid #bbf7d0",
                              background:
                                mismatchCount > 0
                                  ? "#fff7f7"
                                  : "#f0fdf4",
                            }}
                          >
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                gap: "12px",
                                marginBottom: "14px",
                              }}
                            >
                              <div>
                                <h4
                                  style={{
                                    margin: 0,
                                    color: "#0f172a",
                                    fontSize: "17px",
                                  }}
                                >
                                  Findings
                                </h4>

                                <p
                                  style={{
                                    margin: "5px 0 0",
                                    color: "#64748b",
                                    fontSize: "13px",
                                  }}
                                >
                                  Compare the order information with
                                  what was extracted from the receipt.
                                </p>
                              </div>

                              <span
                                style={{
                                  padding: "6px 10px",
                                  borderRadius: "999px",
                                  fontSize: "12px",
                                  fontWeight: 700,
                                  background:
                                    mismatchCount > 0
                                      ? "#fee2e2"
                                      : "#dcfce7",
                                  color:
                                    mismatchCount > 0
                                      ? "#b91c1c"
                                      : "#15803d",
                                  whiteSpace: "nowrap",
                                }}
                              >
                                {mismatchCount > 0
                                  ? `${mismatchCount} issue${mismatchCount === 1 ? "" : "s"
                                  } found`
                                  : "No detected mismatches"}
                              </span>
                            </div>

                            {mismatchCount > 0 && (
                              <div
                                style={{
                                  marginBottom: "14px",
                                  padding: "12px 14px",
                                  borderRadius: "8px",
                                  background: "#fef2f2",
                                  color: "#991b1b",
                                  fontSize: "13px",
                                  lineHeight: 1.5,
                                }}
                              >
                                <strong>Review carefully:</strong>{" "}
                                the receipt information does not fully
                                match the expected order information.
                                Check the original receipt before
                                verifying this payment.
                              </div>
                            )}

                            <div
                              style={{
                                display: "grid",
                                gap: "10px",
                              }}
                            >
                              {findings.map((finding) => {
                                const isMismatch =
                                  finding.status === "MISMATCH";

                                const isUnavailable =
                                  finding.status === "UNAVAILABLE";

                                return (
                                  <div
                                    key={finding.label}
                                    style={{
                                      padding: "13px",
                                      borderRadius: "9px",
                                      border: isMismatch
                                        ? "1px solid #fecaca"
                                        : "1px solid #e2e8f0",
                                      background: "#ffffff",
                                    }}
                                  >
                                    <div
                                      style={{
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "space-between",
                                        gap: "12px",
                                        marginBottom: "8px",
                                      }}
                                    >
                                      <strong
                                        style={{
                                          color: "#0f172a",
                                          fontSize: "14px",
                                        }}
                                      >
                                        {finding.label}
                                      </strong>

                                      <span
                                        style={{
                                          fontSize: "11px",
                                          fontWeight: 700,
                                          padding: "4px 8px",
                                          borderRadius: "999px",
                                          background: isMismatch
                                            ? "#fee2e2"
                                            : isUnavailable
                                              ? "#f1f5f9"
                                              : "#dcfce7",
                                          color: isMismatch
                                            ? "#b91c1c"
                                            : isUnavailable
                                              ? "#64748b"
                                              : "#15803d",
                                        }}
                                      >
                                        {finding.status}
                                      </span>
                                    </div>

                                    <div
                                      style={{
                                        display: "grid",
                                        gridTemplateColumns:
                                          "minmax(0, 1fr) minmax(0, 1fr)",
                                        gap: "12px",
                                      }}
                                    >
                                      <div>
                                        <div
                                          style={{
                                            fontSize: "11px",
                                            color: "#64748b",
                                            marginBottom: "3px",
                                          }}
                                        >
                                          Expected
                                        </div>

                                        <div
                                          style={{
                                            fontWeight: 600,
                                            color: "#0f172a",
                                          }}
                                        >
                                          {finding.expected}
                                        </div>
                                      </div>

                                      <div>
                                        <div
                                          style={{
                                            fontSize: "11px",
                                            color: "#64748b",
                                            marginBottom: "3px",
                                          }}
                                        >
                                          Receipt says
                                        </div>

                                        <div
                                          style={{
                                            fontWeight: 600,
                                            color: isMismatch
                                              ? "#b91c1c"
                                              : "#0f172a",
                                          }}
                                        >
                                          {finding.actual}
                                        </div>
                                      </div>
                                    </div>

                                    {isMismatch && (
                                      <div
                                        style={{
                                          marginTop: "9px",
                                          fontSize: "12px",
                                          color: "#991b1b",
                                        }}
                                      >
                                        Check this value against the
                                        original receipt before verifying.
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </section>

                          {/* ===================================================== */}
                          {/* 3. RECEIPT EVIDENCE — IMAGE + EXTRACTED INFORMATION */}
                          {/* ===================================================== */}

                          <section
                            style={{
                              marginTop: "18px",
                              padding: "18px",
                              border: "1px solid #dbe3ee",
                              borderRadius: "12px",
                              background: "#ffffff",
                            }}
                          >
                            <div style={{ marginBottom: "14px" }}>
                              <h4
                                style={{
                                  margin: 0,
                                  color: "#0f172a",
                                  fontSize: "17px",
                                }}
                              >
                                Receipt Evidence
                              </h4>

                              <p
                                style={{
                                  margin: "5px 0 0",
                                  color: "#64748b",
                                  fontSize: "13px",
                                }}
                              >
                                Review the original receipt alongside the
                                information extracted from it. Extracted
                                information is evidence for merchant review,
                                not an automatic verification decision.
                              </p>
                            </div>

                            <div
                              style={{
                                display: "grid",
                                gridTemplateColumns:
                                  "minmax(280px, 1fr) minmax(280px, 1fr)",
                                gap: "18px",
                                alignItems: "stretch",
                              }}
                            >
                              {/* Receipt image */}
                              <div
                                style={{
                                  height: "560px",
                                  display: "flex",
                                  flexDirection: "column",
                                }}
                              >
                                <div
                                  style={{
                                    fontSize: "12px",
                                    fontWeight: 700,
                                    color: "#475569",
                                    marginBottom: "8px",
                                  }}
                                >
                                  Original receipt
                                </div>

                                {review.receiptUrl ? (
                                  <>
                                    <div
                                      style={{
                                        flex: 1,
                                        minHeight: 0,
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        overflow: "hidden",
                                        borderRadius: "8px",
                                        border: "1px solid #cbd5e1",
                                        background: "#f8fafc",
                                      }}
                                    >
                                      <img
                                        src={review.receiptUrl}
                                        alt="Customer payment receipt"
                                        style={{
                                          display: "block",
                                          width: "100%",
                                          height: "100%",
                                          objectFit: "contain",
                                        }}
                                      />
                                    </div>

                                    <a
                                      href={review.receiptUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      style={{
                                        display: "inline-flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        alignSelf: "flex-start",
                                        marginTop: "10px",
                                        padding: "9px 13px",
                                        borderRadius: "8px",
                                        border: "1px solid #cbd5e1",
                                        background: "#ffffff",
                                        color: "#0f172a",
                                        fontWeight: 600,
                                        textDecoration: "none",
                                        cursor: "pointer",
                                      }}
                                    >
                                      Open Full Receipt
                                    </a>
                                  </>
                                ) : (
                                  <div
                                    style={{
                                      flex: 1,
                                      display: "flex",
                                      alignItems: "center",
                                      justifyContent: "center",
                                      padding: "24px",
                                      borderRadius: "8px",
                                      border: "1px dashed #cbd5e1",
                                      background: "#f8fafc",
                                      color: "#64748b",
                                      fontSize: "13px",
                                    }}
                                  >
                                    Receipt image is not available.
                                  </div>
                                )}
                              </div>

                              {/* Extracted receipt information */}
                              <div
                                style={{
                                  padding: "16px",
                                  borderRadius: "10px",
                                  border: "1px solid #e2e8f0",
                                  background: "#f8fafc",
                                }}
                              >
                                <div
                                  style={{
                                    marginBottom: "12px",
                                  }}
                                >
                                  <h5
                                    style={{
                                      margin: 0,
                                      color: "#0f172a",
                                      fontSize: "15px",
                                    }}
                                  >
                                    Extracted from receipt
                                  </h5>

                                  <p
                                    style={{
                                      margin: "4px 0 0",
                                      color: "#64748b",
                                      fontSize: "12px",
                                    }}
                                  >
                                    Values read from the uploaded receipt image.
                                  </p>
                                </div>

                                <div
                                  style={{
                                    display: "grid",
                                    gap: "10px",
                                  }}
                                >
                                  <Detail
                                    label="Amount"
                                    value={
                                      extractedAmount !== null
                                        ? `${extractedAmount} ${extracted?.currency ||
                                        review.currency
                                        }`
                                        : "Not available"
                                    }
                                  />

                                  <Detail
                                    label="Bank / provider"
                                    value={
                                      extractedProvider ||
                                      "Not available"
                                    }
                                  />

                                  <Detail
                                    label="Transaction reference"
                                    value={
                                      extractedReference ||
                                      "Not available"
                                    }
                                  />

                                  <Detail
                                    label="Currency"
                                    value={
                                      extracted?.currency ||
                                      "Not available"
                                    }
                                  />

                                  <Detail
                                    label="Transaction date"
                                    value={
                                      extracted?.transactionDate ||
                                      "Not available"
                                    }
                                  />

                                  <Detail
                                    label="Transaction time"
                                    value={
                                      extracted?.transactionTime ||
                                      "Not available"
                                    }
                                  />

                                  <Detail
                                    label="Sender name"
                                    value={
                                      extracted?.senderName ||
                                      "Not available"
                                    }
                                  />

                                  <Detail
                                    label="Sender account"
                                    value={
                                      extracted?.senderAccount ||
                                      "Not available"
                                    }
                                  />
                                </div>

                                {typeof extracted?.confidence === "number" && (
                                  <div
                                    style={{
                                      marginTop: "12px",
                                      paddingTop: "10px",
                                      borderTop: "1px solid #e2e8f0",
                                      fontSize: "11px",
                                      color: "#64748b",
                                    }}
                                  >
                                    Extraction confidence:{" "}
                                    {Math.round(
                                      extracted.confidence * 100
                                    )}
                                    %
                                  </div>
                                )}
                              </div>
                            </div>
                          </section>
                        </>
                      )}

                      <div
                        style={{
                          marginTop: "18px",
                          paddingTop: "16px",
                          borderTop: "1px solid #e2e8f0",
                        }}
                      />

                      {isRejecting && (

                        <div
                          style={
                            styles.rejectPanel
                          }
                        >
                          <strong
                            style={
                              styles.rejectTitle
                            }
                          >
                            Reject payment
                          </strong>

                          <p
                            style={
                              styles.rejectDescription
                            }
                          >
                            Enter a reason for rejecting
                            this payment. The customer
                            will receive this reason on
                            Telegram.
                          </p>

                          <textarea
                            value={
                              rejectNote
                            }
                            onChange={(
                              event
                            ) =>
                              setRejectNote(
                                event
                                  .target
                                  .value
                              )
                            }
                            placeholder="Example: Transaction reference could not be verified."
                            disabled={
                              busy
                            }
                            rows={4}
                            style={
                              styles.rejectTextarea
                            }
                          />

                          <div
                            style={
                              styles.rejectActions
                            }
                          >
                            <button
                              type="button"
                              disabled={
                                busy
                              }
                              onClick={
                                cancelReject
                              }
                              style={
                                styles.cancelButton
                              }
                            >
                              Cancel
                            </button>

                            <button
                              type="button"
                              disabled={
                                busy ||
                                !rejectNote.trim()
                              }
                              onClick={() =>
                                void rejectPayment(
                                  review.id,
                                  rejectNote
                                )
                              }
                              style={
                                styles.confirmRejectButton
                              }
                            >
                              {busy
                                ? "Rejecting..."
                                : "Confirm Rejection"}
                            </button>
                          </div>
                        </div>
                      )}

                      <div
                        style={
                          styles.cardFooter
                        }
                      >
                        <span
                          style={
                            styles.date
                          }
                        >
                          Submitted{" "}
                          {new Date(
                            review.createdAt
                          ).toLocaleString()}
                        </span>

                        <div
                          style={
                            styles.actions
                          }
                        >
                          <button
                            type="button"
                            disabled={
                              busy ||
                              rejectingPaymentId !==
                              null ||
                              actionId !==
                              null
                            }
                            onClick={() =>
                              void verifyPayment(
                                review.id
                              )
                            }
                            style={
                              styles.verifyButton
                            }
                          >
                            {busy
                              ? "Processing..."
                              : "Verify Payment"}
                          </button>

                          {!isRejecting && (
                            <button
                              type="button"
                              disabled={
                                busy ||
                                rejectingPaymentId !==
                                null ||
                                actionId !==
                                null
                              }
                              onClick={() =>
                                openRejectForm(
                                  review.id
                                )
                              }
                              style={
                                styles.rejectButton
                              }
                            >
                              Reject
                            </button>
                          )}
                        </div>
                      </div>
                    </article>
                  );
                }
              )}
            </div>
          )}
        </section>
      ) : activeTab ===
        "orders" ? (
        <section
          style={styles.section}
        >
          <div
            style={
              styles.sectionHeader
            }
          >
            <div>
              <h2
                style={
                  styles.sectionTitle
                }
              >
                Orders
              </h2>

              <p
                style={
                  styles.sectionDescription
                }
              >
                Manage paid orders and fulfillment.
              </p>
            </div>
          </div>

          {loadingOrders ? (
            <div
              style={
                styles.emptyState
              }
            >
              Loading orders...
            </div>
          ) : orders.length ===
            0 ? (
            <div
              style={
                styles.emptyState
              }
            >
              <strong>
                No orders yet.
              </strong>

              <p>
                Customer orders will appear here.
              </p>
            </div>
          ) : (
            <div
              style={
                styles.reviewList
              }
            >
              {orders.map(
                (order) => {
                  const busy =
                    actionId ===
                    order.id;

                  const payment =
                    order.payments
                      .filter(
                        (item) =>
                          item.status ===
                          "VERIFIED"
                      )
                      .at(-1) ||
                    order.payments.at(
                      -1
                    );

                  return (
                    <article
                      key={
                        order.id
                      }
                      style={
                        styles.reviewCard
                      }
                    >
                      <div
                        style={
                          styles.cardTop
                        }
                      >
                        <div>
                          <span
                            style={
                              styles.orderLabel
                            }
                          >
                            Order
                          </span>

                          <h3
                            style={
                              styles.orderNumber
                            }
                          >
                            {
                              order.orderNumber
                            }
                          </h3>

                          <span
                            style={
                              styles.customer
                            }
                          >
                            {order
                              .customer
                              ?.name ||
                              "Unknown customer"}
                          </span>
                        </div>

                        <span
                          style={{
                            ...styles.orderBadge,
                            ...getStatusStyle(
                              order.status
                            )
                          }}
                        >
                          {
                            order.status
                          }
                        </span>
                      </div>

                      <div
                        style={
                          styles.itemsBox
                        }
                      >
                        {order.items.map(
                          (item) => (
                            <div
                              key={
                                item.id
                              }
                              style={
                                styles.itemRow
                              }
                            >
                              <span>
                                {
                                  item.productName
                                }{" "}
                                ×{" "}
                                {
                                  item.quantity
                                }
                              </span>

                              <strong>
                                {
                                  item.lineTotal
                                }{" "}
                                {
                                  order.currency
                                }
                              </strong>
                            </div>
                          )
                        )}
                      </div>

                      <div
                        style={
                          styles.details
                        }
                      >
                        <Detail
                          label="Customer"
                          value={
                            order
                              .customer
                              ?.name ||
                            "Unknown customer"
                          }
                        />

                        <Detail
                          label="Total"
                          value={`${order.total} ${order.currency}`}
                        />

                        <Detail
                          label="Payment"
                          value={
                            payment?.status ||
                            "No payment"
                          }
                        />

                        <Detail
                          label="Provider"
                          value={
                            payment?.provider ||
                            "-"
                          }
                        />

                        <Detail
                          label="Transaction reference"
                          value={
                            payment?.transactionReference ||
                            "-"
                          }
                        />

                        <Detail
                          label="Created"
                          value={new Date(
                            order.createdAt
                          ).toLocaleString()}
                        />
                      </div>

                      <div
                        style={
                          styles.cardFooter
                        }
                      >
                        <span
                          style={
                            styles.date
                          }
                        >
                          Updated{" "}
                          {new Date(
                            order.updatedAt
                          ).toLocaleString()}
                        </span>

                        <div
                          style={
                            styles.actions
                          }
                        >
                          {order.status ===
                            "PAID" && (
                              <button
                                type="button"
                                disabled={
                                  busy ||
                                  actionId !==
                                  null
                                }
                                onClick={() =>
                                  void updateOrderStatus(
                                    order.id,
                                    "FULFILLING"
                                  )
                                }
                                style={
                                  styles.fulfillButton
                                }
                              >
                                {busy
                                  ? "Processing..."
                                  : "Start Fulfillment"}
                              </button>
                            )}

                          {order.status ===
                            "FULFILLING" && (
                              <button
                                type="button"
                                disabled={
                                  busy ||
                                  actionId !==
                                  null
                                }
                                onClick={() =>
                                  void updateOrderStatus(
                                    order.id,
                                    "FULFILLED"
                                  )
                                }
                                style={
                                  styles.fulfillButton
                                }
                              >
                                {busy
                                  ? "Processing..."
                                  : "Mark Fulfilled"}
                              </button>
                            )}

                          {order.status ===
                            "FULFILLED" && (
                              <span
                                style={
                                  styles.completed
                                }
                              >
                                Completed ?
                              </span>
                            )}
                        </div>
                      </div>
                    </article>
                  );
                }
              )}
            </div>
          )}
        </section>
      ) : (
        <section
          style={styles.section}
        >
          <div
            style={
              styles.sectionHeader
            }
          >
            <div>
              <h2
                style={
                  styles.sectionTitle
                }
              >
                Inventory
              </h2>

              <p
                style={
                  styles.sectionDescription
                }
              >
                Monitor product stock and replenish
                inventory when new stock arrives.
              </p>
            </div>

            <button
              type="button"
              onClick={() =>
                void loadProducts()
              }
              disabled={
                loadingProducts ||
                actionId !== null
              }
              style={
                styles.inventoryRefreshButton
              }
            >
              {loadingProducts
                ? "Loading..."
                : "Refresh Inventory"}
            </button>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns:
                "minmax(0, 1.5fr) minmax(280px, 1fr)",
              gap: "16px",
              marginBottom: "20px"
            }}
          >
            <section
              style={{
                border: "1px solid #dbe3ee",
                borderRadius: "14px",
                padding: "18px",
                background: "#ffffff"
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: "12px",
                  marginBottom: "14px"
                }}
              >
                <div>
                  <strong>Product Catalog</strong>
                  <div
                    style={{
                      color: "#64748b",
                      fontSize: "13px",
                      marginTop: "4px"
                    }}
                  >
                    Create products and manage pricing,
                    stock, status, and categories.
                  </div>
                </div>

                <button
                  type="button"
                  onClick={openNewProductForm}
                  disabled={actionId !== null}
                  style={styles.restockButton}
                >
                  + Add Product
                </button>
              </div>

              {productFormOpen && (
                <div
                  style={{
                    borderTop: "1px solid #e2e8f0",
                    paddingTop: "16px"
                  }}
                >
                  <h3
                    style={{
                      margin: "0 0 14px",
                      fontSize: "16px"
                    }}
                  >
                    {editingProductId
                      ? "Edit Product"
                      : "Create Product"}
                  </h3>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns:
                        "repeat(2, minmax(0, 1fr))",
                      gap: "12px"
                    }}
                  >
                    <div>
                      <label style={styles.formLabel}>
                        Name
                      </label>
                      <input
                        value={productName}
                        maxLength={200}
                        onChange={(event) =>
                          setProductName(
                            event.target.value
                          )
                        }
                        disabled={actionId !== null}
                        style={styles.formInput}
                        placeholder="Product name"
                      />
                    </div>

                    <div>
                      <label style={styles.formLabel}>
                        Category
                      </label>
                      <select
                        value={productCategoryId}
                        onChange={(event) =>
                          setProductCategoryId(
                            event.target.value
                          )
                        }
                        disabled={actionId !== null}
                        style={styles.formInput}
                      >
                        <option value="">
                          Uncategorized
                        </option>
                        {categories.map(
                          (category) => (
                            <option
                              key={category.id}
                              value={category.id}
                            >
                              {category.name}
                            </option>
                          )
                        )}
                      </select>
                    </div>

                    <div>
                      <label style={styles.formLabel}>
                        Price
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={productPrice}
                        onChange={(event) =>
                          setProductPrice(
                            event.target.value
                          )
                        }
                        disabled={actionId !== null}
                        style={styles.formInput}
                        placeholder="0.00"
                      />
                    </div>

                    <div>
                      <label style={styles.formLabel}>
                        Currency
                      </label>
                      <input
                        value={productCurrency}
                        maxLength={3}
                        onChange={(event) =>
                          setProductCurrency(
                            event.target.value.toUpperCase()
                          )
                        }
                        disabled={actionId !== null}
                        style={styles.formInput}
                      />
                    </div>

                    <div>
                      <label style={styles.formLabel}>
                        Stock
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={productStock}
                        onChange={(event) =>
                          setProductStock(
                            event.target.value
                          )
                        }
                        disabled={actionId !== null}
                        style={styles.formInput}
                      />
                    </div>

                    <div>
                      <label style={styles.formLabel}>
                        Status
                      </label>
                      <select
                        value={productStatus}
                        onChange={(event) =>
                          setProductStatus(
                            event.target.value
                          )
                        }
                        disabled={actionId !== null}
                        style={styles.formInput}
                      >
                        <option value="DRAFT">
                          DRAFT
                        </option>
                        <option value="ACTIVE">
                          ACTIVE
                        </option>
                        <option value="ARCHIVED">
                          ARCHIVED
                        </option>
                      </select>
                    </div>
                  </div>

                  <label style={styles.formLabel}>
                    Description
                  </label>
                  <textarea
                    value={productDescription}
                    maxLength={5000}
                    rows={4}
                    onChange={(event) =>
                      setProductDescription(
                        event.target.value
                      )
                    }
                    disabled={actionId !== null}
                    style={styles.formTextarea}
                    placeholder="Optional product description"
                  />

                  <div
                    style={{
                      display: "flex",
                      justifyContent: "flex-end",
                      gap: "8px",
                      marginTop: "12px"
                    }}
                  >
                    <button
                      type="button"
                      onClick={closeProductForm}
                      disabled={actionId !== null}
                      style={styles.cancelButton}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => void saveProduct()}
                      disabled={actionId !== null}
                      style={styles.confirmRestockButton}
                    >
                      {actionId
                        ? "Saving..."
                        : editingProductId
                          ? "Save Changes"
                          : "Create Product"}
                    </button>
                  </div>
                </div>
              )}
            </section>

            <section
              style={{
                border: "1px solid #dbe3ee",
                borderRadius: "14px",
                padding: "18px",
                background: "#ffffff"
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: "12px"
                }}
              >
                <strong>Categories</strong>
                <button
                  type="button"
                  onClick={() =>
                    void loadCategories()
                  }
                  disabled={
                    loadingCategories ||
                    actionId !== null
                  }
                  style={{
                    ...styles.cancelButton,
                    padding: "7px 10px"
                  }}
                >
                  {loadingCategories
                    ? "Loading..."
                    : "Refresh"}
                </button>
              </div>

              <div
                style={{
                  display: "flex",
                  gap: "8px",
                  marginBottom: "12px"
                }}
              >
                <input
                  value={categoryName}
                  maxLength={100}
                  onChange={(event) =>
                    setCategoryName(
                      event.target.value
                    )
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void createCategory();
                    }
                  }}
                  disabled={actionId !== null}
                  style={{
                    ...styles.formInput,
                    margin: 0
                  }}
                  placeholder="New category"
                />
                <button
                  type="button"
                  onClick={() => void createCategory()}
                  disabled={
                    actionId !== null ||
                    !categoryName.trim()
                  }
                  style={styles.confirmRestockButton}
                >
                  Add
                </button>
              </div>

              {categories.length === 0 ? (
                <div
                  style={{
                    color: "#64748b",
                    fontSize: "13px"
                  }}
                >
                  No categories yet.
                </div>
              ) : (
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: "8px"
                  }}
                >
                  {categories.map(
                    (category) => (
                      <div
                        key={category.id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "7px",
                          border:
                            "1px solid #dbe3ee",
                          borderRadius: "999px",
                          padding:
                            "6px 8px 6px 10px",
                          fontSize: "13px"
                        }}
                      >
                        <span>
                          {category.name}{" "}
                          <span
                            style={{
                              color: "#64748b"
                            }}
                          >
                            ({category._count?.products ?? 0})
                          </span>
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            void deleteCategory(
                              category.id,
                              category.name
                            )
                          }
                          disabled={actionId !== null}
                          style={{
                            border: "none",
                            background: "transparent",
                            cursor: "pointer",
                            color: "#b91c1c",
                            padding: "0 3px"
                          }}
                          title="Delete category"
                        >
                          ×
                        </button>
                      </div>
                    )
                  )}
                </div>
              )}
            </section>
          </div>

          {(outOfStockProducts >
            0 ||
            lowStockProducts >
            0) && (
              <div
                style={
                  styles.inventoryAlert
                }
              >
                <strong>
                  Inventory attention needed
                </strong>

                <span>
                  {outOfStockProducts >
                    0
                    ? `${outOfStockProducts} product${outOfStockProducts ===
                      1
                      ? ""
                      : "s"
                    } out of stock`
                    : "No products are out of stock"}
                  {" · "}
                  {lowStockProducts >
                    0
                    ? `${lowStockProducts} low-stock product${lowStockProducts ===
                      1
                      ? ""
                      : "s"
                    }`
                    : "No other low-stock products"}
                </span>
              </div>
            )}

          {loadingProducts ? (
            <div
              style={
                styles.emptyState
              }
            >
              Loading inventory...
            </div>
          ) : products.length ===
            0 ? (
            <div
              style={
                styles.emptyState
              }
            >
              <strong>
                No products found.
              </strong>

              <p>
                Products created for this merchant
                will appear here.
              </p>
            </div>
          ) : (
            <div
              style={
                styles.productGrid
              }
            >
              {products.map(
                (product) => {
                  const busy =
                    actionId ===
                    product.id;

                  const isRestocking =
                    restockingProductId ===
                    product.id;

                  const isOutOfStock =
                    product.stock ===
                    0;

                  const isLowStock =
                    product.stock >
                    0 &&
                    product.stock <=
                    5;

                  const quantityNumber =
                    Number(
                      restockQuantity
                    );

                  const validQuantity =
                    Number.isInteger(
                      quantityNumber
                    ) &&
                    quantityNumber >
                    0;

                  const projectedStock =
                    validQuantity
                      ? product.stock +
                      quantityNumber
                      : product.stock;

                  const exceedsQuantityLimit =
                    validQuantity &&
                    quantityNumber >
                    100000;

                  const exceedsStockLimit =
                    validQuantity &&
                    projectedStock >
                    1000000;

                  return (
                    <article
                      key={
                        product.id
                      }
                      style={{
                        ...styles.productCard,
                        ...(isOutOfStock
                          ? styles.outOfStockCard
                          : isLowStock
                            ? styles.lowStockCard
                            : {})
                      }}
                    >
                      <div
                        style={
                          styles.productTop
                        }
                      >
                        <div>
                          <span
                            style={
                              styles.productStatusLabel
                            }
                          >
                            {
                              product.status
                            }
                          </span>

                          <h3
                            style={
                              styles.productName
                            }
                          >
                            {
                              product.name
                            }
                          </h3>

                          {product.category && (
                            <span
                              style={{
                                display: "inline-block",
                                marginTop: "4px",
                                color: "#475569",
                                fontSize: "12px"
                              }}
                            >
                              {product.category.name}
                            </span>
                          )}
                        </div>

                        <span
                          style={{
                            ...styles.stockBadge,
                            ...(isOutOfStock
                              ? styles.stockBadgeOut
                              : isLowStock
                                ? styles.stockBadgeLow
                                : styles.stockBadgeGood)
                          }}
                        >
                          {isOutOfStock
                            ? "OUT OF STOCK"
                            : isLowStock
                              ? "LOW STOCK"
                              : "IN STOCK"}
                        </span>
                      </div>

                      {product.description && (
                        <p
                          style={
                            styles.productDescription
                          }
                        >
                          {
                            product.description
                          }
                        </p>
                      )}

                      <div
                        style={
                          styles.productStats
                        }
                      >
                        <div>
                          <span
                            style={
                              styles.productStatLabel
                            }
                          >
                            Price
                          </span>

                          <strong
                            style={
                              styles.productStatValue
                            }
                          >
                            {
                              product.price
                            }{" "}
                            {
                              product.currency
                            }
                          </strong>
                        </div>

                        <div>
                          <span
                            style={
                              styles.productStatLabel
                            }
                          >
                            Current stock
                          </span>

                          <strong
                            style={{
                              ...styles.productStatValue,
                              ...(isOutOfStock
                                ? styles.stockNumberOut
                                : isLowStock
                                  ? styles.stockNumberLow
                                  : {})
                            }}
                          >
                            {
                              product.stock
                            }
                          </strong>
                        </div>
                      </div>

                      {imageProductId === product.id && (
                        <div
                          style={{
                            borderTop: "1px solid #e2e8f0",
                            paddingTop: "14px",
                            marginTop: "14px"
                          }}
                        >
                          <strong
                            style={{
                              display: "block",
                              marginBottom: "10px"
                            }}
                          >
                            Product Images
                          </strong>

                          {product.images &&
                            product.images.length > 0 && (
                              <div
                                style={{
                                  display: "grid",
                                  gridTemplateColumns:
                                    "repeat(auto-fill, minmax(110px, 1fr))",
                                  gap: "8px",
                                  marginBottom: "12px"
                                }}
                              >
                                {product.images.map(
                                  (image) => (
                                    <div
                                      key={image.id}
                                      style={{
                                        border:
                                          "1px solid #dbe3ee",
                                        borderRadius: "10px",
                                        padding: "6px"
                                      }}
                                    >
                                      <img
                                        src={image.url}
                                        alt={
                                          image.altText ||
                                          product.name
                                        }
                                        style={{
                                          width: "100%",
                                          height: "80px",
                                          objectFit: "cover",
                                          borderRadius: "7px",
                                          display: "block"
                                        }}
                                      />
                                      <div
                                        style={{
                                          fontSize: "11px",
                                          marginTop: "5px",
                                          color: image.isPrimary
                                            ? "#166534"
                                            : "#64748b"
                                        }}
                                      >
                                        {image.isPrimary
                                          ? "Primary"
                                          : "Image"}
                                      </div>
                                      <div
                                        style={{
                                          display: "flex",
                                          gap: "4px",
                                          marginTop: "5px",
                                          flexWrap: "wrap"
                                        }}
                                      >
                                        {!image.isPrimary && (
                                          <button
                                            type="button"
                                            onClick={() =>
                                              void setPrimaryImage(
                                                product.id,
                                                image.id
                                              )
                                            }
                                            disabled={
                                              actionId !== null
                                            }
                                            style={{
                                              ...styles.cancelButton,
                                              fontSize: "11px",
                                              padding: "4px 6px"
                                            }}
                                          >
                                            Primary
                                          </button>
                                        )}
                                        <button
                                          type="button"
                                          onClick={() =>
                                            void deleteProductImage(
                                              product.id,
                                              image.id
                                            )
                                          }
                                          disabled={
                                            actionId !== null
                                          }
                                          style={{
                                            ...styles.cancelButton,
                                            color: "#b91c1c",
                                            fontSize: "11px",
                                            padding: "4px 6px"
                                          }}
                                        >
                                          Delete
                                        </button>
                                      </div>
                                    </div>
                                  )
                                )}
                              </div>
                            )}

                          <div
                            style={{
                              display: "grid",
                              gridTemplateColumns:
                                "minmax(0, 2fr) minmax(0, 1fr) auto",
                              gap: "8px",
                              alignItems: "end"
                            }}
                          >
                            <div>
                              <label style={styles.formLabel}>
                                Image URL
                              </label>
                              <input
                                value={imageUrl}
                                onChange={(event) =>
                                  setImageUrl(
                                    event.target.value
                                  )
                                }
                                disabled={
                                  actionId !== null
                                }
                                style={styles.formInput}
                                placeholder="https://..."
                              />
                            </div>

                            <div>
                              <label style={styles.formLabel}>
                                Alt text
                              </label>
                              <input
                                value={imageAltText}
                                maxLength={300}
                                onChange={(event) =>
                                  setImageAltText(
                                    event.target.value
                                  )
                                }
                                disabled={
                                  actionId !== null
                                }
                                style={styles.formInput}
                                placeholder="Optional"
                              />
                            </div>

                            <button
                              type="button"
                              onClick={() =>
                                void addProductImage(
                                  product.id
                                )
                              }
                              disabled={
                                actionId !== null ||
                                !imageUrl.trim()
                              }
                              style={
                                styles.confirmRestockButton
                              }
                            >
                              Add Image
                            </button>
                          </div>
                        </div>
                      )}

                      {isRestocking ? (
                        <div
                          style={
                            styles.restockPanel
                          }
                        >
                          <strong
                            style={
                              styles.restockTitle
                            }
                          >
                            Restock{" "}
                            {
                              product.name
                            }
                          </strong>

                          <p
                            style={
                              styles.restockCurrentStock
                            }
                          >
                            Current stock:{" "}
                            <strong>
                              {
                                product.stock
                              }
                            </strong>
                          </p>

                          <label
                            style={
                              styles.formLabel
                            }
                          >
                            Quantity to add
                          </label>

                          <input
                            type="number"
                            min="1"
                            max="100000"
                            step="1"
                            value={
                              restockQuantity
                            }
                            onChange={(
                              event
                            ) =>
                              setRestockQuantity(
                                event
                                  .target
                                  .value
                              )
                            }
                            placeholder="Example: 10"
                            disabled={
                              busy
                            }
                            style={
                              styles.formInput
                            }
                          />

                          {validQuantity && (
                            <div
                              style={
                                styles.projectedStock
                              }
                            >
                              <span>
                                New stock after restock
                              </span>

                              <strong>
                                {
                                  projectedStock
                                }
                              </strong>
                            </div>
                          )}

                          {exceedsQuantityLimit && (
                            <p
                              style={
                                styles.formWarning
                              }
                            >
                              Maximum restock quantity
                              is 100,000 units.
                            </p>
                          )}

                          {exceedsStockLimit && (
                            <p
                              style={
                                styles.formWarning
                              }
                            >
                              Resulting stock cannot
                              exceed 1,000,000 units.
                            </p>
                          )}

                          <label
                            style={
                              styles.formLabel
                            }
                          >
                            Note{" "}
                            <span
                              style={
                                styles.optionalLabel
                              }
                            >
                              (optional)
                            </span>
                          </label>

                          <textarea
                            value={
                              restockNote
                            }
                            onChange={(
                              event
                            ) =>
                              setRestockNote(
                                event
                                  .target
                                  .value
                              )
                            }
                            placeholder="Example: New shipment received"
                            disabled={
                              busy
                            }
                            rows={3}
                            maxLength={500}
                            style={
                              styles.formTextarea
                            }
                          />

                          <span
                            style={
                              styles.characterCount
                            }
                          >
                            {
                              restockNote.length
                            }
                            /500
                          </span>

                          <div
                            style={
                              styles.restockActions
                            }
                          >
                            <button
                              type="button"
                              disabled={
                                busy
                              }
                              onClick={
                                cancelRestock
                              }
                              style={
                                styles.cancelButton
                              }
                            >
                              Cancel
                            </button>

                            <button
                              type="button"
                              disabled={
                                busy ||
                                !validQuantity ||
                                exceedsQuantityLimit ||
                                exceedsStockLimit
                              }
                              onClick={() =>
                                void restockProduct(
                                  product.id
                                )
                              }
                              style={
                                styles.confirmRestockButton
                              }
                            >
                              {busy
                                ? "Adding Stock..."
                                : `Add ${validQuantity ? quantityNumber : ""} Stock`}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div
                          style={
                            styles.productFooter
                          }
                        >
                          <span
                            style={
                              styles.productUpdated
                            }
                          >
                            Updated{" "}
                            {new Date(
                              product.updatedAt
                            ).toLocaleString()}
                          </span>

                          <div
                            style={{
                              display: "flex",
                              gap: "7px",
                              flexWrap: "wrap",
                              justifyContent: "flex-end"
                            }}
                          >
                            <button
                              type="button"
                              disabled={
                                busy ||
                                actionId !== null
                              }
                              onClick={() =>
                                openEditProductForm(product)
                              }
                              style={styles.cancelButton}
                            >
                              Edit
                            </button>

                            <button
                              type="button"
                              disabled={
                                busy ||
                                actionId !== null
                              }
                              onClick={() => {
                                setImageProductId(
                                  imageProductId === product.id
                                    ? null
                                    : product.id
                                );
                                setImageUrl("");
                                setImageAltText("");
                                setError("");
                              }}
                              style={styles.cancelButton}
                            >
                              {imageProductId === product.id
                                ? "Hide Images"
                                : "Images"}
                            </button>

                            <button
                              type="button"
                              disabled={
                                busy ||
                                actionId !== null
                              }
                              onClick={() =>
                                openRestockForm(product.id)
                              }
                              style={styles.restockButton}
                            >
                              Restock
                            </button>

                            <button
                              type="button"
                              disabled={
                                busy ||
                                actionId !== null
                              }
                              onClick={() =>
                                void deleteProduct(
                                  product.id,
                                  product.name
                                )
                              }
                              style={{
                                ...styles.cancelButton,
                                color: "#b91c1c"
                              }}
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      )}
                    </article>
                  );
                }
              )}
            </div>
          )}
        </section>
      )}
    </main>
  );
}

function Detail({
  label,
  value
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div>
      <span
        style={
          styles.detailLabel
        }
      >
        {label}
      </span>

      <strong>
        {value}
      </strong>
    </div>
  );
}

function getStatusStyle(
  status: string
) {
  if (status === "PAID") {
    return {
      background: "#ecfdf3",
      color: "#067647"
    };
  }

  if (
    status === "FULFILLING"
  ) {
    return {
      background: "#eff8ff",
      color: "#175cd3"
    };
  }

  if (
    status === "FULFILLED"
  ) {
    return {
      background: "#f2f4f7",
      color: "#344054"
    };
  }

  if (
    status === "PAYMENT_REVIEW"
  ) {
    return {
      background: "#fff4e5",
      color: "#b54708"
    };
  }

  if (
    status === "PENDING_PAYMENT"
  ) {
    return {
      background: "#fef3f2",
      color: "#b42318"
    };
  }

  return {
    background: "#f2f4f7",
    color: "#344054"
  };
}

const styles: Record<
  string,
  React.CSSProperties
> = {
  page: {
    minHeight: "100vh",
    background: "#f5f7fb",
    color: "#172033",
    fontFamily:
      "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
    padding: "32px",
    boxSizing: "border-box"
  },

  loginPage: {
    minHeight: "100vh",
    background: "#f5f7fb",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "24px",
    boxSizing: "border-box",
    fontFamily:
      "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
  },

  loginCard: {
    width: "100%",
    maxWidth: "420px",
    background: "#ffffff",
    border: "1px solid #e4e7ec",
    borderRadius: "16px",
    padding: "32px",
    boxShadow:
      "0 10px 30px rgba(16, 24, 40, 0.08)",
    boxSizing: "border-box"
  },

  loginHeader: {
    textAlign: "center",
    marginBottom: "28px"
  },

  loginTitle: {
    margin: 0,
    fontSize: "26px"
  },

  loginSubtitle: {
    margin: "8px 0 0",
    color: "#667085"
  },

  loginInput: {
    width: "100%",
    boxSizing: "border-box",
    border: "1px solid #d0d5dd",
    borderRadius: "8px",
    padding: "12px",
    fontFamily: "inherit",
    fontSize: "14px",
    background: "#ffffff",
    outline: "none",
    marginBottom: "4px"
  },

  loginButton: {
    width: "100%",
    border: "none",
    background: "#175cd3",
    color: "#ffffff",
    padding: "12px 16px",
    borderRadius: "8px",
    cursor: "pointer",
    fontWeight: 700,
    fontSize: "15px",
    marginTop: "18px"
  },

  signedInUser: {
    margin: "6px 0 0",
    color: "#667085",
    fontSize: "13px"
  },

  header: {
    maxWidth: "1200px",
    margin: "0 auto 28px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "20px"
  },

  headerActions: {
    display: "flex",
    gap: "10px",
    alignItems: "center"
  },

  title: {
    margin: 0,
    fontSize: "32px",
    lineHeight: 1.15
  },

  subtitle: {
    margin: "8px 0 0",
    color: "#667085",
    fontSize: "16px"
  },

  refreshButton: {
    border: "1px solid #d0d5dd",
    background: "#ffffff",
    color: "#344054",
    padding: "10px 18px",
    borderRadius: "8px",
    cursor: "pointer",
    fontWeight: 600
  },

  logoutButton: {
    border: "1px solid #f04438",
    background: "#ffffff",
    color: "#b42318",
    padding: "10px 18px",
    borderRadius: "8px",
    cursor: "pointer",
    fontWeight: 700
  },

  summary: {
    maxWidth: "1200px",
    margin: "0 auto 24px",
    display: "grid",
    gridTemplateColumns:
      "repeat(auto-fit, minmax(220px, 1fr))",
    gap: "16px"
  },

  summaryCard: {
    background: "#ffffff",
    border: "1px solid #e4e7ec",
    borderRadius: "12px",
    padding: "20px",
    boxShadow:
      "0 1px 2px rgba(16, 24, 40, 0.04)"
  },

  summaryLabel: {
    display: "block",
    color: "#667085",
    fontSize: "14px",
    marginBottom: "8px"
  },

  summaryValue: {
    fontSize: "30px"
  },

  summaryHint: {
    display: "block",
    marginTop: "6px",
    color: "#667085",
    fontSize: "12px"
  },

  tabs: {
    maxWidth: "1200px",
    margin: "0 auto 24px",
    display: "flex",
    gap: "4px",
    borderBottom:
      "1px solid #d0d5dd"
  },

  tab: {
    border: "none",
    background: "transparent",
    color: "#667085",
    padding: "12px 18px",
    cursor: "pointer",
    fontWeight: 700,
    fontSize: "14px",
    borderBottom:
      "3px solid transparent",
    display: "flex",
    alignItems: "center",
    gap: "8px"
  },

  activeTab: {
    color: "#172033",
    borderBottomColor:
      "#172033"
  },

  tabCount: {
    minWidth: "20px",
    height: "20px",
    borderRadius: "999px",
    background: "#f04438",
    color: "#ffffff",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "11px"
  },

  inventoryWarningCount: {
    minWidth: "20px",
    height: "20px",
    borderRadius: "999px",
    background: "#f04438",
    color: "#ffffff",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "11px"
  },

  inventoryLowCount: {
    minWidth: "20px",
    height: "20px",
    borderRadius: "999px",
    background: "#f79009",
    color: "#ffffff",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "11px"
  },

  error: {
    maxWidth: "1200px",
    margin: "0 auto 16px",
    padding: "14px 16px",
    borderRadius: "8px",
    background: "#fef3f2",
    border:
      "1px solid #fecdca",
    color: "#b42318"
  },

  success: {
    maxWidth: "1200px",
    margin: "0 auto 16px",
    padding: "14px 16px",
    borderRadius: "8px",
    background: "#ecfdf3",
    border:
      "1px solid #abefc6",
    color: "#067647"
  },

  section: {
    maxWidth: "1200px",
    margin: "0 auto"
  },

  sectionHeader: {
    marginBottom: "16px",
    display: "flex",
    justifyContent:
      "space-between",
    alignItems: "flex-start",
    gap: "16px",
    flexWrap: "wrap"
  },

  sectionTitle: {
    margin: 0,
    fontSize: "22px"
  },

  sectionDescription: {
    margin: "6px 0 0",
    color: "#667085"
  },

  inventoryRefreshButton: {
    border: "1px solid #d0d5dd",
    background: "#ffffff",
    color: "#344054",
    padding: "9px 14px",
    borderRadius: "8px",
    cursor: "pointer",
    fontWeight: 700
  },

  inventoryAlert: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    flexWrap: "wrap",
    marginBottom: "16px",
    padding: "14px 16px",
    borderRadius: "10px",
    background: "#fffaeb",
    border:
      "1px solid #fedf89",
    color: "#93370d"
  },

  reviewList: {
    display: "grid",
    gap: "16px"
  },

  reviewCard: {
    background: "#ffffff",
    border:
      "1px solid #e4e7ec",
    borderRadius: "12px",
    padding: "22px",
    boxShadow:
      "0 1px 3px rgba(16, 24, 40, 0.05)"
  },

  cardTop: {
    display: "flex",
    justifyContent:
      "space-between",
    alignItems: "flex-start",
    gap: "16px",
    marginBottom: "20px"
  },

  orderLabel: {
    display: "block",
    color: "#667085",
    fontSize: "13px"
  },

  orderNumber: {
    margin: "4px 0 0",
    fontSize: "20px"
  },

  customer: {
    display: "block",
    marginTop: "4px",
    color: "#667085",
    fontSize: "14px"
  },

  badge: {
    display: "inline-flex",
    padding: "6px 10px",
    borderRadius: "999px",
    background: "#fff4e5",
    color: "#b54708",
    fontSize: "12px",
    fontWeight: 700
  },

  orderBadge: {
    display: "inline-flex",
    padding: "6px 10px",
    borderRadius: "999px",
    fontSize: "12px",
    fontWeight: 700
  },

  details: {
    display: "grid",
    gridTemplateColumns:
      "repeat(auto-fit, minmax(180px, 1fr))",
    gap: "18px",
    padding: "18px 0",
    borderTop:
      "1px solid #eaecf0",
    borderBottom:
      "1px solid #eaecf0"
  },

  detailLabel: {
    display: "block",
    color: "#667085",
    fontSize: "12px",
    marginBottom: "5px"
  },

  itemsBox: {
    background: "#f9fafb",
    border:
      "1px solid #eaecf0",
    borderRadius: "8px",
    padding: "12px 14px",
    marginBottom: "4px"
  },

  itemRow: {
    display: "flex",
    justifyContent:
      "space-between",
    gap: "16px",
    padding: "7px 0",
    fontSize: "14px"
  },

  rejectPanel: {
    marginTop: "18px",
    padding: "18px",
    background: "#fff7f6",
    border:
      "1px solid #fecdca",
    borderRadius: "10px"
  },

  rejectTitle: {
    display: "block",
    color: "#b42318",
    fontSize: "16px",
    marginBottom: "5px"
  },

  rejectDescription: {
    margin: "0 0 14px",
    color: "#667085",
    fontSize: "14px",
    lineHeight: 1.5
  },

  rejectTextarea: {
    width: "100%",
    boxSizing: "border-box",
    border:
      "1px solid #d0d5dd",
    borderRadius: "8px",
    padding: "12px",
    fontFamily: "inherit",
    fontSize: "14px",
    lineHeight: 1.5,
    resize: "vertical",
    outline: "none",
    background: "#ffffff"
  },

  rejectActions: {
    display: "flex",
    justifyContent:
      "flex-end",
    gap: "10px",
    marginTop: "12px"
  },

  cancelButton: {
    border:
      "1px solid #d0d5dd",
    background: "#ffffff",
    color: "#344054",
    padding: "10px 16px",
    borderRadius: "8px",
    cursor: "pointer",
    fontWeight: 700
  },

  confirmRejectButton: {
    border: "none",
    background: "#b42318",
    color: "#ffffff",
    padding: "10px 16px",
    borderRadius: "8px",
    cursor: "pointer",
    fontWeight: 700
  },

  cardFooter: {
    display: "flex",
    justifyContent:
      "space-between",
    alignItems: "center",
    gap: "16px",
    flexWrap: "wrap",
    paddingTop: "18px"
  },

  date: {
    color: "#667085",
    fontSize: "13px"
  },

  actions: {
    display: "flex",
    gap: "10px",
    alignItems: "center"
  },

  verifyButton: {
    border: "none",
    background: "#067647",
    color: "#ffffff",
    padding: "10px 16px",
    borderRadius: "8px",
    cursor: "pointer",
    fontWeight: 700
  },

  rejectButton: {
    border:
      "1px solid #f04438",
    background: "#ffffff",
    color: "#b42318",
    padding: "10px 16px",
    borderRadius: "8px",
    cursor: "pointer",
    fontWeight: 700
  },

  fulfillButton: {
    border: "none",
    background: "#175cd3",
    color: "#ffffff",
    padding: "10px 16px",
    borderRadius: "8px",
    cursor: "pointer",
    fontWeight: 700
  },

  completed: {
    color: "#067647",
    fontWeight: 700,
    fontSize: "14px"
  },

  productGrid: {
    display: "grid",
    gridTemplateColumns:
      "repeat(auto-fit, minmax(320px, 1fr))",
    gap: "16px"
  },

  productCard: {
    background: "#ffffff",
    border:
      "1px solid #e4e7ec",
    borderRadius: "12px",
    padding: "20px",
    boxShadow:
      "0 1px 3px rgba(16, 24, 40, 0.05)"
  },

  outOfStockCard: {
    border:
      "1px solid #fecdca"
  },

  lowStockCard: {
    border:
      "1px solid #fedf89"
  },

  productTop: {
    display: "flex",
    justifyContent:
      "space-between",
    alignItems: "flex-start",
    gap: "12px",
    marginBottom: "14px"
  },

  productStatusLabel: {
    display: "block",
    color: "#667085",
    fontSize: "12px",
    textTransform: "uppercase",
    fontWeight: 700,
    letterSpacing: "0.03em"
  },

  productName: {
    margin: "5px 0 0",
    fontSize: "19px"
  },

  stockBadge: {
    display: "inline-flex",
    padding: "6px 9px",
    borderRadius: "999px",
    fontSize: "11px",
    fontWeight: 800,
    whiteSpace: "nowrap"
  },

  stockBadgeGood: {
    background: "#ecfdf3",
    color: "#067647"
  },

  stockBadgeLow: {
    background: "#fff4e5",
    color: "#b54708"
  },

  stockBadgeOut: {
    background: "#fef3f2",
    color: "#b42318"
  },

  productDescription: {
    margin: "0 0 16px",
    color: "#667085",
    fontSize: "14px",
    lineHeight: 1.5
  },

  productStats: {
    display: "grid",
    gridTemplateColumns:
      "1fr 1fr",
    gap: "12px",
    padding: "16px 0",
    borderTop:
      "1px solid #eaecf0",
    borderBottom:
      "1px solid #eaecf0"
  },

  productStatLabel: {
    display: "block",
    color: "#667085",
    fontSize: "12px",
    marginBottom: "5px"
  },

  productStatValue: {
    fontSize: "18px"
  },

  stockNumberOut: {
    color: "#b42318"
  },

  stockNumberLow: {
    color: "#b54708"
  },

  productFooter: {
    display: "flex",
    justifyContent:
      "space-between",
    alignItems: "center",
    gap: "12px",
    paddingTop: "16px"
  },

  productUpdated: {
    color: "#667085",
    fontSize: "12px"
  },

  restockButton: {
    border: "none",
    background: "#175cd3",
    color: "#ffffff",
    padding: "10px 16px",
    borderRadius: "8px",
    cursor: "pointer",
    fontWeight: 700
  },

  restockPanel: {
    marginTop: "16px",
    padding: "16px",
    background: "#f9fafb",
    border:
      "1px solid #eaecf0",
    borderRadius: "10px"
  },

  restockTitle: {
    display: "block",
    fontSize: "16px",
    marginBottom: "6px"
  },

  restockCurrentStock: {
    margin: "0 0 14px",
    color: "#667085",
    fontSize: "13px"
  },

  formLabel: {
    display: "block",
    fontSize: "13px",
    fontWeight: 700,
    color: "#344054",
    marginBottom: "6px",
    marginTop: "12px"
  },

  optionalLabel: {
    color: "#98a2b3",
    fontWeight: 400
  },

  formInput: {
    width: "100%",
    boxSizing: "border-box",
    border:
      "1px solid #d0d5dd",
    borderRadius: "8px",
    padding: "10px 12px",
    fontFamily: "inherit",
    fontSize: "14px",
    background: "#ffffff",
    outline: "none"
  },

  formTextarea: {
    width: "100%",
    boxSizing: "border-box",
    border:
      "1px solid #d0d5dd",
    borderRadius: "8px",
    padding: "10px 12px",
    fontFamily: "inherit",
    fontSize: "14px",
    lineHeight: 1.5,
    resize: "vertical",
    background: "#ffffff",
    outline: "none"
  },

  projectedStock: {
    display: "flex",
    justifyContent:
      "space-between",
    alignItems: "center",
    gap: "12px",
    marginTop: "10px",
    padding: "10px 12px",
    borderRadius: "8px",
    background: "#ecfdf3",
    border:
      "1px solid #abefc6",
    color: "#067647",
    fontSize: "13px"
  },

  formWarning: {
    margin: "8px 0 0",
    color: "#b42318",
    fontSize: "12px",
    fontWeight: 600
  },

  characterCount: {
    display: "block",
    marginTop: "5px",
    textAlign: "right",
    color: "#98a2b3",
    fontSize: "11px"
  },

  restockActions: {
    display: "flex",
    justifyContent:
      "flex-end",
    gap: "10px",
    marginTop: "16px"
  },

  confirmRestockButton: {
    border: "none",
    background: "#067647",
    color: "#ffffff",
    padding: "10px 16px",
    borderRadius: "8px",
    cursor: "pointer",
    fontWeight: 700
  },

  emptyState: {
    background: "#ffffff",
    border:
      "1px solid #e4e7ec",
    borderRadius: "12px",
    padding: "48px 24px",
    textAlign: "center",
    color: "#667085"
  }
};
