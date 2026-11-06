import { test, expect } from "@playwright/test";

const routes = [
  "/",
  "/dao/atlas-collective",
  "/dao/atlas-collective/chat",
  "/new",
  "/join/ATLAS-1",
  "/sponsorship",
  "/sponsorship/pay",
  "/sponsorship/admin",
  "/sponsorship/company/new",
  "/sponsorship/blind",
];

test("no React hydration errors on any route", async ({ page }) => {
  const problems: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" && /hydration/i.test(msg.text())) {
      problems.push(`console: ${msg.text().slice(0, 200)}`);
    }
  });
  page.on("pageerror", (error) => {
    if (/hydration/i.test(error.message)) {
      problems.push(`pageerror: ${error.message.slice(0, 200)}`);
    }
  });

  for (const route of routes) {
    await page.goto(route);
    await expect(
      page.getByRole("banner").getByText("QuotaPay"),
      `${route} header renders`,
    ).toBeVisible();
  }

  expect(problems, "hydration errors").toEqual([]);
});
