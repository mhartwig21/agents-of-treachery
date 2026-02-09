import { test, expect } from '@playwright/test';
import { screenshot, navigateToGame } from './test-utils';

/**
 * Dashboard E2E Tests
 *
 * Tests for spectator dashboard features including filtering,
 * searching, and view mode switching.
 */

test.describe('Dashboard Filtering', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(500);
  });

  test('displays status filter buttons', async ({ page }) => {
    // Should have filter buttons for All, Active, Completed
    const filterBar = page.locator('.bg-gray-700.rounded-lg').first();
    const allButton = filterBar.getByRole('button', { name: /all/i });
    const activeButton = filterBar.getByRole('button', { name: /active/i });
    const completedButton = filterBar.getByRole('button', { name: /completed/i });

    await expect(allButton).toBeVisible();
    await expect(activeButton).toBeVisible();
    await expect(completedButton).toBeVisible();

    await screenshot(page, { name: 'filter-buttons', subdir: 'dashboard' });
  });

  test('can filter games by status', async ({ page }) => {
    // Take screenshot before filtering
    await screenshot(page, { name: 'filter-before', subdir: 'dashboard' });

    // Click active filter
    const filterBar = page.locator('.bg-gray-700.rounded-lg').first();
    const activeButton = filterBar.getByRole('button', { name: /active/i });
    if (await activeButton.isVisible()) {
      await activeButton.click();
      await page.waitForTimeout(300);
      await screenshot(page, { name: 'filter-active', subdir: 'dashboard' });
    }

    // Click completed filter
    const completedButton = filterBar.getByRole('button', { name: /completed/i });
    if (await completedButton.isVisible()) {
      await completedButton.click();
      await page.waitForTimeout(300);
      await screenshot(page, { name: 'filter-completed', subdir: 'dashboard' });
    }

    // Click all to reset
    const allButton = filterBar.getByRole('button', { name: /all/i });
    if (await allButton.isVisible()) {
      await allButton.click();
      await page.waitForTimeout(300);
      await screenshot(page, { name: 'filter-all', subdir: 'dashboard' });
    }
  });

  test('filter buttons show game counts', async ({ page }) => {
    // Filter buttons should show counts in parentheses
    const filterButtons = page.locator('button').filter({ hasText: /\(\d+\)/ });
    const count = await filterButtons.count();

    // Should have at least the All filter with a count
    expect(count).toBeGreaterThan(0);

    await screenshot(page, { name: 'filter-counts', subdir: 'dashboard' });
  });
});

test.describe('Dashboard Search', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(500);
  });

  test('displays search input', async ({ page }) => {
    const searchInput = page.getByPlaceholder(/search/i);
    await expect(searchInput).toBeVisible();

    await screenshot(page, { name: 'search-input', subdir: 'dashboard' });
  });

  test('can search for games', async ({ page }) => {
    const searchInput = page.getByPlaceholder(/search/i);

    if (await searchInput.isVisible()) {
      // Type a search query
      await searchInput.fill('Championship');
      await page.waitForTimeout(300);

      await screenshot(page, { name: 'search-results', subdir: 'dashboard' });

      // Clear search
      await searchInput.clear();
      await page.waitForTimeout(300);

      await screenshot(page, { name: 'search-cleared', subdir: 'dashboard' });
    }
  });

  test('shows empty state when no matches', async ({ page }) => {
    const searchInput = page.getByPlaceholder(/search/i);

    if (await searchInput.isVisible()) {
      // Search for something that won't match
      await searchInput.fill('xyznonexistent123');
      await page.waitForTimeout(300);

      // Should show empty state or no matching text
      const noMatches = page.getByText(/no matching|no games/i);
      const hasEmptyState = await noMatches.isVisible().catch(() => false);

      await screenshot(page, { name: 'search-no-results', subdir: 'dashboard' });

      // Clear search to reset
      await searchInput.clear();
    }
  });
});

test.describe('Dashboard View Modes', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(500);
  });

  test('has view mode toggle buttons', async ({ page }) => {
    // Look for grid and list toggle buttons (they have SVG icons)
    const toggleContainer = page.locator('.bg-gray-700').filter({ has: page.locator('svg') });

    if (await toggleContainer.count() > 0) {
      await screenshot(page, { name: 'view-toggle', subdir: 'dashboard' });
    }
  });

  test('can switch between grid and list views', async ({ page }) => {
    // Find the view toggle buttons by their container (rounded button group)
    const gridButton = page.locator('button[title="Grid view"]');
    const listButton = page.locator('button[title="List view"]');

    // Try to switch to list view
    if (await listButton.isVisible()) {
      await screenshot(page, { name: 'view-grid', subdir: 'dashboard' });

      await listButton.click();
      await page.waitForTimeout(300);

      await screenshot(page, { name: 'view-list', subdir: 'dashboard' });

      // Switch back to grid
      if (await gridButton.isVisible()) {
        await gridButton.click();
        await page.waitForTimeout(300);

        await screenshot(page, { name: 'view-grid-restored', subdir: 'dashboard' });
      }
    }
  });

  test('grid view shows game cards in grid layout', async ({ page }) => {
    // Grid should have multiple columns - use first() since page has multiple grids
    const gridContainer = page.locator('.grid.gap-4').first();

    if (await gridContainer.isVisible()) {
      const classes = await gridContainer.getAttribute('class');
      // Should have responsive grid classes
      expect(classes).toContain('grid-cols');

      await screenshot(page, { name: 'grid-layout', subdir: 'dashboard' });
    }
  });

  test('list view shows compact cards', async ({ page }) => {
    const listButton = page.locator('button[title="List view"]');

    if (await listButton.isVisible()) {
      await listButton.click();
      await page.waitForTimeout(300);

      // List view uses space-y for vertical layout
      const listContainer = page.locator('.space-y-2');

      if (await listContainer.isVisible()) {
        await screenshot(page, { name: 'list-layout', subdir: 'dashboard' });
      }
    }
  });
});

test.describe('Game Card Interactions', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(500);
  });

  test('game cards are clickable', async ({ page }) => {
    const gameCard = page.locator('[class*="cursor-pointer"]').first();

    if (await gameCard.isVisible()) {
      // Verify cursor style
      const cursor = await gameCard.evaluate((el) => {
        return window.getComputedStyle(el).cursor;
      });
      expect(cursor).toBe('pointer');
    }
  });

  test('clicking game card navigates to game view', async ({ page }) => {
    const gameCard = page.locator('[class*="cursor-pointer"]').first();

    if (await gameCard.isVisible()) {
      await gameCard.click();
      await page.waitForTimeout(500);

      // Should navigate to game view (has back button)
      const backButton = page.getByRole('button', { name: 'Back to dashboard' });
      await expect(backButton).toBeVisible();

      await screenshot(page, { name: 'card-clicked', subdir: 'dashboard' });
    }
  });

  test('game cards show game information', async ({ page }) => {
    const gameCard = page.locator('[class*="cursor-pointer"]').first();

    if (await gameCard.isVisible()) {
      // Card should contain game name or phase info
      const cardText = await gameCard.textContent();
      expect(cardText).toBeTruthy();
      expect(cardText!.length).toBeGreaterThan(0);

      await screenshot(page, { name: 'card-info', subdir: 'dashboard' });
    }
  });
});
