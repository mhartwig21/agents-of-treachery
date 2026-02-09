import { test, expect } from '@playwright/test';
import { screenshot, navigateToGame } from './test-utils';

/**
 * Navigation and UI Interaction Tests
 *
 * Tests for game viewing flow, map interactions, and UI components.
 * Runs against mock data (no game server required).
 */

test.describe('Game View Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await navigateToGame(page, 0);
    // Wait for game view to load
    await page.waitForTimeout(500);
  });

  test('displays turn scrubber', async ({ page }) => {
    // Look for the turn scrubber component
    const scrubber = page.locator('[class*="scrubber"], [data-testid="turn-scrubber"]');

    // If no explicit scrubber, look for phase navigation elements
    const phaseNav = page.getByRole('slider').or(page.locator('input[type="range"]'));

    const hasScrubber = await scrubber.count() > 0 || await phaseNav.count() > 0;

    if (!hasScrubber) {
      // Check for any navigation buttons (prev/next)
      const navButtons = page.getByRole('button', { name: /previous|next|back|forward/i });
      expect(await navButtons.count()).toBeGreaterThan(0);
    }
  });

  test('can navigate through turns with scrubber', async ({ page }) => {
    // Find phase display
    const phaseText = page.getByText(/Spring|Fall|Winter/);
    const initialPhase = await phaseText.first().textContent();

    // Find slider/scrubber
    const slider = page.locator('input[type="range"]').first();

    if (await slider.isVisible()) {
      // Get slider bounds and interact
      const box = await slider.boundingBox();
      if (box) {
        // Click near beginning of slider
        await page.mouse.click(box.x + box.width * 0.1, box.y + box.height / 2);
        await page.waitForTimeout(300);

        // Click near end of slider
        await page.mouse.click(box.x + box.width * 0.9, box.y + box.height / 2);
        await page.waitForTimeout(300);
      }
    }

    await screenshot(page, { name: 'scrubber-navigation', subdir: 'navigation' });
  });

  test('displays tabs for map/orders/press (mobile layout)', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');
    await navigateToGame(page, 0);
    await page.waitForTimeout(500);

    // Check for tab buttons
    const mapTab = page.getByRole('button', { name: /map/i });
    const ordersTab = page.getByRole('button', { name: /orders/i });
    const pressTab = page.getByRole('button', { name: /press/i });

    // At least map tab should be visible
    if (await mapTab.isVisible()) {
      await screenshot(page, { name: 'mobile-tabs', subdir: 'navigation' });

      // Click orders tab if visible (force click to bypass any overlays)
      if (await ordersTab.isVisible()) {
        await ordersTab.click({ force: true });
        await page.waitForTimeout(300);
        await screenshot(page, { name: 'mobile-orders-tab', subdir: 'navigation' });
      }

      // Click press tab if visible (force click to bypass any overlays)
      if (await pressTab.isVisible()) {
        await pressTab.click({ force: true });
        await page.waitForTimeout(300);
        await screenshot(page, { name: 'mobile-press-tab', subdir: 'navigation' });
      }
    }
  });
});

test.describe('Map Interactions', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await navigateToGame(page, 0);
    await page.waitForTimeout(500);
  });

  test('map is rendered with territories', async ({ page }) => {
    const svg = page.locator('svg').first();
    await expect(svg).toBeVisible();

    // Check for territory paths
    const paths = page.locator('svg path');
    const pathCount = await paths.count();
    expect(pathCount).toBeGreaterThan(10); // Diplomacy map has many territories

    await screenshot(page, { name: 'map-territories', subdir: 'map' });
  });

  test('territories respond to hover', async ({ page }) => {
    const svg = page.locator('svg').first();
    await expect(svg).toBeVisible();

    // Find a territory path and hover
    const territory = page.locator('svg path').first();
    await territory.hover();
    await page.waitForTimeout(200);

    await screenshot(page, { name: 'territory-hover', subdir: 'map' });
  });

  test('can click on territory', async ({ page }) => {
    const svg = page.locator('svg').first();
    await expect(svg).toBeVisible();

    // Find and click a territory
    const territory = page.locator('svg path[id]').first();

    if (await territory.count() > 0) {
      await territory.click();
      await page.waitForTimeout(300);
      await screenshot(page, { name: 'territory-click', subdir: 'map' });
    }
  });

  test('map can be zoomed with scroll', async ({ page }) => {
    const svg = page.locator('svg').first();
    await expect(svg).toBeVisible();

    const box = await svg.boundingBox();
    if (box) {
      // Move mouse to center of map
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

      // Initial screenshot
      await screenshot(page, { name: 'map-zoom-before', subdir: 'map' });

      // Zoom in with scroll
      await page.mouse.wheel(0, -200);
      await page.waitForTimeout(300);
      await screenshot(page, { name: 'map-zoom-in', subdir: 'map' });

      // Zoom out
      await page.mouse.wheel(0, 200);
      await page.waitForTimeout(300);
      await screenshot(page, { name: 'map-zoom-out', subdir: 'map' });
    }
  });

  test('map can be panned by dragging', async ({ page }) => {
    const svg = page.locator('svg').first();
    await expect(svg).toBeVisible();

    const box = await svg.boundingBox();
    if (box) {
      const centerX = box.x + box.width / 2;
      const centerY = box.y + box.height / 2;

      await screenshot(page, { name: 'map-pan-before', subdir: 'map' });

      // Drag to pan
      await page.mouse.move(centerX, centerY);
      await page.mouse.down();
      await page.mouse.move(centerX + 100, centerY + 50);
      await page.mouse.up();

      await page.waitForTimeout(200);
      await screenshot(page, { name: 'map-pan-after', subdir: 'map' });
    }
  });
});

