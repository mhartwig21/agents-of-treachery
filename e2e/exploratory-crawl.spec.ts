import { test, expect, Page } from '@playwright/test';
import { screenshot } from './test-utils';

/**
 * Exploratory UI Crawl
 *
 * Systematically interacts with every clickable element, form input,
 * and hover target across all views. Captures console errors, JS
 * exceptions, and failed network requests as bugs.
 */

// Collect errors during each test
interface ErrorLog {
  consoleErrors: string[];
  jsExceptions: string[];
  failedRequests: string[];
}

function attachErrorCollectors(page: Page): ErrorLog {
  const errors: ErrorLog = {
    consoleErrors: [],
    jsExceptions: [],
    failedRequests: [],
  };

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      errors.consoleErrors.push(msg.text());
    }
  });

  page.on('pageerror', (error) => {
    errors.jsExceptions.push(`${error.name}: ${error.message}`);
  });

  page.on('requestfailed', (request) => {
    // Ignore WebSocket connection failures (expected without server)
    if (!request.url().includes('ws://')) {
      errors.failedRequests.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText}`);
    }
  });

  return errors;
}

function reportErrors(errors: ErrorLog, context: string) {
  const total = errors.consoleErrors.length + errors.jsExceptions.length + errors.failedRequests.length;
  if (total > 0) {
    console.log(`\n=== ERRORS in: ${context} ===`);
    if (errors.consoleErrors.length) {
      console.log(`Console errors (${errors.consoleErrors.length}):`);
      errors.consoleErrors.forEach(e => console.log(`  - ${e.slice(0, 200)}`));
    }
    if (errors.jsExceptions.length) {
      console.log(`JS exceptions (${errors.jsExceptions.length}):`);
      errors.jsExceptions.forEach(e => console.log(`  - ${e.slice(0, 200)}`));
    }
    if (errors.failedRequests.length) {
      console.log(`Failed requests (${errors.failedRequests.length}):`);
      errors.failedRequests.forEach(e => console.log(`  - ${e.slice(0, 200)}`));
    }
  }
  return total;
}

// ============================================================================
// Dashboard Crawl — click EVERYTHING on the main page
// ============================================================================

test.describe('Exploratory: Dashboard', () => {
  test('click every button on the dashboard', async ({ page }) => {
    const errors = attachErrorCollectors(page);
    await page.goto('/');
    await page.waitForTimeout(500);
    await screenshot(page, { name: 'dashboard-initial', subdir: 'exploratory' });

    // Find ALL buttons
    const buttons = page.locator('button');
    const buttonCount = await buttons.count();
    console.log(`Found ${buttonCount} buttons on dashboard`);

    const clickedButtons: string[] = [];

    for (let i = 0; i < buttonCount; i++) {
      const btn = buttons.nth(i);
      if (await btn.isVisible().catch(() => false)) {
        const text = (await btn.textContent())?.trim() || '';
        const title = await btn.getAttribute('title') || '';
        const label = text || title || `button-${i}`;

        try {
          await btn.click({ timeout: 2000 });
          clickedButtons.push(`✓ ${label}`);
          await page.waitForTimeout(150);
        } catch (e) {
          clickedButtons.push(`✗ ${label}: ${(e as Error).message.slice(0, 80)}`);
        }
      }
    }

    console.log(`Clicked buttons:\n${clickedButtons.join('\n')}`);
    await screenshot(page, { name: 'dashboard-after-clicks', subdir: 'exploratory' });

    const errorCount = reportErrors(errors, 'Dashboard buttons');
    expect(errors.jsExceptions).toHaveLength(0);
  });

  test('interact with every form input on dashboard', async ({ page }) => {
    const errors = attachErrorCollectors(page);
    await page.goto('/');
    await page.waitForTimeout(500);

    // Find all inputs
    const inputs = page.locator('input, textarea, select');
    const inputCount = await inputs.count();
    console.log(`Found ${inputCount} form inputs on dashboard`);

    for (let i = 0; i < inputCount; i++) {
      const input = inputs.nth(i);
      if (await input.isVisible().catch(() => false)) {
        const type = await input.getAttribute('type') || 'text';
        const placeholder = await input.getAttribute('placeholder') || '';

        try {
          await input.click();
          await input.fill('test input 123');
          await page.waitForTimeout(100);
          await screenshot(page, { name: `dashboard-input-${i}-filled`, subdir: 'exploratory' });
          await input.fill('');
          await page.waitForTimeout(100);
          console.log(`✓ Input ${i}: type=${type} placeholder="${placeholder}"`);
        } catch (e) {
          console.log(`✗ Input ${i}: ${(e as Error).message.slice(0, 80)}`);
        }
      }
    }

    expect(errors.jsExceptions).toHaveLength(0);
  });

  test('hover every interactive element on dashboard', async ({ page }) => {
    const errors = attachErrorCollectors(page);
    await page.goto('/');
    await page.waitForTimeout(500);

    // Hover all interactive elements
    const interactives = page.locator('button, a, [role="button"], [class*="cursor-pointer"], [class*="hover:"]');
    const count = await interactives.count();
    console.log(`Found ${count} interactive elements to hover`);

    for (let i = 0; i < count; i++) {
      const el = interactives.nth(i);
      if (await el.isVisible().catch(() => false)) {
        try {
          await el.hover({ timeout: 1000 });
          await page.waitForTimeout(50);
        } catch {
          // Element may have scrolled off or be obscured
        }
      }
    }

    await screenshot(page, { name: 'dashboard-after-hovers', subdir: 'exploratory' });
    expect(errors.jsExceptions).toHaveLength(0);
  });

  test('rapidly click filter buttons to test state races', async ({ page }) => {
    const errors = attachErrorCollectors(page);
    await page.goto('/');
    await page.waitForTimeout(500);

    const allBtn = page.getByRole('button', { name: /all/i });
    const activeBtn = page.getByRole('button', { name: /active/i });
    const completedBtn = page.getByRole('button', { name: /completed/i });

    // Rapid fire clicks between filters
    for (let i = 0; i < 10; i++) {
      if (await activeBtn.isVisible()) await activeBtn.click();
      if (await completedBtn.isVisible()) await completedBtn.click();
      if (await allBtn.isVisible()) await allBtn.click();
    }
    await page.waitForTimeout(300);

    await screenshot(page, { name: 'dashboard-rapid-filter', subdir: 'exploratory' });
    expect(errors.jsExceptions).toHaveLength(0);
  });

  test('type rapidly in search and clear', async ({ page }) => {
    const errors = attachErrorCollectors(page);
    await page.goto('/');
    await page.waitForTimeout(500);

    const searchInput = page.getByPlaceholder(/search/i);
    if (await searchInput.isVisible()) {
      // Type character by character rapidly
      for (const char of 'Championship Game Test') {
        await searchInput.press(char === ' ' ? 'Space' : `Key${char.toUpperCase()}`);
        await page.waitForTimeout(20);
      }
      await screenshot(page, { name: 'search-typing-rapid', subdir: 'exploratory' });

      // Select all and delete
      await searchInput.press('Control+a');
      await searchInput.press('Backspace');
      await page.waitForTimeout(200);
      await screenshot(page, { name: 'search-cleared-rapid', subdir: 'exploratory' });
    }

    expect(errors.jsExceptions).toHaveLength(0);
  });
});

// ============================================================================
// Game View Crawl — click everything inside a game
// ============================================================================

test.describe('Exploratory: Game View', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(500);
    // Navigate to first game
    const gameCard = page.locator('[class*="cursor-pointer"]').first();
    if (await gameCard.isVisible()) {
      await gameCard.click();
      await page.waitForTimeout(500);
    }
  });

  test('click every button in game view', async ({ page }) => {
    const errors = attachErrorCollectors(page);
    await screenshot(page, { name: 'gameview-initial', subdir: 'exploratory' });

    const buttons = page.locator('button');
    const buttonCount = await buttons.count();
    console.log(`Found ${buttonCount} buttons in game view`);

    const results: string[] = [];

    for (let i = 0; i < buttonCount; i++) {
      const btn = buttons.nth(i);
      if (await btn.isVisible().catch(() => false)) {
        const text = (await btn.textContent())?.trim().slice(0, 40) || '';
        const title = await btn.getAttribute('title') || '';
        const label = text || title || `btn-${i}`;

        try {
          await btn.scrollIntoViewIfNeeded({ timeout: 1000 });
          await btn.click({ timeout: 2000 });
          results.push(`✓ ${label}`);
          await page.waitForTimeout(100);
        } catch (e) {
          results.push(`✗ ${label}: ${(e as Error).message.slice(0, 60)}`);
        }
      }
    }

    console.log(`Game view buttons:\n${results.join('\n')}`);
    await screenshot(page, { name: 'gameview-after-clicks', subdir: 'exploratory' });
    expect(errors.jsExceptions).toHaveLength(0);
  });

  test('click every collapsible panel header to toggle', async ({ page }) => {
    const errors = attachErrorCollectors(page);

    // Find panel headers by looking for common panel title text
    const panelTitles = [
      'Power Statistics', 'SC Balance', 'Relationships',
      'Orders', 'Press Channels', 'Live Activity',
    ];

    for (const title of panelTitles) {
      const header = page.getByText(title, { exact: false }).first();
      if (await header.isVisible().catch(() => false)) {
        // Click to collapse
        await header.click();
        await page.waitForTimeout(200);
        await screenshot(page, { name: `panel-collapsed-${title.replace(/\s+/g, '-').toLowerCase()}`, subdir: 'exploratory' });

        // Click to expand
        await header.click();
        await page.waitForTimeout(200);
        await screenshot(page, { name: `panel-expanded-${title.replace(/\s+/g, '-').toLowerCase()}`, subdir: 'exploratory' });
      }
    }

    expect(errors.jsExceptions).toHaveLength(0);
  });

  test('collapse ALL panels then expand ALL', async ({ page }) => {
    const errors = attachErrorCollectors(page);

    const panelTitles = ['Power Statistics', 'SC Balance', 'Relationships', 'Orders', 'Press Channels'];

    // Collapse all
    for (const title of panelTitles) {
      const header = page.getByText(title, { exact: false }).first();
      if (await header.isVisible().catch(() => false)) {
        await header.click();
        await page.waitForTimeout(100);
      }
    }
    await screenshot(page, { name: 'all-panels-collapsed', subdir: 'exploratory' });

    // Expand all
    for (const title of panelTitles) {
      const header = page.getByText(title, { exact: false }).first();
      if (await header.isVisible().catch(() => false)) {
        await header.click();
        await page.waitForTimeout(100);
      }
    }
    await screenshot(page, { name: 'all-panels-expanded', subdir: 'exploratory' });

    expect(errors.jsExceptions).toHaveLength(0);
  });

  test('click all power stat entries to select/deselect powers', async ({ page }) => {
    const errors = attachErrorCollectors(page);

    // Power names that appear in the stats panel
    const powers = ['England', 'France', 'Germany', 'Italy', 'Austria', 'Russia', 'Turkey'];

    for (const power of powers) {
      const powerEl = page.getByText(power, { exact: true }).first();
      if (await powerEl.isVisible().catch(() => false)) {
        await powerEl.click();
        await page.waitForTimeout(200);
        await screenshot(page, { name: `power-selected-${power.toLowerCase()}`, subdir: 'exploratory' });
      }
    }

    // Click first power again to deselect
    const firstPower = page.getByText('England', { exact: true }).first();
    if (await firstPower.isVisible().catch(() => false)) {
      await firstPower.click();
      await page.waitForTimeout(200);
    }

    expect(errors.jsExceptions).toHaveLength(0);
  });

  test('interact with turn scrubber', async ({ page }) => {
    const errors = attachErrorCollectors(page);

    // Look for scrubber elements — range input or clickable timeline
    const scrubber = page.locator('input[type="range"]');
    if (await scrubber.isVisible().catch(() => false)) {
      const box = await scrubber.boundingBox();
      if (box) {
        // Click at different positions along the scrubber
        for (let pct = 0; pct <= 100; pct += 20) {
          const x = box.x + (box.width * pct / 100);
          await page.mouse.click(x, box.y + box.height / 2);
          await page.waitForTimeout(200);
        }
        await screenshot(page, { name: 'scrubber-traversed', subdir: 'exploratory' });
      }
    }

    // Also try scrubber buttons (prev/next) — use title attribute to avoid matching Back button
    const prevBtn = page.locator('button[title*="prev" i], button[aria-label*="prev" i]');
    const nextBtn = page.locator('button[title*="next" i], button[aria-label*="next" i]');

    if (await nextBtn.first().isVisible().catch(() => false)) {
      const isEnabled = await nextBtn.first().isEnabled().catch(() => false);
      if (isEnabled) {
        for (let i = 0; i < 5; i++) {
          await nextBtn.first().click();
          await page.waitForTimeout(150);
        }
        await screenshot(page, { name: 'scrubber-next-5', subdir: 'exploratory' });
      } else {
        console.log('FINDING: Turn scrubber next button is visible but disabled');
        await screenshot(page, { name: 'scrubber-next-disabled', subdir: 'exploratory' });
      }
    }

    if (await prevBtn.first().isVisible().catch(() => false)) {
      const isDisabled = await prevBtn.first().evaluate(el => (el as HTMLButtonElement).disabled).catch(() => true);
      if (!isDisabled) {
        for (let i = 0; i < 5; i++) {
          const stillEnabled = await prevBtn.first().evaluate(el => !(el as HTMLButtonElement).disabled).catch(() => false);
          if (!stillEnabled) break;
          await prevBtn.first().click({ force: true });
          await page.waitForTimeout(150);
        }
        await screenshot(page, { name: 'scrubber-prev-5', subdir: 'exploratory' });
      } else {
        console.log('FINDING: Turn scrubber prev button is visible but disabled');
        await screenshot(page, { name: 'scrubber-prev-disabled', subdir: 'exploratory' });
      }
    }

    expect(errors.jsExceptions).toHaveLength(0);
  });

  test('interact with the Diplomacy map: click territories', async ({ page }) => {
    const errors = attachErrorCollectors(page);

    // Find SVG territory paths (the main map SVG, not the relationship graph)
    // The DiplomacyMap renders territories as path elements
    const mapSvg = page.locator('svg').first();

    if (await mapSvg.isVisible()) {
      // Click at various positions across the map
      const box = await mapSvg.boundingBox();
      if (box) {
        const clickPoints = [
          { x: 0.3, y: 0.3 },  // Northwest
          { x: 0.5, y: 0.3 },  // North
          { x: 0.7, y: 0.3 },  // Northeast
          { x: 0.3, y: 0.5 },  // West
          { x: 0.5, y: 0.5 },  // Center
          { x: 0.7, y: 0.5 },  // East
          { x: 0.3, y: 0.7 },  // Southwest
          { x: 0.5, y: 0.7 },  // South
          { x: 0.7, y: 0.7 },  // Southeast
        ];

        for (const pt of clickPoints) {
          const x = box.x + box.width * pt.x;
          const y = box.y + box.height * pt.y;
          await page.mouse.click(x, y);
          await page.waitForTimeout(100);
        }
        await screenshot(page, { name: 'map-clicked-grid', subdir: 'exploratory' });
      }
    }

    expect(errors.jsExceptions).toHaveLength(0);
  });

  test('map zoom controls', async ({ page }) => {
    const errors = attachErrorCollectors(page);

    // Find zoom buttons
    const zoomIn = page.locator('button[title*="zoom in" i], button:has-text("+")').first();
    const zoomOut = page.locator('button[title*="zoom out" i], button:has-text("-")').first();
    const zoomReset = page.locator('button[title*="reset" i], button:has-text("⟲")').first();

    if (await zoomIn.isVisible().catch(() => false)) {
      // Zoom in 3 times
      for (let i = 0; i < 3; i++) {
        await zoomIn.click();
        await page.waitForTimeout(200);
      }
      await screenshot(page, { name: 'map-zoomed-in', subdir: 'exploratory' });

      // Zoom out 6 times (past original)
      if (await zoomOut.isVisible().catch(() => false)) {
        for (let i = 0; i < 6; i++) {
          await zoomOut.click();
          await page.waitForTimeout(200);
        }
        await screenshot(page, { name: 'map-zoomed-out', subdir: 'exploratory' });
      }

      // Reset
      if (await zoomReset.isVisible().catch(() => false)) {
        await zoomReset.click();
        await page.waitForTimeout(200);
        await screenshot(page, { name: 'map-zoom-reset', subdir: 'exploratory' });
      }
    }

    // Try mouse wheel zoom
    const mapSvg = page.locator('svg').first();
    if (await mapSvg.isVisible()) {
      const box = await mapSvg.boundingBox();
      if (box) {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.wheel(0, -300); // Scroll up = zoom in
        await page.waitForTimeout(200);
        await screenshot(page, { name: 'map-wheel-zoom-in', subdir: 'exploratory' });

        await page.mouse.wheel(0, 600); // Scroll down = zoom out
        await page.waitForTimeout(200);
        await screenshot(page, { name: 'map-wheel-zoom-out', subdir: 'exploratory' });
      }
    }

    expect(errors.jsExceptions).toHaveLength(0);
  });

  test('map drag/pan', async ({ page }) => {
    const errors = attachErrorCollectors(page);

    const mapSvg = page.locator('svg').first();
    if (await mapSvg.isVisible()) {
      const box = await mapSvg.boundingBox();
      if (box) {
        const cx = box.x + box.width / 2;
        const cy = box.y + box.height / 2;

        // Drag from center to various directions
        const drags = [
          { dx: 100, dy: 0, name: 'right' },
          { dx: -200, dy: 0, name: 'left' },
          { dx: 100, dy: 100, name: 'down' },
          { dx: 0, dy: -200, name: 'up' },
        ];

        for (const drag of drags) {
          await page.mouse.move(cx, cy);
          await page.mouse.down();
          await page.mouse.move(cx + drag.dx, cy + drag.dy, { steps: 10 });
          await page.mouse.up();
          await page.waitForTimeout(200);
          await screenshot(page, { name: `map-drag-${drag.name}`, subdir: 'exploratory' });
        }
      }
    }

    expect(errors.jsExceptions).toHaveLength(0);
  });

  test('hover all map territories for tooltip coverage', async ({ page }) => {
    const errors = attachErrorCollectors(page);

    const mapSvg = page.locator('svg').first();
    if (await mapSvg.isVisible()) {
      const box = await mapSvg.boundingBox();
      if (box) {
        // Sweep across the map in a grid pattern
        const steps = 8;
        let tooltipsFound = 0;

        for (let row = 0; row < steps; row++) {
          for (let col = 0; col < steps; col++) {
            const x = box.x + (box.width * (col + 0.5) / steps);
            const y = box.y + (box.height * (row + 0.5) / steps);
            await page.mouse.move(x, y);
            await page.waitForTimeout(30);

            // Check if tooltip appeared
            const tooltip = page.locator('[role="tooltip"], .tooltip, [class*="tooltip"]');
            if (await tooltip.isVisible().catch(() => false)) {
              tooltipsFound++;
            }
          }
        }

        console.log(`Map hover sweep: ${tooltipsFound} tooltips found over ${steps * steps} positions`);
        await screenshot(page, { name: 'map-hover-sweep', subdir: 'exploratory' });
      }
    }

    expect(errors.jsExceptions).toHaveLength(0);
  });
});

// ============================================================================
// Player Mode Crawl
// ============================================================================

test.describe('Exploratory: Player Mode', () => {
  test('switch to player mode and click everything', async ({ page }) => {
    const errors = attachErrorCollectors(page);
    await page.goto('/');
    await page.waitForTimeout(500);

    const playerModeBtn = page.getByRole('button', { name: /player mode/i });
    if (await playerModeBtn.isVisible().catch(() => false)) {
      await playerModeBtn.click();
      await page.waitForTimeout(500);
      await screenshot(page, { name: 'player-mode-initial', subdir: 'exploratory' });

      // Click every button in player mode
      const buttons = page.locator('button');
      const buttonCount = await buttons.count();
      console.log(`Found ${buttonCount} buttons in player mode`);

      for (let i = 0; i < buttonCount; i++) {
        const btn = buttons.nth(i);
        if (await btn.isVisible().catch(() => false)) {
          const text = (await btn.textContent())?.trim().slice(0, 40) || `btn-${i}`;
          try {
            await btn.click({ timeout: 1000 });
            console.log(`✓ Player mode: ${text}`);
            await page.waitForTimeout(100);
          } catch {
            // Element may not be clickable
          }
        }
      }

      await screenshot(page, { name: 'player-mode-after-clicks', subdir: 'exploratory' });
    }

    expect(errors.jsExceptions).toHaveLength(0);
  });
});

// ============================================================================
// Navigation stress test — rapid view switching
// ============================================================================

test.describe('Exploratory: Navigation Stress', () => {
  test('rapidly switch between dashboard and game view', async ({ page }) => {
    const errors = attachErrorCollectors(page);
    await page.goto('/');
    await page.waitForTimeout(500);

    for (let i = 0; i < 5; i++) {
      // Click into game
      const gameCard = page.locator('[class*="cursor-pointer"]').first();
      if (await gameCard.isVisible().catch(() => false)) {
        await gameCard.click();
        await page.waitForTimeout(200);
      }

      // Click back
      const backBtn = page.getByRole('button', { name: /back/i });
      if (await backBtn.isVisible().catch(() => false)) {
        await backBtn.click();
        await page.waitForTimeout(200);
      }
    }

    await screenshot(page, { name: 'rapid-navigation', subdir: 'exploratory' });

    // Dashboard should still be intact
    await expect(page.getByText('Spectator Dashboard')).toBeVisible();
    expect(errors.jsExceptions).toHaveLength(0);
  });

  test('rapidly switch between all game cards', async ({ page }) => {
    const errors = attachErrorCollectors(page);
    await page.goto('/');
    await page.waitForTimeout(500);

    const gameCards = page.locator('[class*="cursor-pointer"]');
    const count = await gameCards.count();
    console.log(`Found ${count} game cards`);

    // Click each card, capture, go back
    for (let i = 0; i < count; i++) {
      const card = gameCards.nth(i);
      if (await card.isVisible().catch(() => false)) {
        await card.click();
        await page.waitForTimeout(300);
        await screenshot(page, { name: `game-card-${i}`, subdir: 'exploratory' });

        const backBtn = page.getByRole('button', { name: /back/i });
        if (await backBtn.isVisible().catch(() => false)) {
          await backBtn.click();
          await page.waitForTimeout(300);
        }
      }
    }

    expect(errors.jsExceptions).toHaveLength(0);
  });

  test('player mode <-> spectator mode rapid toggle', async ({ page }) => {
    const errors = attachErrorCollectors(page);
    await page.goto('/');
    await page.waitForTimeout(500);

    for (let i = 0; i < 8; i++) {
      const playerBtn = page.getByRole('button', { name: /player mode/i });
      const spectatorBtn = page.getByRole('button', { name: /spectator mode/i });

      if (await playerBtn.isVisible().catch(() => false)) {
        await playerBtn.click();
        await page.waitForTimeout(100);
      } else if (await spectatorBtn.isVisible().catch(() => false)) {
        await spectatorBtn.click();
        await page.waitForTimeout(100);
      }
    }

    await screenshot(page, { name: 'mode-toggle-stress', subdir: 'exploratory' });
    expect(errors.jsExceptions).toHaveLength(0);
  });
});

// ============================================================================
// Relationship Graph deep crawl
// ============================================================================

test.describe('Exploratory: Relationship Graph Deep Crawl', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(500);
    const gameCard = page.locator('[class*="cursor-pointer"]').first();
    if (await gameCard.isVisible()) {
      await gameCard.click();
      await page.waitForTimeout(500);
    }
  });

  test('click every power node in the relationship graph', async ({ page }) => {
    const errors = attachErrorCollectors(page);

    const nodeGroups = page.locator('.nodes g.cursor-pointer');
    const count = await nodeGroups.count();
    console.log(`Found ${count} power nodes in relationship graph`);

    for (let i = 0; i < count; i++) {
      const node = nodeGroups.nth(i);
      if (await node.isVisible().catch(() => false)) {
        await node.click();
        await page.waitForTimeout(200);
        await screenshot(page, { name: `rel-node-click-${i}`, subdir: 'exploratory' });
      }
    }

    expect(errors.jsExceptions).toHaveLength(0);
  });

  test('click every edge in the relationship graph', async ({ page }) => {
    const errors = attachErrorCollectors(page);

    const hitAreas = page.locator('.edges line[stroke="transparent"]');
    const count = await hitAreas.count();
    console.log(`Found ${count} clickable edges in relationship graph`);

    for (let i = 0; i < count; i++) {
      const edge = hitAreas.nth(i);
      if (await edge.isVisible().catch(() => false)) {
        await edge.click();
        await page.waitForTimeout(300);
        await screenshot(page, { name: `rel-edge-click-${i}`, subdir: 'exploratory' });

        // Close any modal that opened
        await page.keyboard.press('Escape');
        await page.waitForTimeout(100);
      }
    }

    expect(errors.jsExceptions).toHaveLength(0);
  });

  test('hover every edge and check tooltip positioning', async ({ page }) => {
    const errors = attachErrorCollectors(page);

    const hitAreas = page.locator('.edges line[stroke="transparent"]');
    const count = await hitAreas.count();
    const tooltipIssues: string[] = [];

    for (let i = 0; i < count; i++) {
      const edge = hitAreas.nth(i);
      if (await edge.isVisible().catch(() => false)) {
        await edge.hover();
        await page.waitForTimeout(200);

        // Check if tooltip appeared and is within viewport
        const tooltip = page.locator('.absolute.z-10.pointer-events-none');
        if (await tooltip.isVisible().catch(() => false)) {
          const tooltipBox = await tooltip.boundingBox();
          const viewportSize = page.viewportSize();
          if (tooltipBox && viewportSize) {
            // Check if tooltip is clipped by viewport
            if (tooltipBox.x < 0) tooltipIssues.push(`Edge ${i}: tooltip clipped left (x=${tooltipBox.x})`);
            if (tooltipBox.y < 0) tooltipIssues.push(`Edge ${i}: tooltip clipped top (y=${tooltipBox.y})`);
            if (tooltipBox.x + tooltipBox.width > viewportSize.width)
              tooltipIssues.push(`Edge ${i}: tooltip clipped right`);
            if (tooltipBox.y + tooltipBox.height > viewportSize.height)
              tooltipIssues.push(`Edge ${i}: tooltip clipped bottom`);
          }
        }
      }
    }

    if (tooltipIssues.length > 0) {
      console.log(`Tooltip positioning issues:\n${tooltipIssues.join('\n')}`);
    }

    await page.mouse.move(0, 0); // Clear hover
    expect(errors.jsExceptions).toHaveLength(0);
  });
});

// ============================================================================
// Keyboard-only navigation crawl
// ============================================================================

test.describe('Exploratory: Keyboard Navigation', () => {
  test('tab through entire dashboard', async ({ page }) => {
    const errors = attachErrorCollectors(page);
    await page.goto('/');
    await page.waitForTimeout(500);

    const focusedElements: string[] = [];

    // Tab through all elements
    for (let i = 0; i < 50; i++) {
      await page.keyboard.press('Tab');
      await page.waitForTimeout(50);

      const focused = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el) return 'none';
        const tag = el.tagName.toLowerCase();
        const text = (el.textContent || '').trim().slice(0, 30);
        const role = el.getAttribute('role') || '';
        return `${tag}${role ? `[${role}]` : ''}: "${text}"`;
      });

      focusedElements.push(focused);

      // If we loop back to body, we've tabbed through everything
      if (focused === 'body: ""') break;
    }

    console.log(`Tab order (${focusedElements.length} elements):\n${focusedElements.join('\n')}`);
    await screenshot(page, { name: 'keyboard-tab-final', subdir: 'exploratory' });

    expect(errors.jsExceptions).toHaveLength(0);
  });

  test('Enter key activates focused buttons', async ({ page }) => {
    const errors = attachErrorCollectors(page);
    await page.goto('/');
    await page.waitForTimeout(500);

    // Tab to first button and press Enter
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press('Tab');
      const tagName = await page.evaluate(() => document.activeElement?.tagName);
      if (tagName === 'BUTTON') {
        const text = await page.evaluate(() => document.activeElement?.textContent?.trim());
        console.log(`Pressing Enter on button: "${text}"`);
        await page.keyboard.press('Enter');
        await page.waitForTimeout(200);
        break;
      }
    }

    expect(errors.jsExceptions).toHaveLength(0);
  });
});

// ============================================================================
// Resize / Viewport tests
// ============================================================================

test.describe('Exploratory: Viewport Resize', () => {
  test('resize viewport from desktop to mobile and back', async ({ page }) => {
    const errors = attachErrorCollectors(page);
    await page.goto('/');
    await page.waitForTimeout(500);

    const sizes = [
      { width: 1280, height: 720, name: 'desktop' },
      { width: 768, height: 1024, name: 'tablet' },
      { width: 375, height: 667, name: 'mobile' },
      { width: 320, height: 568, name: 'small-mobile' },
      { width: 1920, height: 1080, name: 'fullhd' },
    ];

    for (const size of sizes) {
      await page.setViewportSize(size);
      await page.waitForTimeout(300);
      await screenshot(page, { name: `viewport-${size.name}`, subdir: 'exploratory' });

      // Verify no horizontal overflow
      const hasOverflow = await page.evaluate(() => {
        return document.documentElement.scrollWidth > document.documentElement.clientWidth;
      });
      if (hasOverflow) {
        console.log(`WARNING: Horizontal overflow at ${size.name} (${size.width}x${size.height})`);
      }
    }

    expect(errors.jsExceptions).toHaveLength(0);
  });

  test('game view at different viewport sizes', async ({ page }) => {
    const errors = attachErrorCollectors(page);
    await page.goto('/');
    await page.waitForTimeout(500);

    const gameCard = page.locator('[class*="cursor-pointer"]').first();
    if (await gameCard.isVisible()) {
      await gameCard.click();
      await page.waitForTimeout(500);
    }

    const sizes = [
      { width: 1280, height: 720, name: 'game-desktop' },
      { width: 768, height: 1024, name: 'game-tablet' },
      { width: 375, height: 667, name: 'game-mobile' },
    ];

    for (const size of sizes) {
      await page.setViewportSize(size);
      await page.waitForTimeout(300);
      await screenshot(page, { name: `viewport-${size.name}`, subdir: 'exploratory' });
    }

    expect(errors.jsExceptions).toHaveLength(0);
  });
});

// ============================================================================
// Double-click and right-click exploration
// ============================================================================

test.describe('Exploratory: Unusual Interactions', () => {
  test('double-click on game cards', async ({ page }) => {
    const errors = attachErrorCollectors(page);
    await page.goto('/');
    await page.waitForTimeout(500);

    const gameCard = page.locator('[class*="cursor-pointer"]').first();
    if (await gameCard.isVisible()) {
      await gameCard.dblclick();
      await page.waitForTimeout(500);
      await screenshot(page, { name: 'double-click-card', subdir: 'exploratory' });
    }

    expect(errors.jsExceptions).toHaveLength(0);
  });

  test('right-click on map should not crash', async ({ page }) => {
    const errors = attachErrorCollectors(page);
    await page.goto('/');
    await page.waitForTimeout(500);

    const gameCard = page.locator('[class*="cursor-pointer"]').first();
    if (await gameCard.isVisible()) {
      await gameCard.click();
      await page.waitForTimeout(500);
    }

    const mapSvg = page.locator('svg').first();
    if (await mapSvg.isVisible()) {
      await mapSvg.click({ button: 'right' });
      await page.waitForTimeout(200);
      await screenshot(page, { name: 'right-click-map', subdir: 'exploratory' });
    }

    expect(errors.jsExceptions).toHaveLength(0);
  });

  test('select text on game info should not break UI', async ({ page }) => {
    const errors = attachErrorCollectors(page);
    await page.goto('/');
    await page.waitForTimeout(500);

    const gameCard = page.locator('[class*="cursor-pointer"]').first();
    if (await gameCard.isVisible()) {
      await gameCard.click();
      await page.waitForTimeout(500);
    }

    // Try to select text by triple-clicking on headings
    const heading = page.locator('h1').first();
    if (await heading.isVisible().catch(() => false)) {
      await heading.click({ clickCount: 3 }); // Triple click to select
      await page.waitForTimeout(200);
      await screenshot(page, { name: 'text-selection', subdir: 'exploratory' });
    }

    expect(errors.jsExceptions).toHaveLength(0);
  });
});
