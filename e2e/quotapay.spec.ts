import { test, expect } from "@playwright/test";

const ADMIN = "0x1111111111111111111111111111111111111111";
const PAYMASTER = "0x2222222222222222222222222222222222222222";
const BOB = "0x4444444444444444444444444444444444444444";
const RECIPIENT = "0x5555555555555555555555555555555555555555";

test("QuotaPay UI: register company, add paymaster, add users, pay", async ({
  page,
}) => {
  // 1. The beneficiary's browser session key is the wallet the admin authorizes.
  let sessionAddress = "";
  await test.step("beneficiary session key is generated", async () => {
    await page.goto("/pay");
    const session = page.getByTestId("session-address");
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

  // 5. The authorized beneficiary builds/signs a four-frame sponsored payment.
  await test.step("beneficiary builds and signs a sponsored payment", async () => {
    await page.goto("/pay");
    await expect(page.getByLabel("Paymaster")).toHaveValue(PAYMASTER);
    await expect(page.getByTestId("session-address")).toHaveText(sessionAddress);

    await page.getByLabel("Recipient").fill(RECIPIENT);
    await page.getByLabel("Amount (ETH)").fill("0.001");
    await page.getByRole("button", { name: /build & sign/i }).click();

    const signed = page.getByTestId("signed-tx");
    await expect(signed).toBeVisible();
    await expect(signed).toContainText("Signed frame transaction");
    await expect(signed).toContainText("Frames");
    await expect(signed.getByText("#0", { exact: false })).toBeVisible();
    await expect(signed.getByText("#3", { exact: false })).toBeVisible();
  });

  // 6. Submission is refused while demo submit is disabled.
  await test.step("submission is guarded while submit is disabled", async () => {
    await page.getByRole("button", { name: /submit sponsored tx/i }).click();
    await expect(page.getByText(/Submission is disabled/i)).toBeVisible();
  });

  // 7. Blind token issuance + redemption path.
  await test.step("issue a session-bound blind token and use it", async () => {
    await page.goto("/blind");
    await expect(page.getByTestId("blind-session")).toHaveText(sessionAddress);
    await page.getByLabel("Paymaster").fill(PAYMASTER);
    await page.getByLabel("Epoch").fill("0");
    await page.getByLabel("Max cost (ETH)").fill("0.002");
    await page.getByTestId("blind-create").click();
    await expect(page.getByTestId("blind-blinded")).toBeVisible();

    await page.getByTestId("blind-sign").click();
    await expect(page.getByTestId("blind-signed")).toBeVisible();

    await page.getByTestId("blind-finalize").click();
    await expect(page.getByTestId("blind-token")).toBeVisible();
    await expect(page.getByTestId("blind-token")).toContainText("verified");
    await expect(page.getByTestId("blind-signature")).toHaveText(
      /^0x[0-9a-fA-F]{384}$/,
    );

    await page.goto("/pay");
    await expect(page.getByLabel("Paymaster")).toHaveValue(PAYMASTER);
    await expect(page.getByTestId("charge-mode")).toContainText("Blind token");
    await page.getByLabel("Recipient").fill(RECIPIENT);
    await page.getByLabel("Amount (ETH)").fill("0.001");
    await page.getByRole("button", { name: /build & sign/i }).click();
    await expect(page.getByTestId("signed-tx")).toBeVisible();
  });
});
