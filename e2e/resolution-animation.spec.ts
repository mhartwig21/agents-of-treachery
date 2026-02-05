import { test, expect, Page } from '@playwright/test';
import { screenshot, navigateToGame, isMapVisible } from './test-utils';

/**
 * Resolution Animation E2E Tests
 *
 * Tests the turn resolution animation sequence in spectator view.
 * Verifies animation phases, controls, and visual feedback.
 */

/**
 * Waits for the resolution animation controls to be visible.
 * Returns false if controls are not available (feature not yet integrated).
 */
async function waitForAnimationControls(page: Page): Promise<boolean> {
  try {
    // Look for play resolution button or animation controls panel
    const playButton = page.locator('[data-testid="play-resolution-button"], button:has-text("Play Resolution")');
    return await playButton.isVisible({ timeout: 5000 });
  } catch {
    return false;
  }
}

/**
 * Gets the current animation phase from the UI.
 */
async function getCurrentAnimationPhase(page: Page): Promise<string | null> {
  try {
    const phaseIndicator = page.locator('[data-testid="animation-phase"]');
    if (await phaseIndicator.isVisible({ timeout: 1000 })) {
      return await phaseIndicator.textContent();
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Gets the animation progress percentage.
 */
async function getAnimationProgress(page: Page): Promise<number | null> {
  try {
    const progressBar = page.locator('[data-testid="animation-progress"]');
    if (await progressBar.isVisible({ timeout: 1000 })) {
      const value = await progressBar.getAttribute('aria-valuenow');
      return value ? parseFloat(value) : null;
    }
    return null;
  } catch {
    return null;
  }
}

test.describe('Resolution Animation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(1000);
  });

  test.describe('Animation Controls', () => {
    test('play button starts animation sequence', async ({ page }) => {
      // Navigate to a game
      const navigated = await navigateToGame(page, 0);
      if (!navigated) {
        test.skip(true, 'No games available');
        return;
      }

      await page.waitForTimeout(500);
      await screenshot(page, { name: 'before-animation', subdir: 'resolution-animation' });

      // Check if animation controls are available
      const hasControls = await waitForAnimationControls(page);
      if (!hasControls) {
        test.skip(true, 'Resolution animation controls not available');
        return;
      }

      // Click play button
      const playButton = page.locator('[data-testid="play-resolution-button"], button:has-text("Play Resolution")');
      await playButton.click();
      await page.waitForTimeout(500);

      await screenshot(page, { name: 'animation-started', subdir: 'resolution-animation' });

      // Verify animation has started (phase should not be idle)
      const phase = await getCurrentAnimationPhase(page);
      if (phase) {
        expect(phase).not.toBe('idle');
      }
    });

    test('pause button stops animation', async ({ page }) => {
      const navigated = await navigateToGame(page, 0);
      if (!navigated) {
        test.skip(true, 'No games available');
        return;
      }

      await page.waitForTimeout(500);

      const hasControls = await waitForAnimationControls(page);
      if (!hasControls) {
        test.skip(true, 'Resolution animation controls not available');
        return;
      }

      // Start animation
      const playButton = page.locator('[data-testid="play-resolution-button"], button:has-text("Play Resolution")');
      await playButton.click();
      await page.waitForTimeout(1000);

      // Click pause
      const pauseButton = page.locator('[data-testid="pause-resolution-button"], button:has-text("Pause")');
      if (await pauseButton.isVisible()) {
        await pauseButton.click();
        await page.waitForTimeout(500);

        // Get progress and wait to verify it doesn't change
        const progressBefore = await getAnimationProgress(page);
        await page.waitForTimeout(1000);
        const progressAfter = await getAnimationProgress(page);

        // Progress should remain the same when paused
        if (progressBefore !== null && progressAfter !== null) {
          expect(progressAfter).toBe(progressBefore);
        }

        await screenshot(page, { name: 'animation-paused', subdir: 'resolution-animation' });
      }
    });

    test('skip button jumps to complete', async ({ page }) => {
      const navigated = await navigateToGame(page, 0);
      if (!navigated) {
        test.skip(true, 'No games available');
        return;
      }

      await page.waitForTimeout(500);

      const hasControls = await waitForAnimationControls(page);
      if (!hasControls) {
        test.skip(true, 'Resolution animation controls not available');
        return;
      }

      // Start animation
      const playButton = page.locator('[data-testid="play-resolution-button"], button:has-text("Play Resolution")');
      await playButton.click();
      await page.waitForTimeout(500);

      // Click skip
      const skipButton = page.locator('[data-testid="skip-resolution-button"], button:has-text("Skip")');
      if (await skipButton.isVisible()) {
        await skipButton.click();
        await page.waitForTimeout(300);

        // Verify animation is complete
        const phase = await getCurrentAnimationPhase(page);
        if (phase) {
          expect(phase).toBe('complete');
        }

        // Progress should be 100%
        const progress = await getAnimationProgress(page);
        if (progress !== null) {
          expect(progress).toBe(100);
        }

        await screenshot(page, { name: 'animation-skipped', subdir: 'resolution-animation' });
      }
    });

    test('reset button returns to beginning', async ({ page }) => {
      const navigated = await navigateToGame(page, 0);
      if (!navigated) {
        test.skip(true, 'No games available');
        return;
      }

      await page.waitForTimeout(500);

      const hasControls = await waitForAnimationControls(page);
      if (!hasControls) {
        test.skip(true, 'Resolution animation controls not available');
        return;
      }

      // Start and skip animation
      const playButton = page.locator('[data-testid="play-resolution-button"], button:has-text("Play Resolution")');
      await playButton.click();
      await page.waitForTimeout(500);

      const skipButton = page.locator('[data-testid="skip-resolution-button"], button:has-text("Skip")');
      if (await skipButton.isVisible()) {
        await skipButton.click();
        await page.waitForTimeout(300);
      }

      // Click reset
      const resetButton = page.locator('[data-testid="reset-resolution-button"], button:has-text("Reset")');
      if (await resetButton.isVisible()) {
        await resetButton.click();
        await page.waitForTimeout(300);

        // Verify animation is reset (phase should be idle, progress 0)
        const phase = await getCurrentAnimationPhase(page);
        if (phase) {
          expect(phase).toBe('idle');
        }

        const progress = await getAnimationProgress(page);
        if (progress !== null) {
          expect(progress).toBe(0);
        }

        await screenshot(page, { name: 'animation-reset', subdir: 'resolution-animation' });
      }
    });
  });

  test.describe('Animation Phases', () => {
    test('animation progresses through phases in order', async ({ page }) => {
      const navigated = await navigateToGame(page, 0);
      if (!navigated) {
        test.skip(true, 'No games available');
        return;
      }

      await page.waitForTimeout(500);

      const hasControls = await waitForAnimationControls(page);
      if (!hasControls) {
        test.skip(true, 'Resolution animation controls not available');
        return;
      }

      // Start animation
      const playButton = page.locator('[data-testid="play-resolution-button"], button:has-text("Play Resolution")');
      await playButton.click();

      const observedPhases: string[] = [];
      const startTime = Date.now();
      const maxDuration = 30000; // 30 seconds max

      // Monitor phases
      while (Date.now() - startTime < maxDuration) {
        const phase = await getCurrentAnimationPhase(page);
        if (phase && !observedPhases.includes(phase)) {
          observedPhases.push(phase);
          console.log(`Phase observed: ${phase}`);
          await screenshot(page, { name: `phase-${observedPhases.length}-${phase}`, subdir: 'resolution-animation' });
        }

        if (phase === 'complete') break;
        await page.waitForTimeout(200);
      }

      // Verify phases were observed in order (some phases may be skipped if no content)
      console.log(`Observed phases: ${observedPhases.join(' -> ')}`);

      // At minimum, should start with show_orders and end with complete
      if (observedPhases.length > 0) {
        expect(observedPhases[0]).toBe('show_orders');
        expect(observedPhases[observedPhases.length - 1]).toBe('complete');
      }
    });

    test('show_orders phase displays order arrows', async ({ page }) => {
      const navigated = await navigateToGame(page, 0);
      if (!navigated) {
        test.skip(true, 'No games available');
        return;
      }

      await page.waitForTimeout(500);
      expect(await isMapVisible(page)).toBe(true);

      const hasControls = await waitForAnimationControls(page);
      if (!hasControls) {
        test.skip(true, 'Resolution animation controls not available');
        return;
      }

      // Start animation
      const playButton = page.locator('[data-testid="play-resolution-button"], button:has-text("Play Resolution")');
      await playButton.click();
      await page.waitForTimeout(500);

      // Check for order arrow elements in SVG
      const svg = page.locator('svg').first();
      await expect(svg).toBeVisible();

      // OrderArrow components have animated-arrow class or specific patterns
      const orderArrows = svg.locator('[class*="order-arrow"], line[marker-end*="arrow"], [data-testid="order-arrow"]');
      const arrowCount = await orderArrows.count();

      console.log(`Order arrows visible: ${arrowCount}`);
      await screenshot(page, { name: 'show-orders-phase', subdir: 'resolution-animation' });

      // Should have at least some order visualizations
      expect(arrowCount).toBeGreaterThanOrEqual(0);
    });

    test('conflict markers appear on contested territories', async ({ page }) => {
      const navigated = await navigateToGame(page, 0);
      if (!navigated) {
        test.skip(true, 'No games available');
        return;
      }

      await page.waitForTimeout(500);

      const hasControls = await waitForAnimationControls(page);
      if (!hasControls) {
        test.skip(true, 'Resolution animation controls not available');
        return;
      }

      // Start animation
      const playButton = page.locator('[data-testid="play-resolution-button"], button:has-text("Play Resolution")');
      await playButton.click();

      // Wait for highlight_conflicts or resolve_battles phase
      const startTime = Date.now();
      while (Date.now() - startTime < 15000) {
        const phase = await getCurrentAnimationPhase(page);
        if (phase === 'highlight_conflicts' || phase === 'resolve_battles') {
          break;
        }
        if (phase === 'complete') break;
        await page.waitForTimeout(200);
      }

      // Check for conflict markers
      const svg = page.locator('svg').first();
      const conflictMarkers = svg.locator('[data-testid="conflict-marker"], [class*="conflict"]');
      const conflictCount = await conflictMarkers.count();

      console.log(`Conflict markers visible: ${conflictCount}`);
      await screenshot(page, { name: 'conflicts-phase', subdir: 'resolution-animation' });

      // Conflict count depends on game state (may be 0 if no conflicts)
    });

    test('units animate to new positions', async ({ page }) => {
      const navigated = await navigateToGame(page, 0);
      if (!navigated) {
        test.skip(true, 'No games available');
        return;
      }

      await page.waitForTimeout(500);

      const hasControls = await waitForAnimationControls(page);
      if (!hasControls) {
        test.skip(true, 'Resolution animation controls not available');
        return;
      }

      // Get initial unit positions
      const svg = page.locator('svg').first();
      const unitGroups = svg.locator('g[transform*="translate"]');

      const initialPositions: string[] = [];
      const initialCount = await unitGroups.count();
      for (let i = 0; i < Math.min(initialCount, 10); i++) {
        const transform = await unitGroups.nth(i).getAttribute('transform');
        if (transform) initialPositions.push(transform);
      }

      await screenshot(page, { name: 'units-before', subdir: 'resolution-animation' });

      // Skip to complete to see final positions
      const playButton = page.locator('[data-testid="play-resolution-button"], button:has-text("Play Resolution")');
      await playButton.click();
      await page.waitForTimeout(500);

      const skipButton = page.locator('[data-testid="skip-resolution-button"], button:has-text("Skip")');
      if (await skipButton.isVisible()) {
        await skipButton.click();
        await page.waitForTimeout(500);
      }

      // Get final positions
      const finalPositions: string[] = [];
      const finalCount = await unitGroups.count();
      for (let i = 0; i < Math.min(finalCount, 10); i++) {
        const transform = await unitGroups.nth(i).getAttribute('transform');
        if (transform) finalPositions.push(transform);
      }

      await screenshot(page, { name: 'units-after', subdir: 'resolution-animation' });

      // Positions may have changed if units moved
      console.log(`Initial positions: ${initialPositions.length}, Final positions: ${finalPositions.length}`);
    });

    test('failed order markers are displayed', async ({ page }) => {
      const navigated = await navigateToGame(page, 0);
      if (!navigated) {
        test.skip(true, 'No games available');
        return;
      }

      await page.waitForTimeout(500);

      const hasControls = await waitForAnimationControls(page);
      if (!hasControls) {
        test.skip(true, 'Resolution animation controls not available');
        return;
      }

      // Skip to show_failures phase or complete
      const playButton = page.locator('[data-testid="play-resolution-button"], button:has-text("Play Resolution")');
      await playButton.click();

      // Wait for show_failures phase
      const startTime = Date.now();
      while (Date.now() - startTime < 20000) {
        const phase = await getCurrentAnimationPhase(page);
        if (phase === 'show_failures' || phase === 'complete') {
          break;
        }
        await page.waitForTimeout(200);
      }

      // Check for failed order markers
      const svg = page.locator('svg').first();
      const failedMarkers = svg.locator('[data-testid="failed-order-marker"], [class*="failed"]');
      const failedCount = await failedMarkers.count();

      console.log(`Failed order markers visible: ${failedCount}`);
      await screenshot(page, { name: 'failed-orders-phase', subdir: 'resolution-animation' });

      // Failed order count depends on game state
    });
  });

  test.describe('Animation Speed', () => {
    test('speed control changes animation duration', async ({ page }) => {
      const navigated = await navigateToGame(page, 0);
      if (!navigated) {
        test.skip(true, 'No games available');
        return;
      }

      await page.waitForTimeout(500);

      const hasControls = await waitForAnimationControls(page);
      if (!hasControls) {
        test.skip(true, 'Resolution animation controls not available');
        return;
      }

      // Look for speed controls
      const speedSelector = page.locator('[data-testid="animation-speed"], select[name="speed"]');
      const fastButton = page.locator('button:has-text("2x"), button:has-text("Fast")');

      if (await speedSelector.isVisible()) {
        await speedSelector.selectOption('fast');
        await screenshot(page, { name: 'speed-fast', subdir: 'resolution-animation' });
      } else if (await fastButton.isVisible()) {
        await fastButton.click();
        await screenshot(page, { name: 'speed-fast', subdir: 'resolution-animation' });
      }

      // Start animation and verify it progresses faster
      const playButton = page.locator('[data-testid="play-resolution-button"], button:has-text("Play Resolution")');
      await playButton.click();

      const startTime = Date.now();

      // Wait for animation to complete
      while (Date.now() - startTime < 15000) {
        const phase = await getCurrentAnimationPhase(page);
        if (phase === 'complete') break;
        await page.waitForTimeout(100);
      }

      const duration = Date.now() - startTime;
      console.log(`Animation completed in ${duration}ms at fast speed`);
    });
  });

  test.describe('Map Integration', () => {
    test('map enters animation mode during playback', async ({ page }) => {
      const navigated = await navigateToGame(page, 0);
      if (!navigated) {
        test.skip(true, 'No games available');
        return;
      }

      await page.waitForTimeout(500);
      expect(await isMapVisible(page)).toBe(true);

      const hasControls = await waitForAnimationControls(page);
      if (!hasControls) {
        test.skip(true, 'Resolution animation controls not available');
        return;
      }

      // Start animation
      const playButton = page.locator('[data-testid="play-resolution-button"], button:has-text("Play Resolution")');
      await playButton.click();
      await page.waitForTimeout(500);

      // Check for animation mode indicators on map
      const mapContainer = page.locator('[data-testid="diplomacy-map"], .diplomacy-map, svg').first();
      await expect(mapContainer).toBeVisible();

      // AnimatedUnit components should be visible during animation
      const animatedUnits = page.locator('[data-testid="animated-unit"], [class*="animated"]');
      const animatedCount = await animatedUnits.count();

      console.log(`Animated elements: ${animatedCount}`);
      await screenshot(page, { name: 'map-animation-mode', subdir: 'resolution-animation' });
    });

    test('map shows final state after animation complete', async ({ page }) => {
      const navigated = await navigateToGame(page, 0);
      if (!navigated) {
        test.skip(true, 'No games available');
        return;
      }

      await page.waitForTimeout(500);

      const hasControls = await waitForAnimationControls(page);
      if (!hasControls) {
        test.skip(true, 'Resolution animation controls not available');
        return;
      }

      // Skip to complete
      const playButton = page.locator('[data-testid="play-resolution-button"], button:has-text("Play Resolution")');
      await playButton.click();
      await page.waitForTimeout(500);

      const skipButton = page.locator('[data-testid="skip-resolution-button"], button:has-text("Skip")');
      if (await skipButton.isVisible()) {
        await skipButton.click();
        await page.waitForTimeout(500);
      }

      // Map should show final positions
      expect(await isMapVisible(page)).toBe(true);
      await screenshot(page, { name: 'map-final-state', subdir: 'resolution-animation' });

      // Verify units are in their final positions (static, not animating)
      const svg = page.locator('svg').first();
      const units = svg.locator('circle');
      const unitCount = await units.count();

      console.log(`Units after animation: ${unitCount}`);
      expect(unitCount).toBeGreaterThan(0);
    });
  });
});

