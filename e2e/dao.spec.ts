import { test, expect, type Page } from "@playwright/test";

async function sendPrompt(page: Page, prompt: string) {
  await page.getByTestId("dao-prompt").fill(prompt);
  await page.getByTestId("dao-send").click();
  return page.getByTestId("dao-plan").last();
}

test("plans, admin signatures and prompt-injection refusal", async ({ page }) => {
  await page.goto("/dao");
  await expect(
    page.getByRole("heading", { name: /operator console/i }),
  ).toBeVisible();
  await expect(page.getByTestId("dao-member-row").first()).toBeVisible();

  const removePlan = await sendPrompt(page, "Remove Arjun");
  await expect(removePlan).toContainText("Remove Arjun");
  await expect(removePlan).toContainText("Tier 2");
  await expect(removePlan).toContainText("Arjun K.");

  await removePlan
    .getByRole("button", { name: /request admin signature/i })
    .click();
  await expect(page.getByTestId("signature-dialog")).toBeVisible();
  await page.getByTestId("dao-simulate-signature").click();
  await expect(removePlan).toContainText("Executed");

  const arjun = page
    .getByTestId("dao-member-row")
    .filter({ hasText: "Arjun K." });
  await expect(arjun).toContainText("removed");

  const payPlan = await sendPrompt(page, "Pay October contributors $150");
  await expect(payPlan).toContainText("Tier 1");
  await expect(payPlan).toContainText("Pay 3 contributors");
  await payPlan.getByTestId("dao-execute").click();
  await expect(payPlan).toContainText("Executed");

  await page.getByTestId("dao-attack").click();
  const refusal = page.getByTestId("dao-refusal").last();
  await expect(refusal).toContainText(/Refused: prompt injection/i);
  await expect(refusal).toContainText(/Untrusted text is data/i);
});

test("over-cap spend becomes a proposal that can be voted and executed", async ({
  page,
}) => {
  await page.goto("/dao");

  const plan = await sendPrompt(page, "$800 spend for the design team");
  await expect(plan).toContainText("Tier 3");
  await page.getByTestId("dao-tab-proposals").click();

  await plan.getByRole("button", { name: /open proposal/i }).click();
  const proposal = page.getByTestId("dao-proposal").first();
  await expect(proposal).toContainText("open");

  await proposal.getByRole("button", { name: /vote privately/i }).click();
  await page.getByTestId("dao-vote-yes").click();
  await expect(page.getByText(/Vote recorded/i)).toBeVisible({
    timeout: 10_000,
  });

  await proposal.getByRole("button", { name: /\+3 votes/i }).click();
  await proposal.getByTestId("dao-execute-proposal").click();
  await expect(proposal).toContainText("executed");
});

test("invite acceptance and DAO creation update local state", async ({
  page,
}) => {
  await page.goto("/dao/join/ATLAS-1");
  await expect(page.getByTestId("dao-join")).toBeVisible();
  await page.getByTestId("dao-join").click();
  await expect(page.getByTestId("dao-join-success")).toBeVisible();
  await expect(page.getByTestId("dao-join-success")).toContainText("Sofia M.");

  await page.goto("/dao");
  await expect(
    page.getByTestId("dao-member-row").filter({ hasText: "Sofia M." }),
  ).toBeVisible();

  await page.goto("/dao/new");
  await page.getByRole("button", { name: /interpret config/i }).click();
  await expect(page.getByLabel("Treasury (USDC)")).toHaveValue("5000");
  await page.getByTestId("dao-deploy").click();
  await page.getByTestId("dao-simulate-signature").click();
  await expect(page).toHaveURL(/\/dao$/, { timeout: 20_000 });
  await expect(
    page.getByRole("heading", { name: /New Collective · operator console/i }),
  ).toBeVisible();
});
