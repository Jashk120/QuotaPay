import fs from "node:fs";
import path from "node:path";
import { test, expect } from "@playwright/test";

const hasProverAssets = fs.existsSync(
  path.resolve("public/zk/Membership_final.zkey"),
);

test("ZK membership UI: load credential, prove, build signed frame", async ({
  page,
}) => {
  test.skip(
    !hasProverAssets,
    "run npm run zk:publish before the ZK browser test",
  );
  const credential = fs.readFileSync(
    path.resolve("test/fixtures/zk/credential.json"),
    "utf8",
  );

  await page.goto("/pay");
  await expect(page.getByText("Step 1 · ZK credential")).toBeVisible();

  await page.locator("textarea").fill(credential);
  await page.getByRole("button", { name: "Use credential" }).click();
  await expect(page.getByText(/Credential loaded in this browser/)).toBeVisible();

  await page.getByTestId("zk-prove").click();
  await expect(page.getByTestId("zk-proof")).toBeVisible({ timeout: 60_000 });

  await page.locator("#zk-to").fill("0x000000000000000000000000000000000000dEaD");
  await page.getByTestId("zk-build").click();
  await expect(page.getByTestId("zk-signed")).toContainText("4 frames");
});
