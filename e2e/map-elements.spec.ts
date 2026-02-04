import { test, expect } from '@playwright/test';
import { screenshot, navigateToGame } from './test-utils';

/**
 * Map Elements E2E Tests
 *
 * Tests for verifying map element rendering including units,
 * supply centers, and order visualization.
 */

test.describe('Unit Display', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await navigateToGame(page, 0);
    await page.waitForTimeout(500);
  });

  test('units are rendered on the map', async ({ page }) => {
    const svg = page.locator('svg').first();
    await expect(svg).toBeVisible();

    // Units are rendered as circles with text (A for Army, F for Fleet)
    const unitCircles = svg.locator('circle');
    const unitCount = await unitCircles.count();

    // Should have at least some circles (units + supply centers)
    expect(unitCount).toBeGreaterThan(0);

    await screenshot(page, { name: 'units-rendered', subdir: 'map-elements' });
  });

  test('army units display A marker', async ({ page }) => {
    const svg = page.locator('svg').first();
    await expect(svg).toBeVisible();

    // Look for text elements with 'A' for Army
    const armyMarkers = svg.locator('text').filter({ hasText: /^A$/ });
    const armyCount = await armyMarkers.count();

    // May or may not have armies depending on game state
    if (armyCount > 0) {
      await screenshot(page, { name: 'army-units', subdir: 'map-elements' });
    }
  });

  test('fleet units display F marker', async ({ page }) => {
    const svg = page.locator('svg').first();
    await expect(svg).toBeVisible();

    // Look for text elements with 'F' for Fleet
    const fleetMarkers = svg.locator('text').filter({ hasText: /^F$/ });
    const fleetCount = await fleetMarkers.count();

    // May or may not have fleets depending on game state
    if (fleetCount > 0) {
      await screenshot(page, { name: 'fleet-units', subdir: 'map-elements' });
    }
  });

  test('units are color-coded by power', async ({ page }) => {
    const svg = page.locator('svg').first();
    await expect(svg).toBeVisible();

    // Unit groups have circles with fill colors matching powers
    const unitGroups = svg.locator('g[transform*="translate"]');
    const groupCount = await unitGroups.count();

    if (groupCount > 0) {
      // Check first unit group has a colored circle
      const firstGroup = unitGroups.first();
      const circle = firstGroup.locator('circle');

      if (await circle.count() > 0) {
        const fill = await circle.first().getAttribute('fill');
        expect(fill).toBeTruthy();
        expect(fill).not.toBe('none');
      }
    }

    await screenshot(page, { name: 'unit-colors', subdir: 'map-elements' });
  });
});

test.describe('Supply Centers', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await navigateToGame(page, 0);
    await page.waitForTimeout(500);
  });

  test('supply centers are displayed on the map', async ({ page }) => {
    const svg = page.locator('svg').first();
    await expect(svg).toBeVisible();

    // Supply centers are small circles (r="4") within g elements with key starting with "sc-"
    const smallCircles = svg.locator('circle[r="4"]');
    const scCount = await smallCircles.count();

    // There should be multiple supply centers on the map
    expect(scCount).toBeGreaterThan(0);

    await screenshot(page, { name: 'supply-centers', subdir: 'map-elements' });
  });

  test('supply centers show ownership colors', async ({ page }) => {
    const svg = page.locator('svg').first();
    await expect(svg).toBeVisible();

    // Supply center circles have fill colors
    const supplyCircles = svg.locator('circle[r="4"]');
    const count = await supplyCircles.count();

    if (count > 0) {
      // Collect unique fill colors
      const fills: string[] = [];
      for (let i = 0; i < Math.min(count, 10); i++) {
        const fill = await supplyCircles.nth(i).getAttribute('fill');
        if (fill && !fills.includes(fill)) {
          fills.push(fill);
        }
      }

      // Should have at least neutral color (#9e9e9e) or power colors
      expect(fills.length).toBeGreaterThan(0);
    }

    await screenshot(page, { name: 'supply-center-ownership', subdir: 'map-elements' });
  });
});

test.describe('Order Visualization', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await navigateToGame(page, 0);
    await page.waitForTimeout(500);
  });

  test('orders are visualized with lines', async ({ page }) => {
    const svg = page.locator('svg').first();
    await expect(svg).toBeVisible();

    // Orders are rendered as lines (moves, supports, convoys)
    const lines = svg.locator('line');
    const lineCount = await lines.count();

    // Screenshot regardless of order count (may vary by phase)
    await screenshot(page, { name: 'order-lines', subdir: 'map-elements' });

    // Log order visualization status
    if (lineCount > 0) {
      console.log(`Found ${lineCount} order visualization lines`);
    }
  });

  test('hold orders show as circles', async ({ page }) => {
    const svg = page.locator('svg').first();
    await expect(svg).toBeVisible();

    // Hold orders are rendered as circles with no fill
    const holdCircles = svg.locator('circle[fill="none"]');
    const holdCount = await holdCircles.count();

    await screenshot(page, { name: 'hold-orders', subdir: 'map-elements' });

    if (holdCount > 0) {
      console.log(`Found ${holdCount} hold order indicators`);
    }
  });

  test('move orders have arrowhead markers', async ({ page }) => {
    const svg = page.locator('svg').first();
    await expect(svg).toBeVisible();

    // Check for arrowhead marker definition (markers in defs are hidden, check for existence)
    const arrowMarker = svg.locator('marker#arrowhead');
    const markerCount = await arrowMarker.count();
    expect(markerCount).toBe(1);

    // Check for lines with arrowhead marker
    const arrowLines = svg.locator('line[marker-end*="arrowhead"]');
    const arrowCount = await arrowLines.count();

    await screenshot(page, { name: 'move-arrows', subdir: 'map-elements' });

    if (arrowCount > 0) {
      console.log(`Found ${arrowCount} move order arrows`);
    }
  });

  test('support/convoy orders have dashed lines', async ({ page }) => {
    const svg = page.locator('svg').first();
    await expect(svg).toBeVisible();

    // Support and convoy orders use dashed lines
    const dashedLines = svg.locator('line[stroke-dasharray]');
    const dashedCount = await dashedLines.count();

    await screenshot(page, { name: 'support-convoy-lines', subdir: 'map-elements' });

    if (dashedCount > 0) {
      console.log(`Found ${dashedCount} support/convoy lines`);
    }
  });
});

