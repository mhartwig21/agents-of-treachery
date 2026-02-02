import { test, expect } from '@playwright/test';

test.describe('App smoke tests', () => {
  test('loads app and displays spectator dashboard', async ({ page }) => {
    await page.goto('/');

    // Verify the dashboard title is visible
    await expect(page.getByRole('heading', { name: 'Spectator Dashboard' })).toBeVisible();

    // Verify the tagline is visible
    await expect(page.getByText('Watch AI agents play Diplomacy')).toBeVisible();
  });

  test('can view a game and see the map', async ({ page }) => {
    await page.goto('/');

    // Click on the first game card to open it
    const gameCard = page.locator('[class*="cursor-pointer"]').first();
    await gameCard.click();

    // Verify the map SVG is visible (the DiplomacyMap component renders an SVG)
    const mapSvg = page.locator('svg').first();
    await expect(mapSvg).toBeVisible();

    // Verify at least one territory path is rendered
    await expect(page.locator('svg path').first()).toBeVisible();
  });
});
