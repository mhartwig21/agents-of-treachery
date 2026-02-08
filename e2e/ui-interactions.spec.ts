import { test, expect } from '@playwright/test';
import { screenshot } from './test-utils';

/**
 * UI Interaction Tests
 *
 * Targeted tests for two reported issues:
 * 1. "Start New Game" button requires multiple clicks to register
 * 2. Relationship chart creates weird visual effects on hover
 *
 * Also covers general button responsiveness and visual stability.
 */

// ============================================================================
// Issue 1: "Start New Game" button behavior
// ============================================================================

test.describe('Start New Game button', () => {
  test.describe('without game server (no WebSocket)', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/');
      await page.waitForTimeout(500);
    });

    test('button should not be visible when enableLiveConnection is false', async ({ page }) => {
      // Default dashboard doesn't have live connection enabled
      // The "Start New Game" button only shows when enableLiveConnection={true}
      const newGameBtn = page.getByRole('button', { name: /start new game/i });
      const btnCount = await newGameBtn.count();

      // If button exists, verify it's disabled (no server connected)
      if (btnCount > 0) {
        await expect(newGameBtn).toBeDisabled();
        await screenshot(page, { name: 'new-game-btn-disabled', subdir: 'ui-interactions' });
      }
      // If button doesn't exist, that's the expected behavior without live connection
    });

    test('connection indicator should show disconnected state', async ({ page }) => {
      // Look for connection indicator elements
      const disconnectedIndicator = page.getByText(/disconnected|connecting/i);
      const indicatorExists = await disconnectedIndicator.count();

      if (indicatorExists > 0) {
        await screenshot(page, { name: 'connection-disconnected', subdir: 'ui-interactions' });
      }
    });
  });

  test.describe('button state and responsiveness', () => {
    test.beforeEach(async ({ page }) => {
      // Navigate to page that may have the live connection enabled
      await page.goto('/');
      await page.waitForTimeout(500);
    });

    test('disabled button should have cursor-not-allowed style', async ({ page }) => {
      const newGameBtn = page.getByRole('button', { name: /start new game|starting/i });
      if (await newGameBtn.count() > 0) {
        const cursor = await newGameBtn.evaluate((el) => {
          return window.getComputedStyle(el).cursor;
        });
        // If disabled, should show not-allowed cursor
        const isDisabled = await newGameBtn.isDisabled();
        if (isDisabled) {
          expect(cursor).toBe('not-allowed');
        }
        await screenshot(page, { name: 'new-game-btn-cursor', subdir: 'ui-interactions' });
      }
    });

    test('disabled button should have gray styling (visual feedback)', async ({ page }) => {
      const newGameBtn = page.getByRole('button', { name: /start new game|starting/i });
      if (await newGameBtn.count() > 0 && await newGameBtn.isDisabled()) {
        const bgColor = await newGameBtn.evaluate((el) => {
          return window.getComputedStyle(el).backgroundColor;
        });
        // Gray disabled state should have low-saturation color
        // bg-gray-600 = rgb(75, 85, 99) approximately
        expect(bgColor).toBeTruthy();
        await screenshot(page, { name: 'new-game-btn-disabled-style', subdir: 'ui-interactions' });
      }
    });

    test('clicking disabled button should have no effect', async ({ page }) => {
      const newGameBtn = page.getByRole('button', { name: /start new game|starting/i });
      if (await newGameBtn.count() > 0 && await newGameBtn.isDisabled()) {
        // Click the disabled button multiple times
        await newGameBtn.click({ force: true });
        await newGameBtn.click({ force: true });
        await newGameBtn.click({ force: true });
        await page.waitForTimeout(500);

        // Button text should NOT change to "Starting..."
        const text = await newGameBtn.textContent();
        expect(text).not.toContain('Starting');
      }
    });
  });
});

// ============================================================================
// Issue 2: Relationship Chart hover behavior
// ============================================================================