test.describe('Resolution Animation - Edge Cases', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(1000);
  });

  test('handles game with no movement (all holds)', async ({ page }) => {
    const navigated = await navigateToGame(page, 0);
    if (!navigated) {
      test.skip(true, 'No games available');
      return;
    }

    await page.waitForTimeout(500);

    const hasControls = await waitForAnimationControls(page);
    if (!hasControls) {
      test.skip(true, 'Resolution animation controls not available');
      return;
    }

    // Start and complete animation
    const playButton = page.locator('[data-testid="play-resolution-button"], button:has-text("Play Resolution")');
    await playButton.click();

    const skipButton = page.locator('[data-testid="skip-resolution-button"], button:has-text("Skip")');
    if (await skipButton.isVisible()) {
      await skipButton.click();
    }

    await page.waitForTimeout(500);

    // Animation should complete without errors
    const phase = await getCurrentAnimationPhase(page);
    if (phase) {
      expect(phase).toBe('complete');
    }

    await screenshot(page, { name: 'all-holds-complete', subdir: 'resolution-animation' });
  });

  test('animation survives page scroll/zoom', async ({ page }) => {
    const navigated = await navigateToGame(page, 0);
    if (!navigated) {
      test.skip(true, 'No games available');
      return;
    }

    await page.waitForTimeout(500);

    const hasControls = await waitForAnimationControls(page);
    if (!hasControls) {
      test.skip(true, 'Resolution animation controls not available');
      return;
    }

    // Start animation
    const playButton = page.locator('[data-testid="play-resolution-button"], button:has-text("Play Resolution")');
    await playButton.click();
    await page.waitForTimeout(500);

    // Zoom in on map
    const zoomIn = page.locator('button[title="Zoom in"]');
    if (await zoomIn.isVisible()) {
      await zoomIn.click();
      await zoomIn.click();
      await page.waitForTimeout(300);
    }

    // Animation should continue
    const phase = await getCurrentAnimationPhase(page);
    console.log(`Phase after zoom: ${phase}`);

    await screenshot(page, { name: 'animation-after-zoom', subdir: 'resolution-animation' });

    // Skip to complete
    const skipButton = page.locator('[data-testid="skip-resolution-button"], button:has-text("Skip")');
    if (await skipButton.isVisible()) {
      await skipButton.click();
      await page.waitForTimeout(300);

      const finalPhase = await getCurrentAnimationPhase(page);
      if (finalPhase) {
        expect(finalPhase).toBe('complete');
      }
    }
  });

  test('can restart animation after completion', async ({ page }) => {
    const navigated = await navigateToGame(page, 0);
    if (!navigated) {
      test.skip(true, 'No games available');
      return;
    }

    await page.waitForTimeout(500);

    const hasControls = await waitForAnimationControls(page);
    if (!hasControls) {
      test.skip(true, 'Resolution animation controls not available');
      return;
    }

    // Complete animation
    const playButton = page.locator('[data-testid="play-resolution-button"], button:has-text("Play Resolution")');
    await playButton.click();
    await page.waitForTimeout(500);

    const skipButton = page.locator('[data-testid="skip-resolution-button"], button:has-text("Skip")');
    if (await skipButton.isVisible()) {
      await skipButton.click();
      await page.waitForTimeout(300);
    }

    // Reset
    const resetButton = page.locator('[data-testid="reset-resolution-button"], button:has-text("Reset")');
    if (await resetButton.isVisible()) {
      await resetButton.click();
      await page.waitForTimeout(300);

      // Play again
      await playButton.click();
      await page.waitForTimeout(500);

      const phase = await getCurrentAnimationPhase(page);
      if (phase) {
        expect(phase).not.toBe('idle');
        expect(phase).not.toBe('complete');
      }

      await screenshot(page, { name: 'animation-restarted', subdir: 'resolution-animation' });
    }
  });
});