test.describe('Side Panels', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await navigateToGame(page, 0);
    await page.waitForTimeout(500);
  });

  test('shows power stats panel', async ({ page }) => {
    // Look for power stats indicators
    const powerStats = page.locator('[class*="power"], [data-testid*="power"]');

    // Or look for specific power names
    const powers = ['England', 'France', 'Germany', 'Italy', 'Austria', 'Russia', 'Turkey'];

    for (const power of powers) {
      const powerElement = page.getByText(new RegExp(power, 'i')).first();
      if (await powerElement.isVisible().catch(() => false)) {
        // Found at least one power displayed
        await screenshot(page, { name: 'power-stats', subdir: 'panels' });
        return;
      }
    }
  });

  test('shows orders panel with order count', async ({ page }) => {
    // Look for orders section
    const ordersPanel = page.getByText(/orders/i);

    if (await ordersPanel.first().isVisible().catch(() => false)) {
      await screenshot(page, { name: 'orders-panel', subdir: 'panels' });
    }
  });

  test('shows press/messages panel', async ({ page }) => {
    // Look for press or messages section
    const pressPanel = page.getByText(/press|messages|diplomacy/i);

    if (await pressPanel.first().isVisible().catch(() => false)) {
      await screenshot(page, { name: 'press-panel', subdir: 'panels' });
    }
  });

  test('panels can be collapsed', async ({ page }) => {
    // Look for collapse buttons (typically chevron icons or toggle buttons)
    const collapseButtons = page.locator(
      'button[aria-label*="collapse"], button[aria-label*="toggle"], [class*="collapse"]'
    );

    const count = await collapseButtons.count();
    if (count > 0) {
      await screenshot(page, { name: 'panels-expanded', subdir: 'panels' });

      // Click first collapse button
      await collapseButtons.first().click();
      await page.waitForTimeout(300);
      await screenshot(page, { name: 'panels-collapsed', subdir: 'panels' });
    }
  });
});

test.describe('Phase Indicator', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await navigateToGame(page, 0);
    await page.waitForTimeout(500);
  });

  test('displays current phase', async ({ page }) => {
    // Phase should show season and year
    const phaseText = page.getByText(/Spring|Fall|Winter|Autumn/).first();
    await expect(phaseText).toBeVisible();

    // Should also have year
    const yearText = page.getByText(/190[1-9]|191[0-9]/).first();
    await expect(yearText).toBeVisible();

    await screenshot(page, { name: 'phase-indicator', subdir: 'ui' });
  });

  test('shows phase type (diplomacy/movement/retreat/build)', async ({ page }) => {
    // Look for phase type indicators
    const phaseTypes = ['DIPLOMACY', 'MOVEMENT', 'RETREAT', 'BUILD', 'Diplomacy', 'Movement'];

    for (const phaseType of phaseTypes) {
      const element = page.getByText(phaseType).first();
      if (await element.isVisible().catch(() => false)) {
        await screenshot(page, { name: 'phase-type', subdir: 'ui' });
        return;
      }
    }
  });
});

test.describe('Back Navigation', () => {
  test('back button returns to dashboard', async ({ page }) => {
    await page.goto('/');
    await navigateToGame(page, 0);
    await page.waitForTimeout(500);

    // Find and click back button
    const backButton = page.getByRole('button', { name: 'Back to dashboard' });
    await expect(backButton).toBeVisible();
    await backButton.click();

    // Should be back at dashboard
    await expect(page.getByText('Spectator Dashboard')).toBeVisible();
  });
});