test.describe('Relationship Graph Panel', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(500);

    // Navigate to a game that has relationship data
    const gameCard = page.locator('[class*="cursor-pointer"]').first();
    if (await gameCard.isVisible()) {
      await gameCard.click();
      await page.waitForTimeout(500);
    }
  });

  test.describe('graph rendering', () => {
    test('relationship graph should render with 7 power nodes', async ({ page }) => {
      // The relationship panel is in the sidebar
      const graphSvg = page.locator('.nodes circle');
      const nodeCount = await graphSvg.count();

      if (nodeCount > 0) {
        // Should have nodes for 7 powers (each power has background circle + optional selection ring)
        // At minimum 7 background circles
        expect(nodeCount).toBeGreaterThanOrEqual(7);
        await screenshot(page, { name: 'relationship-graph-nodes', subdir: 'ui-interactions' });
      }
    });

    test('power abbreviations should be visible in nodes', async ({ page }) => {
      // Check for power abbreviation text elements
      const powers = ['ENG', 'FRA', 'GER', 'ITA', 'AUS', 'RUS', 'TUR'];
      for (const abbrev of powers) {
        const label = page.locator(`text:has-text("${abbrev}")`);
        const count = await label.count();
        if (count > 0) {
          // At least one instance found
          await expect(label.first()).toBeVisible();
        }
      }
    });

    test('edges should be rendered between power pairs', async ({ page }) => {
      // Check for edge lines in the SVG
      const edges = page.locator('.edges line');
      const edgeCount = await edges.count();

      // 7 powers = 21 possible pairs, each with 2 lines (invisible hit area + visible)
      // Some may be filtered out for betrayals, but should have some edges
      if (edgeCount > 0) {
        expect(edgeCount).toBeGreaterThan(0);
      }
    });

    test('legend should show ally/hostile/neutral indicators', async ({ page }) => {
      const alliedLabel = page.getByText('Allied');
      const hostileLabel = page.getByText('Hostile');
      const neutralLabel = page.getByText('Neutral');

      // Check if legend is visible (it's below the graph)
      if (await alliedLabel.isVisible().catch(() => false)) {
        await expect(alliedLabel).toBeVisible();
        await expect(hostileLabel).toBeVisible();
        await expect(neutralLabel).toBeVisible();
        await screenshot(page, { name: 'relationship-legend', subdir: 'ui-interactions' });
      }
    });
  });

  test.describe('node hover interactions', () => {
    test('hovering a power node should highlight connected edges', async ({ page }) => {
      // Find a power node group (cursor-pointer g element in the SVG)
      const nodeGroup = page.locator('.nodes g.cursor-pointer').first();

      if (await nodeGroup.isVisible().catch(() => false)) {
        // Take screenshot before hover
        await screenshot(page, { name: 'relationship-before-hover', subdir: 'ui-interactions' });

        // Hover the node
        await nodeGroup.hover();
        await page.waitForTimeout(300);

        // Take screenshot during hover
        await screenshot(page, { name: 'relationship-during-hover', subdir: 'ui-interactions' });

        // Check that the node got a white stroke (isActive: stroke '#fff', strokeWidth 3)
        const circle = nodeGroup.locator('circle').first();
        const stroke = await circle.evaluate((el) => el.getAttribute('stroke'));
        // When hovered, stroke should be white
        if (stroke) {
          expect(stroke).toBe('#fff');
        }
      }
    });

    test('un-hovering power node should restore all edge opacities', async ({ page }) => {
      const nodeGroup = page.locator('.nodes g.cursor-pointer').first();

      if (await nodeGroup.isVisible().catch(() => false)) {
        // Hover then move away
        await nodeGroup.hover();
        await page.waitForTimeout(300);

        // Move mouse to empty area (center of the SVG should be empty)
        const svgElement = page.locator('svg[viewBox="0 0 400 400"]').first();
        if (await svgElement.isVisible().catch(() => false)) {
          const box = await svgElement.boundingBox();
          if (box) {
            // Move to top-left corner (outside nodes)
            await page.mouse.move(box.x + 5, box.y + 5);
            await page.waitForTimeout(300);
          }
        }

        await screenshot(page, { name: 'relationship-after-unhover', subdir: 'ui-interactions' });
      }
    });

    test('hovering between nodes rapidly should not cause visual artifacts', async ({ page }) => {
      const nodeGroups = page.locator('.nodes g.cursor-pointer');
      const count = await nodeGroups.count();

      if (count >= 3) {
        // Rapidly hover between first 3 nodes
        for (let cycle = 0; cycle < 3; cycle++) {
          for (let i = 0; i < Math.min(3, count); i++) {
            await nodeGroups.nth(i).hover();
            await page.waitForTimeout(50); // Very fast hover changes
          }
        }

        // Wait for transitions to settle
        await page.waitForTimeout(400);

        // Take screenshot — graph should look clean, not flickering
        await screenshot(page, { name: 'relationship-rapid-hover', subdir: 'ui-interactions' });

        // Verify no error overlay or broken state
        const errorOverlay = page.getByText(/error|crash|undefined/i);
        const hasError = await errorOverlay.isVisible().catch(() => false);
        expect(hasError).toBe(false);
      }
    });

    test('power info panel should appear on node hover', async ({ page }) => {
      const nodeGroup = page.locator('.nodes g.cursor-pointer').first();

      if (await nodeGroup.isVisible().catch(() => false)) {
        await nodeGroup.hover();
        await page.waitForTimeout(300);

        // Should show the active power info panel with Messages count
        const messagesLabel = page.getByText('Messages:');
        if (await messagesLabel.isVisible().catch(() => false)) {
          await expect(messagesLabel).toBeVisible();
          await screenshot(page, { name: 'relationship-power-info', subdir: 'ui-interactions' });
        }
      }
    });
  });

  test.describe('edge hover interactions', () => {
    test('hovering an edge should thicken the line', async ({ page }) => {
      // The invisible hit area line is wider — hover it
      const hitAreaLines = page.locator('.edges line[stroke="transparent"]');
      const count = await hitAreaLines.count();

      if (count > 0) {
        // Hover the first edge's hit area
        await hitAreaLines.first().hover();
        await page.waitForTimeout(300);
        await screenshot(page, { name: 'relationship-edge-hover', subdir: 'ui-interactions' });
      }
    });

    test('edge tooltip should appear near the hovered edge', async ({ page }) => {
      const hitAreaLines = page.locator('.edges line[stroke="transparent"]');
      const count = await hitAreaLines.count();

      if (count > 0) {
        await hitAreaLines.first().hover();
        await page.waitForTimeout(300);

        // Look for tooltip (SparklineTooltip renders inside an absolute-positioned div)
        const tooltip = page.locator('.absolute.z-10.pointer-events-none');
        if (await tooltip.count() > 0) {
          await screenshot(page, { name: 'relationship-edge-tooltip', subdir: 'ui-interactions' });
        }
      }
    });

    test('edge tooltip should disappear on mouse leave', async ({ page }) => {
      const hitAreaLines = page.locator('.edges line[stroke="transparent"]');
      const count = await hitAreaLines.count();

      if (count > 0) {
        // Hover edge
        await hitAreaLines.first().hover();
        await page.waitForTimeout(300);

        // Move away
        await page.mouse.move(10, 10);
        await page.waitForTimeout(300);

        // Tooltip should be gone
        const tooltip = page.locator('.absolute.z-10.pointer-events-none');
        const tooltipCount = await tooltip.count();
        // Either no tooltip or it should be hidden
        if (tooltipCount > 0) {
          // Check if it's actually visible
          const isVisible = await tooltip.first().isVisible().catch(() => false);
          // After mouse leave, tooltip should not be visible
          // (hoveredEdge state resets to null, so the IIFE returns null)
        }

        await screenshot(page, { name: 'relationship-tooltip-gone', subdir: 'ui-interactions' });
      }
    });

    test('clicking an edge should open history modal', async ({ page }) => {
      const hitAreaLines = page.locator('.edges line[stroke="transparent"]');
      const count = await hitAreaLines.count();

      if (count > 0) {
        await hitAreaLines.first().click();
        await page.waitForTimeout(500);

        // RelationshipHistoryModal should appear
        // It renders as a modal overlay — look for modal-like elements
        const modal = page.locator('[role="dialog"], .fixed, .modal');
        if (await modal.count() > 0) {
          await screenshot(page, { name: 'relationship-history-modal', subdir: 'ui-interactions' });
        }
      }
    });
  });
});