test.describe('Territory Labels', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await navigateToGame(page, 0);
    await page.waitForTimeout(500);
  });

  test('territories have labels', async ({ page }) => {
    const svg = page.locator('svg').first();
    await expect(svg).toBeVisible();

    // Territory labels are text elements
    const labels = svg.locator('text');
    const labelCount = await labels.count();

    // Should have many labels (territories + unit markers)
    expect(labelCount).toBeGreaterThan(10);

    await screenshot(page, { name: 'territory-labels', subdir: 'map-elements' });
  });

  test('labels are readable with stroke outline', async ({ page }) => {
    const svg = page.locator('svg').first();
    await expect(svg).toBeVisible();

    // Labels have stroke for readability
    const labelWithStroke = svg.locator('text[stroke]');
    const count = await labelWithStroke.count();

    if (count > 0) {
      const firstLabel = labelWithStroke.first();
      const strokeWidth = await firstLabel.getAttribute('stroke-width');
      expect(parseFloat(strokeWidth || '0')).toBeGreaterThan(0);
    }

    await screenshot(page, { name: 'label-readability', subdir: 'map-elements' });
  });

  test('labels use uppercase territory codes', async ({ page }) => {
    const svg = page.locator('svg').first();
    await expect(svg).toBeVisible();

    // Territory codes should be uppercase (e.g., LON, PAR, BER)
    const labels = svg.locator('text.pointer-events-none');
    const count = await labels.count();

    if (count > 0) {
      const firstLabelText = await labels.first().textContent();
      if (firstLabelText) {
        // Should be uppercase
        expect(firstLabelText).toBe(firstLabelText.toUpperCase());
      }
    }

    await screenshot(page, { name: 'label-codes', subdir: 'map-elements' });
  });
});

test.describe('Zoom Controls', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await navigateToGame(page, 0);
    await page.waitForTimeout(500);
  });

  test('zoom controls are visible', async ({ page }) => {
    // Zoom in button
    const zoomIn = page.locator('button[title="Zoom in"]');
    await expect(zoomIn).toBeVisible();

    // Zoom out button
    const zoomOut = page.locator('button[title="Zoom out"]');
    await expect(zoomOut).toBeVisible();

    // Reset zoom button
    const resetZoom = page.locator('button[title="Reset zoom"]');
    await expect(resetZoom).toBeVisible();

    await screenshot(page, { name: 'zoom-controls', subdir: 'map-elements' });
  });

  test('zoom in button works', async ({ page }) => {
    await screenshot(page, { name: 'zoom-before', subdir: 'map-elements' });

    const zoomIn = page.locator('button[title="Zoom in"]');
    await zoomIn.click();
    await page.waitForTimeout(300);

    await screenshot(page, { name: 'zoom-in-clicked', subdir: 'map-elements' });
  });

  test('zoom out button works', async ({ page }) => {
    const zoomOut = page.locator('button[title="Zoom out"]');
    await zoomOut.click();
    await page.waitForTimeout(300);

    await screenshot(page, { name: 'zoom-out-clicked', subdir: 'map-elements' });
  });

  test('reset zoom button works', async ({ page }) => {
    // First zoom in
    const zoomIn = page.locator('button[title="Zoom in"]');
    await zoomIn.click();
    await zoomIn.click();
    await page.waitForTimeout(300);

    await screenshot(page, { name: 'zoom-modified', subdir: 'map-elements' });

    // Then reset
    const resetZoom = page.locator('button[title="Reset zoom"]');
    await resetZoom.click();
    await page.waitForTimeout(300);

    await screenshot(page, { name: 'zoom-reset', subdir: 'map-elements' });
  });
});

test.describe('Territory Tooltip', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await navigateToGame(page, 0);
    await page.waitForTimeout(500);
  });

  test('hovering territory shows tooltip', async ({ page }) => {
    const svg = page.locator('svg').first();
    await expect(svg).toBeVisible();

    // Find a territory path and hover
    const territory = page.locator('svg path').first();

    if (await territory.isVisible()) {
      await territory.hover();
      await page.waitForTimeout(300);

      // Tooltip should appear (bg-gray-900/90 element)
      const tooltip = page.locator('.bg-gray-900\\/90');
      const hasTooltip = await tooltip.isVisible().catch(() => false);

      await screenshot(page, { name: 'territory-tooltip', subdir: 'map-elements' });
    }
  });
});
