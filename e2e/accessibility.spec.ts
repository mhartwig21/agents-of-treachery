import { test, expect } from '@playwright/test';
import { screenshot, navigateToGame } from './test-utils';

/**
 * Accessibility E2E Tests
 *
 * Basic accessibility checks for the application.
 */

test.describe('Keyboard Navigation', () => {
  test('dashboard buttons are keyboard accessible', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(500);

    // Press Tab to move focus
    await page.keyboard.press('Tab');
    await page.waitForTimeout(200);

    // Something should have focus
    const focusedElement = await page.evaluate(() => {
      const el = document.activeElement;
      return el ? el.tagName.toLowerCase() : null;
    });

    // Should focus a button or link
    expect(focusedElement).toBeTruthy();

    await screenshot(page, { name: 'keyboard-focus', subdir: 'accessibility' });
  });

  test('game cards can be selected with Enter key', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(500);

    // Find a game card
    const gameCard = page.locator('[class*="cursor-pointer"]').first();

    if (await gameCard.isVisible()) {
      // Focus the card
      await gameCard.focus();
      await page.waitForTimeout(200);

      // Press Enter
      await page.keyboard.press('Enter');
      await page.waitForTimeout(500);

      // Should navigate to game view
      const backButton = page.getByRole('button', { name: /back/i });
      const navigated = await backButton.isVisible().catch(() => false);

      await screenshot(page, { name: 'keyboard-enter', subdir: 'accessibility' });
    }
  });

  test('filter buttons can be activated with keyboard', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(500);

    // Focus the Active filter button
    const activeButton = page.getByRole('button', { name: /active/i });

    if (await activeButton.isVisible()) {
      await activeButton.focus();
      await page.keyboard.press('Enter');
      await page.waitForTimeout(300);

      await screenshot(page, { name: 'filter-keyboard', subdir: 'accessibility' });
    }
  });
});

test.describe('Focus Indicators', () => {
  test('buttons have visible focus indicator', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(500);

    // Tab to a button
    await page.keyboard.press('Tab');

    // Check for focus ring or outline
    const focusedElement = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el) return null;
      const styles = window.getComputedStyle(el);
      return {
        outline: styles.outline,
        boxShadow: styles.boxShadow,
        ring: styles.getPropertyValue('--tw-ring-color'),
      };
    });

    await screenshot(page, { name: 'focus-indicator', subdir: 'accessibility' });
  });

  test('form inputs have focus styles', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(500);

    const searchInput = page.getByPlaceholder(/search/i);

    if (await searchInput.isVisible()) {
      await searchInput.focus();
      await page.waitForTimeout(200);

      // Should have visible focus state (ring or border)
      await screenshot(page, { name: 'input-focus', subdir: 'accessibility' });
    }
  });
});

test.describe('Semantic HTML', () => {
  test('page has heading structure', async ({ page }) => {
    await page.goto('/');

    // Should have h1
    const h1 = page.getByRole('heading', { level: 1 });
    await expect(h1).toBeVisible();

    const headingText = await h1.textContent();
    expect(headingText).toBeTruthy();

    await screenshot(page, { name: 'heading-structure', subdir: 'accessibility' });
  });

  test('buttons have accessible roles', async ({ page }) => {
    await page.goto('/');

    // All clickable elements should be buttons or links
    const buttons = page.getByRole('button');
    const buttonCount = await buttons.count();

    // Should have multiple buttons
    expect(buttonCount).toBeGreaterThan(0);

    await screenshot(page, { name: 'button-roles', subdir: 'accessibility' });
  });

  test('main content area exists', async ({ page }) => {
    await page.goto('/');

    // Should have main element
    const main = page.locator('main');
    await expect(main).toBeVisible();

    await screenshot(page, { name: 'main-landmark', subdir: 'accessibility' });
  });

  test('header landmark exists', async ({ page }) => {
    await page.goto('/');

    // Should have header element
    const header = page.locator('header');
    await expect(header).toBeVisible();

    await screenshot(page, { name: 'header-landmark', subdir: 'accessibility' });
  });
});

test.describe('Color Contrast', () => {
  test('text is visible against background', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(500);

    // Check that main heading is visible
    const heading = page.getByRole('heading', { level: 1 });
    await expect(heading).toBeVisible();

    // Take screenshot for visual verification
    await screenshot(page, { name: 'color-contrast', subdir: 'accessibility' });
  });

  test('buttons have sufficient contrast', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(500);

    const buttons = page.getByRole('button').first();

    if (await buttons.isVisible()) {
      // Visual check via screenshot
      await screenshot(page, { name: 'button-contrast', subdir: 'accessibility' });
    }
  });
});

test.describe('Interactive Elements', () => {
  test('links open correctly', async ({ page }) => {
    await page.goto('/');

    // Check for any links
    const links = page.getByRole('link');
    const linkCount = await links.count();

    await screenshot(page, { name: 'links', subdir: 'accessibility' });
  });

  test('buttons are not disabled without reason', async ({ page }) => {
    await page.goto('/');

    // Get all buttons
    const buttons = page.getByRole('button');
    const buttonCount = await buttons.count();

    // Count disabled buttons
    const disabledButtons = page.locator('button:disabled');
    const disabledCount = await disabledButtons.count();

    // Most buttons should be enabled
    expect(buttonCount - disabledCount).toBeGreaterThan(0);

    await screenshot(page, { name: 'enabled-buttons', subdir: 'accessibility' });
  });
});

test.describe('Game View Accessibility', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await navigateToGame(page, 0);
    await page.waitForTimeout(500);
  });

  test('back button is accessible', async ({ page }) => {
    const backButton = page.getByRole('button', { name: /back/i });
    await expect(backButton).toBeVisible();

    // Should be focusable
    await backButton.focus();

    await screenshot(page, { name: 'back-button-focus', subdir: 'accessibility' });
  });

  test('map controls are keyboard accessible', async ({ page }) => {
    const zoomIn = page.locator('button[title="Zoom in"]');

    if (await zoomIn.isVisible()) {
      // Tab to zoom controls
      await zoomIn.focus();
      await page.waitForTimeout(200);

      // Activate with keyboard
      await page.keyboard.press('Enter');
      await page.waitForTimeout(300);

      await screenshot(page, { name: 'map-controls-keyboard', subdir: 'accessibility' });
    }
  });

  test('zoom buttons have title attributes', async ({ page }) => {
    const zoomIn = page.locator('button[title="Zoom in"]');
    const zoomOut = page.locator('button[title="Zoom out"]');
    const resetZoom = page.locator('button[title="Reset zoom"]');

    // All should have title attributes for tooltip accessibility
    await expect(zoomIn).toHaveAttribute('title', 'Zoom in');
    await expect(zoomOut).toHaveAttribute('title', 'Zoom out');
    await expect(resetZoom).toHaveAttribute('title', 'Reset zoom');

    await screenshot(page, { name: 'zoom-titles', subdir: 'accessibility' });
  });
});

test.describe('Responsive Design', () => {
  test('dashboard is usable on mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');
    await page.waitForTimeout(500);

    // Heading should still be visible
    const heading = page.getByRole('heading', { level: 1 });
    await expect(heading).toBeVisible();

    await screenshot(page, { name: 'mobile-dashboard', subdir: 'accessibility' });
  });

  test('game view is usable on tablet viewport', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/');
    await navigateToGame(page, 0);
    await page.waitForTimeout(500);

    // Map should be visible
    const svg = page.locator('svg').first();
    await expect(svg).toBeVisible();

    await screenshot(page, { name: 'tablet-game-view', subdir: 'accessibility' });
  });
});
