import { join } from "node:path";
import { expect } from "@playwright/test";

/** Guard against unstyled fields and clipped dialogs in the emitted application. */
export async function verifyAccessDialog(page, directory, screenshot) {
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  for (const field of await dialog
    .locator('input:not([type="checkbox"]):not([type="radio"]), textarea')
    .all()) {
    await expect(field).toBeVisible();
    expect(
      await field.evaluate((element) => {
        const style = getComputedStyle(element);
        const bounds = element.getBoundingClientRect();
        return (
          bounds.width > 120 &&
          bounds.height >= 40 &&
          Number.parseFloat(style.borderTopWidth) > 0 &&
          style.borderTopStyle !== "none" &&
          style.color !== style.backgroundColor
        );
      }),
    ).toBe(true);
  }
  const submit = dialog.getByRole("button", {
    name: /Save role|Create organization|Send invitation/,
  });
  await submit.scrollIntoViewIfNeeded();
  await expect(submit).toBeInViewport();
  expect(
    await dialog.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return bounds.left >= 0 && bounds.right <= innerWidth && bounds.bottom <= innerHeight;
    }),
  ).toBe(true);
  await page.screenshot({ path: join(directory, screenshot) });
}
