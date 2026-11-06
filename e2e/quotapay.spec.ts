import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const ADMIN = "0x1111111111111111111111111111111111111111";
const PAYMASTER = "0x2222222222222222222222222222222222222222";
const BOB = "0x4444444444444444444444444444444444444444";
const RECIPIENT = "0x5555555555555555555555555555555555555555";

const hasProverAssets = fs.existsSync(
  path.resolve("public/zk/Membership_final.zkey"),
);

test("QuotaPay UI: register company, add paymaster, add users, pay", async ({
  page,
}) => {
  // 1. The beneficiary's browser session key is the wallet the admin authorizes.
  let sessionAddress = "";
  await test.step("beneficiary session key is generated", async () => {
    await page.goto("/pay");
    const session = page.getByTestId("zk-session");
    await expect(session).toHaveText(/^0x[0-9a-fA-F]{40}$/);
    sessionAddress = (await session.textContent())?.trim() ?? "";
    expect(sessionAddress).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  // 2. Company registration + attaching a paymaster (demo mode saves locally).
  await test.step("admin registers a company with a paymaster", async () => {
    await page.goto("/company/new");
    await page.getByLabel("Company ID").fill("acme");
    await page.getByLabel("Admin address").fill(ADMIN);
    await page.getByLabel("Treasury address").fill(ADMIN);
    await page.getByLabel("Existing paymaster (optional)").fill(PAYMASTER);
    await page.getByRole("button", { name: /create company/i }).click();

    const created = page.getByTestId("company-created");
    await expect(created).toBeVisible();
    await expect(created).toContainText("Saved in demo mode");
    await expect(created).toContainText(PAYMASTER);
    await expect(created).toContainText("acme");
  });

  // 3. Admin dashboard is prefilled from the local company/paymaster record.
  await test.step("admin authorizes the beneficiary wallet", async () => {
    await page.goto("/admin");
    await expect(page.getByLabel("Company ID")).toHaveValue("acme");
    await expect(page.getByLabel("Paymaster address")).toHaveValue(PAYMASTER);

    await page.getByLabel("Beneficiary ID").fill("alice");
    await page.getByLabel("Wallet").fill(sessionAddress);
    await page.getByLabel("Credits / period").fill("100");
    await page.getByRole("button", { name: /authorize wallet/i }).click();

    const alice = page
      .getByTestId("beneficiary-row")
      .filter({ hasText: "alice" });
    await expect(alice).toBeVisible();
    await expect(alice).toContainText("active");
    await expect(alice).toContainText(sessionAddress.slice(0, 8));
  });

  // 4. A second user can be added and revoked.
  await test.step("admin adds and revokes a second wallet", async () => {
    await page.getByLabel("Beneficiary ID").fill("bob");
    await page.getByLabel("Wallet").fill(BOB);
    await page.getByRole("button", { name: /authorize wallet/i }).click();

    const bob = page.getByTestId("beneficiary-row").filter({ hasText: "bob" });
    await expect(bob).toBeVisible();
    await expect(bob).toContainText("active");

    await bob.getByRole("button", { name: /revoke/i }).click();
    await expect(bob).toContainText("revoked");
  });

  // 5. The default path: load a ZK credential, prove, build the payment.
  await test.step("beneficiary loads a ZK credential and builds a payment", async () => {
    test.skip(
      !hasProverAssets,
      "run npm run zk:publish before the ZK browser test",
    );
    const credential = fs.readFileSync(
      path.resolve("test/fixtures/zk/credential.json"),
      "utf8",
    );
    await page.goto("/pay");
    await expect(page.getByTestId("zk-session")).toHaveText(sessionAddress);

    await page.locator("textarea").fill(credential);
    await page.getByRole("button", { name: "Use credential" }).click();
    await expect(page.getByText(/Credential loaded in this browser/)).toBeVisible();

    await page.getByTestId("zk-prove").click();
    await expect(page.getByTestId("zk-proof")).toBeVisible({ timeout: 60_000 });

    await page.locator("#zk-to").fill(RECIPIENT);
    await page.getByTestId("zk-build").click();
    await expect(page.getByTestId("zk-signed")).toContainText("4 frames");
  });
  // 6. Submission is refused while demo submit is disabled.
  await test.step("submission is guarded while submit is disabled", async () => {
    await page.getByRole("button", { name: /submit sponsored tx/i }).click();
    await expect(page.getByText(/Submission is disabled/i)).toBeVisible();
  });
});