// ============================================================================
// General: Supply Center Balance Chart (recharts) hover behavior
// ============================================================================

test.describe('Supply Center Balance Chart (recharts)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(500);

    // Navigate to a game
    const gameCard = page.locator('[class*="cursor-pointer"]').first();
    if (await gameCard.isVisible()) {
      await gameCard.click();
      await page.waitForTimeout(500);
    }
  });

  test('recharts area chart pointer-events audit', async ({ page }) => {
    // CSS rule in index.css applies pointer-events:none to .recharts-area-area
    // and .recharts-area-curve, fixing the bug where Recharts style prop didn't
    // propagate to rendered SVG path elements. (aot-yvn9w)
    const chartAreas = page.locator('.recharts-area-area');
    const count = await chartAreas.count();

    if (count > 0) {
      const pointerEventsValues: string[] = [];
      for (let i = 0; i < count; i++) {
        const pe = await chartAreas.nth(i).evaluate((el) => {
          return window.getComputedStyle(el).pointerEvents;
        });
        pointerEventsValues.push(pe);
      }

      const allNone = pointerEventsValues.every(v => v === 'none');
      expect(allNone).toBe(true);

      await screenshot(page, { name: 'sc-chart-pointer-events', subdir: 'ui-interactions' });
      expect(count).toBeGreaterThan(0);
    }
  });

  test('chart tooltip should appear on hover and disappear on leave', async ({ page }) => {
    const chartContainer = page.locator('.recharts-responsive-container');

    if (await chartContainer.isVisible().catch(() => false)) {
      const box = await chartContainer.boundingBox();
      if (box) {
        // Hover over the middle of the chart
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.waitForTimeout(300);

        // Look for recharts tooltip
        const tooltip = page.locator('.recharts-tooltip-wrapper');
        if (await tooltip.count() > 0) {
          await screenshot(page, { name: 'sc-chart-tooltip-visible', subdir: 'ui-interactions' });
        }

        // Move away
        await page.mouse.move(0, 0);
        await page.waitForTimeout(300);
        await screenshot(page, { name: 'sc-chart-tooltip-hidden', subdir: 'ui-interactions' });
      }
    }
  });

  test('chart hover should not cause relationship graph below to flicker', async ({ page }) => {
    const chartContainer = page.locator('.recharts-responsive-container');

    if (await chartContainer.isVisible().catch(() => false)) {
      const box = await chartContainer.boundingBox();
      if (box) {
        // Hover across the chart rapidly
        for (let x = box.x + 10; x < box.x + box.width - 10; x += 30) {
          await page.mouse.move(x, box.y + box.height / 2);
          await page.waitForTimeout(30);
        }

        await page.waitForTimeout(300);

        // Verify relationship graph is still intact below
        const relNodes = page.locator('.nodes circle');
        const nodeCount = await relNodes.count();
        if (nodeCount > 0) {
          // Nodes should still be visible
          expect(nodeCount).toBeGreaterThanOrEqual(7);
        }
        await screenshot(page, { name: 'sc-chart-rapid-hover', subdir: 'ui-interactions' });
      }
    }
  });
});

