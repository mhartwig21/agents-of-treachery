import { test, expect } from '@playwright/test';

test.describe('Spectator Dashboard', () => {
  test('loads and displays game cards', async ({ page }) => {
    await page.goto('/');

    // Should show spectator dashboard with game cards
    await expect(page.getByText('Spectator Dashboard')).toBeVisible();
    await expect(page.getByText('AI Championship Round 1')).toBeVisible();
    await expect(page.getByText('Training Match Alpha')).toBeVisible();
    await expect(page.getByText('Practice Game Beta')).toBeVisible();
  });

  test('can switch to player mode', async ({ page }) => {
    await page.goto('/');

    // Click player mode button
    await page.getByRole('button', { name: 'Player Mode' }).click();

    // Should show player UI with header
    await expect(page.getByText('Agents of Treachery')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Spectator Mode' })).toBeVisible();
  });

  test('can select a game and view details', async ({ page }) => {
    await page.goto('/');

    // Click on a game card
    await page.getByText('AI Championship Round 1').click();

    // Should navigate to game view
    await expect(page.getByRole('button', { name: 'Back to dashboard' })).toBeVisible();
  });
});

test.describe('Player Mode', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Player Mode' }).click();
  });

  test('displays the Diplomacy map', async ({ page }) => {
    // Map SVG should be present
    const svg = page.locator('svg');
    await expect(svg).toBeVisible();
  });

  test('shows current game phase', async ({ page }) => {
    // Should show phase info
    await expect(page.getByText('Spring 1901')).toBeVisible();
  });

  test('displays power color indicators', async ({ page }) => {
    // Power colors should be visible in header
    const colorIndicators = page.locator('header .w-4.h-4.rounded');
    await expect(colorIndicators).toHaveCount(7); // 7 powers
  });
});

test.describe('Game View', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.getByText('AI Championship Round 1').click();
  });

  test('shows map panel', async ({ page }) => {
    // Should have a map visible
    const svg = page.locator('svg');
    await expect(svg.first()).toBeVisible();
  });

  test('can navigate back to dashboard', async ({ page }) => {
    await page.getByRole('button', { name: 'Back to dashboard' }).click();
    await expect(page.getByText('Spectator Dashboard')).toBeVisible();
  });
});
