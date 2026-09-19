import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(
  new URL("../src/App.tsx", import.meta.url),
  "utf8"
);

describe("category image management UI contract", () => {
  it("models category image metadata", () => {
    expect(appSource).toContain(
      "imageUrl: string | null;"
    );
    expect(appSource).toContain(
      "imageAltText: string | null;"
    );
  });

  it("keeps category image state separate from product image state", () => {
    expect(appSource).toContain(
      "categoryImageCategoryId"
    );
    expect(appSource).toContain(
      "categoryImageFile"
    );
    expect(appSource).toContain(
      "setCategoryImageCategoryId"
    );
    expect(appSource).toContain(
      "setCategoryImageFile"
    );
  });

  it("uses the dedicated category image upload endpoint", () => {
    expect(appSource).toContain(
      "async function uploadCategoryImage("
    );
    expect(appSource).toContain(
      "`/merchants/${merchantId}/products/categories/${categoryId}/image/upload`"
    );
    expect(appSource).toContain(
      'formData.append('
    );
    expect(appSource).toContain(
      '"image",'
    );
    expect(appSource).toContain(
      "categoryImageFile"
    );
  });

  it("removes category images through the metadata endpoint", () => {
    expect(appSource).toContain(
      "async function removeCategoryImage("
    );
    expect(appSource).toContain(
      "`/merchants/${merchantId}/products/categories/${categoryId}/image`"
    );
    expect(appSource).toContain(
      'method: "PATCH"'
    );
    expect(appSource).toContain(
      "imageUrl: null"
    );
    expect(appSource).toContain(
      "imageAltText: null"
    );
  });

  it("requires explicit confirmation before removing a category image", () => {
    expect(appSource).toContain(
      "categoryImageRemoval"
    );
    expect(appSource).toContain(
      "setCategoryImageRemoval"
    );
    expect(appSource).toContain(
      'aria-label="Confirm category image removal"'
    );
    expect(appSource).toContain(
      "Remove Category Image?"
    );
    expect(appSource).toContain(
      "The category and its products"
    );
    expect(appSource).toContain(
      "setCategoryImageRemoval(null)"
    );
    expect(appSource).toContain(
      "void removeCategoryImage("
    );
  });

  it("opens category images in a full-screen preview", () => {
    expect(appSource).toContain(
      "categoryImagePreview"
    );
    expect(appSource).toContain(
      "setCategoryImagePreview"
    );
    expect(appSource).toContain(
      'aria-label="Category image preview"'
    );
    expect(appSource).toContain(
      'title="View full image"'
    );
    expect(appSource).toContain(
      'event.key === "Escape"'
    );
    expect(appSource).toContain(
      "setCategoryImagePreview(null)"
    );
  });

  it("opens product images in the shared full-screen preview", () => {
    expect(appSource).toContain(
      "product.images.map("
    );
    expect(appSource).toContain(
      "url: image.url"
    );
    expect(appSource).toContain(
      "image.altText ||"
    );
    expect(appSource).toContain(
      "product.name"
    );
    expect(appSource).toContain(
      'title="View full image"'
    );
  
    expect(appSource).toContain(
      "async function setPrimaryImage("
    );
    expect(appSource).toContain(
      "async function deleteProductImage("
    );
  });

  it("shows category image presentation without replacing product image management", () => {
    expect(appSource).toContain(
      "category.imageUrl"
    );
    expect(appSource).toContain(
      "category.imageAltText ||"
    );
    expect(appSource).toContain(
      "No category image"
    );

    expect(appSource).toContain(
      "async function addProductImage(productId: string)"
    );
    expect(appSource).toContain(
      "`/merchants/${merchantId}/products/${productId}/images/upload`"
    );
  });

  it("offers add replace and remove category image controls", () => {
    expect(appSource).toContain(
      '? "Replace Image"'
    );
    expect(appSource).toContain(
      ': "Add Image"'
    );
    expect(appSource).toContain(
      '"Remove Image"'
    );
    expect(appSource).toContain(
      '"Upload Image"'
    );
  });

  it("restricts category image mutation controls to catalog managers", () => {
    expect(appSource).toContain(
      "{canManageProducts && ("
    );
    expect(appSource).toContain(
      "You do not have permission to manage category images."
    );
  });

  it("accepts only supported category image file types in the UI", () => {
    expect(appSource).toContain(
      'accept="image/jpeg,image/png,image/webp"'
    );
  });
});