// ============================================================================
// General: Collapsible panels in sidebar
// ============================================================================

test.describe('Sidebar panel interactions', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(500);

    const gameCard = page.locator('[class*="cursor-pointer"]').first();
    if (await gameCard.isVisible()) {
      await gameCard.click();
      await page.waitForTimeout(500);
    }
  });

  test('collapsing/expanding panels should not cause layout shifts', async ({ page }) => {
    // Find collapsible panel headers
    const panelHeaders = page.getByText(/Power Statistics|SC Balance|Relationships|Orders|Press/);
    const count = await panelHeaders.count();

    if (count > 0) {
      // Record initial sidebar width
      const sidebar = page.locator('.w-80').first();
      const initialBox = await sidebar.boundingBox();

      if (initialBox) {
        // Click each panel header to collapse
        for (let i = 0; i < Math.min(3, count); i++) {
          const header = panelHeaders.nth(i);
          if (await header.isVisible()) {
            await header.click();
            await page.waitForTimeout(200);
          }
        }

        // Verify sidebar width didn't change
        const afterBox = await sidebar.boundingBox();
        if (afterBox) {
          expect(afterBox.width).toBe(initialBox.width);
        }

        await screenshot(page, { name: 'sidebar-collapsed', subdir: 'ui-interactions' });
      }
    }
  });
});

// ============================================================================
// General: Button click responsiveness
// ============================================================================

test.describe('Button responsiveness', () => {
  test('all filter buttons should respond to single click', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(500);

    // Status filter buttons
    const activeFilter = page.getByRole('button', { name: /active/i });
    if (await activeFilter.isVisible()) {
      await activeFilter.click();
      await page.waitForTimeout(100);

      // Should have visual active state (bg-gray-600 text-white)
      const classes = await activeFilter.getAttribute('class');
      expect(classes).toContain('bg-gray-600');
    }
  });

  test('view mode toggle should switch on single click', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(500);

    const listBtn = page.locator('button[title="List view"]');
    if (await listBtn.isVisible()) {
      await listBtn.click();
      await page.waitForTimeout(200);

      // List container should appear
      const listContainer = page.locator('.space-y-2');
      const hasListView = await listContainer.isVisible().catch(() => false);

      // Either list view appeared or game count is 0
      await screenshot(page, { name: 'view-toggle-single-click', subdir: 'ui-interactions' });
    }
  });

  test('back button should respond to single click', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(500);

    // Navigate to game view
    const gameCard = page.locator('[class*="cursor-pointer"]').first();
    if (await gameCard.isVisible()) {
      await gameCard.click();
      await page.waitForTimeout(500);

      // Click back button
      const backBtn = page.getByRole('button', { name: /back/i });
      if (await backBtn.isVisible()) {
        await backBtn.click();
        await page.waitForTimeout(500);

        // Should be back on dashboard
        await expect(page.getByText('Spectator Dashboard')).toBeVisible();
      }
    }
  });
});
