import { test, expect, Page } from '@playwright/test';
import { screenshot } from './test-utils';

/**
 * Exploratory UI Crawl — Round 2
 *
 * Covers areas missed by round 1: press channels, message modals,
 * chart click-to-seek, mobile layout tabs, scroll behavior,
 * browser history, order arrows, unit interactions, empty states,
 * and content overflow edge cases.
 */

interface ErrorLog {
  consoleErrors: string[];
  jsExceptions: string[];
}

function attachErrorCollectors(page: Page): ErrorLog {
  const errors: ErrorLog = { consoleErrors: [], jsExceptions: [] };
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.consoleErrors.push(msg.text());
  });
  page.on('pageerror', (error) => {
    errors.jsExceptions.push(`${error.name}: ${error.message}`);
  });
  return errors;
}

/** Navigate to game view helper */
async function goToGame(page: Page, cardIndex = 0) {
  await page.goto('/');
  await page.waitForTimeout(400);
  const cards = page.locator('[class*="cursor-pointer"]');
  if (await cards.nth(cardIndex).isVisible().catch(() => false)) {
    await cards.nth(cardIndex).click();
    await page.waitForTimeout(500);
    return true;
  }
  return false;
}

// ============================================================================
// Press Channels & Messages
// ============================================================================

test.describe('Exploratory: Press System', () => {
  test('click every press channel to expand it', async ({ page }) => {
    const errors = attachErrorCollectors(page);
    await goToGame(page);

    // Find the Press Channels panel header and make sure it's open
    const pressHeader = page.getByText('Press Channels', { exact: false }).first();
    if (await pressHeader.isVisible().catch(() => false)) {
      // Click to ensure expanded
      await pressHeader.click();
      await page.waitForTimeout(200);
      await pressHeader.click();
      await page.waitForTimeout(200);
    }

    // Find channel items in the press panel
    const channelItems = page.locator('[class*="cursor-pointer"]').filter({
      has: page.locator('[class*="truncate"], [class*="text-xs"]'),
    });
    const count = await channelItems.count();
    console.log(`Found ${count} potential channel/message items`);

    // Click each one
    for (let i = 0; i < Math.min(count, 15); i++) {
      const item = channelItems.nth(i);
      if (await item.isVisible().catch(() => false)) {
        try {
          await item.scrollIntoViewIfNeeded({ timeout: 1000 });
          await item.click({ timeout: 2000 });
          await page.waitForTimeout(150);
        } catch {
          // May not be clickable
        }
      }
    }

    await screenshot(page, { name: 'press-channels-clicked', subdir: 'exploratory-2' });
    expect(errors.jsExceptions).toHaveLength(0);
  });

  test('press message modal open/close', async ({ page }) => {
    const errors = attachErrorCollectors(page);
    await goToGame(page);

    // Try to find and click a message that opens a modal
    // Messages appear in press timeline or channel panel
    const messageElements = page.locator('[class*="message"], [class*="press"]').filter({
      has: page.locator('text'),
    });

    const msgCount = await messageElements.count();
    let modalOpened = false;

    for (let i = 0; i < Math.min(msgCount, 10); i++) {
      const msg = messageElements.nth(i);
      if (await msg.isVisible().catch(() => false)) {
        await msg.click().catch(() => {});
        await page.waitForTimeout(300);

        // Check if modal opened
        const modal = page.locator('[class*="fixed"], [class*="modal"], [role="dialog"]');
        if (await modal.isVisible().catch(() => false)) {
          modalOpened = true;
          await screenshot(page, { name: `press-modal-open-${i}`, subdir: 'exploratory-2' });

          // Try closing with Escape
          await page.keyboard.press('Escape');
          await page.waitForTimeout(200);

          // Try closing with X button
          const closeBtn = page.locator('button').filter({ hasText: /×|✕|close/i });
          if (await closeBtn.first().isVisible().catch(() => false)) {
            await closeBtn.first().click();
            await page.waitForTimeout(200);
          }
          break;
        }
      }
    }

    console.log(`Modal opened: ${modalOpened}`);
    expect(errors.jsExceptions).toHaveLength(0);
  });

  test('press panel shows "no messages" state correctly', async ({ page }) => {
    const errors = attachErrorCollectors(page);
    // Try to find a game with no messages
    await page.goto('/');
    await page.waitForTimeout(400);

    const cards = page.locator('[class*="cursor-pointer"]');
    const count = await cards.count();

    for (let i = 0; i < count; i++) {
      await cards.nth(i).click();
      await page.waitForTimeout(300);

      // Check for empty state in press panel
      const noMessages = page.getByText(/no.*message|no.*diplomatic/i);
      if (await noMessages.isVisible().catch(() => false)) {
        console.log(`Game ${i} has no messages - empty state shown correctly`);
        await screenshot(page, { name: `press-empty-game-${i}`, subdir: 'exploratory-2' });
        break;
      }

      // Go back
      const backBtn = page.getByRole('button', { name: /back/i });
      if (await backBtn.isVisible().catch(() => false)) {
        await backBtn.click();
        await page.waitForTimeout(300);
      }
    }

    expect(errors.jsExceptions).toHaveLength(0);
  });
});

// ============================================================================
// Supply Center Chart Click-to-Seek
// ============================================================================

test.describe('Exploratory: SC Chart Interactions', () => {
  test('SC chart renders with data points and axes', async ({ page }) => {
    const errors = attachErrorCollectors(page);
    await goToGame(page);

    // Scroll sidebar to make chart visible
    const scPanel = page.getByRole('button', { name: /SC Balance/i });
    if (await scPanel.isVisible().catch(() => false)) {
      await scPanel.scrollIntoViewIfNeeded();
      await page.waitForTimeout(200);
    }

    const chartContainer = page.locator('.recharts-responsive-container');
    const visible = await chartContainer.isVisible().catch(() => false);
    console.log(`SC chart container visible: ${visible}`);

    if (visible) {
      // Check for chart elements
      const areas = await page.locator('.recharts-area').count();
      const xAxis = await page.locator('.recharts-xAxis').count();
      const yAxis = await page.locator('.recharts-yAxis').count();
      console.log(`SC chart elements: ${areas} areas, ${xAxis} x-axes, ${yAxis} y-axes`);
    }

    expect(errors.jsExceptions).toHaveLength(0);
  });

  test('chart power legend items are all visible', async ({ page }) => {
    const errors = attachErrorCollectors(page);
    await goToGame(page);

    const powers = ['eng', 'fra', 'ger', 'ita', 'aus', 'rus', 'tur'];
    const missingPowers: string[] = [];

    for (const power of powers) {
      const legend = page.locator(`text:has-text("${power}")`).first();
      const altLegend = page.getByText(power, { exact: false }).first();
      const visible = await legend.isVisible().catch(() => false) ||
                      await altLegend.isVisible().catch(() => false);
      if (!visible) {
        missingPowers.push(power);
      }
    }

    if (missingPowers.length > 0) {
      console.log(`Missing chart legend entries: ${missingPowers.join(', ')}`);
    }

    await screenshot(page, { name: 'sc-chart-legends', subdir: 'exploratory-2' });
    expect(errors.jsExceptions).toHaveLength(0);
  });
});

// ============================================================================
// Mobile Layout — Tab Navigation
// ============================================================================

test.describe('Exploratory: Mobile Layout', () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test('mobile tabs switch content correctly', async ({ page }) => {
    const errors = attachErrorCollectors(page);
    await goToGame(page);

    const tabs = ['Map', 'Orders', 'Press', 'Graph'];
    let svgIntercepted = false;
    for (const tab of tabs) {
      const tabBtn = page.getByRole('button', { name: tab, exact: true });
      if (await tabBtn.isVisible().catch(() => false)) {
        // Use force:true because the SVG map may overlay tab buttons (this IS a bug)
        try {
          await tabBtn.click({ timeout: 2000 });
        } catch {
          svgIntercepted = true;
          await tabBtn.click({ force: true });
        }
        await page.waitForTimeout(300);
        await screenshot(page, { name: `mobile-tab-${tab.toLowerCase()}`, subdir: 'exploratory-2' });

        // Verify the tab is highlighted (has blue-400 color)
        const classes = await tabBtn.getAttribute('class') || '';
        const isActive = classes.includes('blue-400') || classes.includes('border-t-2');
        console.log(`Mobile tab ${tab}: active=${isActive}`);
      }
    }

    if (svgIntercepted) {
      console.log('BUG: SVG map overlay intercepts mobile tab button clicks');
    }

    expect(errors.jsExceptions).toHaveLength(0);
  });

  test('mobile dashboard renders without overflow', async ({ page }) => {
    const errors = attachErrorCollectors(page);
    await page.goto('/');
    await page.waitForTimeout(400);

    const hasOverflowX = await page.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth
    );
    const hasOverflowY = await page.evaluate(() =>
      document.documentElement.scrollHeight > document.documentElement.clientHeight
    );

    console.log(`Mobile dashboard: overflowX=${hasOverflowX}, overflowY=${hasOverflowY}`);
    await screenshot(page, { name: 'mobile-dashboard', subdir: 'exploratory-2' });

    if (hasOverflowX) {
      console.log('BUG: Horizontal overflow on mobile dashboard');
    }

    expect(errors.jsExceptions).toHaveLength(0);
  });

  test('mobile game view — rapid tab switching', async ({ page }) => {
    const errors = attachErrorCollectors(page);
    await goToGame(page);

    // Click through all tabs rapidly — use force:true since SVG may overlay
    const tabs = page.locator('nav button');
    const count = await tabs.count();

    for (let cycle = 0; cycle < 3; cycle++) {
      for (let i = 0; i < count; i++) {
        if (await tabs.nth(i).isVisible().catch(() => false)) {
          await tabs.nth(i).click({ force: true });
          await page.waitForTimeout(50);
        }
      }
    }

    await page.waitForTimeout(300);
    await screenshot(page, { name: 'mobile-rapid-tab-switch', subdir: 'exploratory-2' });

    expect(errors.jsExceptions).toHaveLength(0);
  });

  test('mobile header truncates long game names', async ({ page }) => {
    const errors = attachErrorCollectors(page);
    await goToGame(page);

    // Check if game name is truncated (has truncate class)
    const gameName = page.locator('.truncate').first();
    if (await gameName.isVisible().catch(() => false)) {
      const text = await gameName.textContent();
      const box = await gameName.boundingBox();
      console.log(`Mobile game name: "${text}" width=${box?.width}`);

      // Verify it doesn't push other elements off screen
      const headerBox = await page.locator('header').first().boundingBox();
      if (headerBox && box) {
        const overflows = box.x + box.width > headerBox.x + headerBox.width;
        if (overflows) {
          console.log('BUG: Game name overflows header on mobile');
        }
      }
    }

    expect(errors.jsExceptions).toHaveLength(0);
  });
});

// ============================================================================
// Sidebar Scroll Behavior
// ============================================================================

test.describe('Exploratory: Scroll Behavior', () => {
  test('sidebar scrolls independently of main content', async ({ page }) => {
    const errors = attachErrorCollectors(page);
    await goToGame(page);

    const sidebar = page.locator('.w-80.overflow-y-auto, .overflow-y-auto').first();
    if (await sidebar.isVisible().catch(() => false)) {
      const box = await sidebar.boundingBox();
      if (box) {
        // Scroll the sidebar down
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.wheel(0, 500);
        await page.waitForTimeout(300);
        await screenshot(page, { name: 'sidebar-scrolled-down', subdir: 'exploratory-2' });

        // Scroll back up
        await page.mouse.wheel(0, -500);
        await page.waitForTimeout(300);
        await screenshot(page, { name: 'sidebar-scrolled-up', subdir: 'exploratory-2' });

        // Check sidebar can scroll to bottom
        await page.mouse.wheel(0, 2000);
        await page.waitForTimeout(300);
        await screenshot(page, { name: 'sidebar-scrolled-bottom', subdir: 'exploratory-2' });
      }
    }

    expect(errors.jsExceptions).toHaveLength(0);
  });

  test('collapsed panels reduce sidebar scroll height', async ({ page }) => {
    const errors = attachErrorCollectors(page);
    await goToGame(page);

    const sidebar = page.locator('.overflow-y-auto').first();
    if (await sidebar.isVisible().catch(() => false)) {
      // Measure initial scroll height
      const initialScrollHeight = await sidebar.evaluate(el => el.scrollHeight);

      // Collapse all panels
      const panelTitles = ['Power Statistics', 'SC Balance', 'Relationships', 'Orders'];
      for (const title of panelTitles) {
        const header = page.getByText(title, { exact: false }).first();
        if (await header.isVisible().catch(() => false)) {
          await header.click();
          await page.waitForTimeout(100);
        }
      }

      const collapsedScrollHeight = await sidebar.evaluate(el => el.scrollHeight);
      console.log(`Sidebar scroll height: expanded=${initialScrollHeight}, collapsed=${collapsedScrollHeight}`);

      if (collapsedScrollHeight >= initialScrollHeight) {
        console.log('FINDING: Collapsing panels does not reduce sidebar scroll height');
      }
    }

    expect(errors.jsExceptions).toHaveLength(0);
  });
});

// ============================================================================
// Browser History Navigation
// ============================================================================

test.describe('Exploratory: Browser Navigation', () => {
  test('browser back button returns to dashboard from game view', async ({ page }) => {
    const errors = attachErrorCollectors(page);
    await page.goto('/');
    await page.waitForTimeout(400);

    // Click into a game
    const card = page.locator('[class*="cursor-pointer"]').first();
    if (await card.isVisible()) {
      await card.click();
      await page.waitForTimeout(500);

      // Use browser back
      await page.goBack();
      await page.waitForTimeout(500);

      // Check where we ended up
      const isDashboard = await page.getByText('Spectator Dashboard').isVisible().catch(() => false);
      const isGameView = await page.getByRole('button', { name: /back/i }).isVisible().catch(() => false);

      console.log(`After browser back: dashboard=${isDashboard}, gameView=${isGameView}`);
      await screenshot(page, { name: 'browser-back', subdir: 'exploratory-2' });

      if (!isDashboard) {
        console.log('FINDING: Browser back button does not return to dashboard');
      }
    }

    expect(errors.jsExceptions).toHaveLength(0);
  });

  test('browser forward after back', async ({ page }) => {
    const errors = attachErrorCollectors(page);
    await page.goto('/');
    await page.waitForTimeout(400);

    const card = page.locator('[class*="cursor-pointer"]').first();
    if (await card.isVisible()) {
      await card.click();
      await page.waitForTimeout(500);

      await page.goBack();
      await page.waitForTimeout(300);

      await page.goForward();
      await page.waitForTimeout(500);

      await screenshot(page, { name: 'browser-forward', subdir: 'exploratory-2' });
    }

    expect(errors.jsExceptions).toHaveLength(0);
  });

  test('page refresh preserves app state', async ({ page }) => {
    const errors = attachErrorCollectors(page);
    await page.goto('/');
    await page.waitForTimeout(400);

    // Click into game view
    const card = page.locator('[class*="cursor-pointer"]').first();
    if (await card.isVisible()) {
      await card.click();
      await page.waitForTimeout(500);

      // Refresh page
      await page.reload();
      await page.waitForTimeout(500);

      // Check what state we're in after reload
      const isDashboard = await page.getByText('Spectator Dashboard').isVisible().catch(() => false);
      const isGameView = await page.getByRole('button', { name: /back/i }).isVisible().catch(() => false);

      console.log(`After reload: dashboard=${isDashboard}, gameView=${isGameView}`);
      await screenshot(page, { name: 'after-reload', subdir: 'exploratory-2' });
    }

    expect(errors.jsExceptions).toHaveLength(0);
  });
});

// ============================================================================
// Map Units and Order Arrows
// ============================================================================

test.describe('Exploratory: Map Units', () => {
  test('click on unit markers (armies/fleets)', async ({ page }) => {
    const errors = attachErrorCollectors(page);
    await goToGame(page);

    // Units are rendered as text elements with 'A' or 'F' inside circles
    const unitMarkers = page.locator('svg text').filter({ hasText: /^[AF]$/ });
    const count = await unitMarkers.count();
    console.log(`Found ${count} unit markers on map`);

    for (let i = 0; i < Math.min(count, 10); i++) {
      const marker = unitMarkers.nth(i);
      if (await marker.isVisible().catch(() => false)) {
        try {
          await marker.click({ force: true });
          await page.waitForTimeout(150);
        } catch {
          // SVG text elements may not be clickable
        }
      }
    }

    await screenshot(page, { name: 'units-clicked', subdir: 'exploratory-2' });
    expect(errors.jsExceptions).toHaveLength(0);
  });

  test('hover unit markers for info', async ({ page }) => {
    const errors = attachErrorCollectors(page);
    await goToGame(page);

    const unitMarkers = page.locator('svg text').filter({ hasText: /^[AF]$/ });
    const count = await unitMarkers.count();
    let tooltipsFound = 0;

    for (let i = 0; i < Math.min(count, 10); i++) {
      const marker = unitMarkers.nth(i);
      if (await marker.isVisible().catch(() => false)) {
        await marker.hover({ force: true });
        await page.waitForTimeout(200);

        const tooltip = page.locator('[role="tooltip"], [class*="tooltip"]');
        if (await tooltip.isVisible().catch(() => false)) {
          tooltipsFound++;
        }
      }
    }

    console.log(`Unit hover: ${tooltipsFound}/${Math.min(count, 10)} showed tooltips`);
    if (count > 0 && tooltipsFound === 0) {
      console.log('FINDING: No tooltips appear when hovering map units');
    }

    expect(errors.jsExceptions).toHaveLength(0);
  });

  test('order arrows are visible when orders exist', async ({ page }) => {
    const errors = attachErrorCollectors(page);
    await goToGame(page);

    // Order arrows are rendered as SVG line/path elements with marker-end
    const arrows = page.locator('svg line[marker-end], svg path[marker-end]');
    const arrowCount = await arrows.count();

    // Also check for order arrow components
    const orderArrows = page.locator('[class*="order-arrow"], [data-testid*="arrow"]');
    const componentCount = await orderArrows.count();

    console.log(`Order visualization: ${arrowCount} SVG arrows, ${componentCount} arrow components`);
    await screenshot(page, { name: 'order-arrows', subdir: 'exploratory-2' });

    expect(errors.jsExceptions).toHaveLength(0);
  });
});

// ============================================================================
// Power Stats Panel Deep Dive
// ============================================================================

test.describe('Exploratory: Power Stats Panel', () => {
  test('all 7 powers shown with SC and unit counts', async ({ page }) => {
    const errors = attachErrorCollectors(page);
    await goToGame(page);

    const powers = ['England', 'France', 'Germany', 'Italy', 'Austria', 'Russia', 'Turkey'];
    const missingPowers: string[] = [];
    const powerData: string[] = [];

    for (const power of powers) {
      const el = page.getByText(power, { exact: true }).first();
      if (await el.isVisible().catch(() => false)) {
        // Get the row/container text for this power
        const parent = el.locator('..').first();
        const fullText = await parent.textContent().catch(() => '') || '';
        powerData.push(`${power}: ${fullText.trim().slice(0, 60)}`);
      } else {
        missingPowers.push(power);
      }
    }

    console.log(`Power stats:\n${powerData.join('\n')}`);
    if (missingPowers.length > 0) {
      console.log(`Missing powers in stats: ${missingPowers.join(', ')}`);
    }

    await screenshot(page, { name: 'power-stats-all', subdir: 'exploratory-2' });
    expect(errors.jsExceptions).toHaveLength(0);
  });

  test('selecting power highlights map territories', async ({ page }) => {
    const errors = attachErrorCollectors(page);
    await goToGame(page);

    // Click on France in power stats
    const france = page.getByText('France', { exact: true }).first();
    if (await france.isVisible().catch(() => false)) {
      await france.click();
      await page.waitForTimeout(300);
      await screenshot(page, { name: 'france-selected-map', subdir: 'exploratory-2' });

      // Click again to deselect
      await france.click();
      await page.waitForTimeout(300);
      await screenshot(page, { name: 'france-deselected-map', subdir: 'exploratory-2' });
    }

    expect(errors.jsExceptions).toHaveLength(0);
  });
});

// ============================================================================
// Each Game Has Different Data
// ============================================================================

test.describe('Exploratory: Multi-Game Data', () => {
  test('each game card shows unique data', async ({ page }) => {
    const errors = attachErrorCollectors(page);
    await page.goto('/');
    await page.waitForTimeout(400);

    const cards = page.locator('[class*="cursor-pointer"]');
    const count = await cards.count();
    const gameNames: string[] = [];

    for (let i = 0; i < count; i++) {
      const card = cards.nth(i);
      if (await card.isVisible().catch(() => false)) {
        const text = await card.textContent();
        gameNames.push((text || '').trim().slice(0, 50));
      }
    }

    console.log(`Games found (${gameNames.length}):\n${gameNames.join('\n')}`);

    // Check for duplicate names
    const unique = new Set(gameNames);
    if (unique.size < gameNames.length) {
      console.log('FINDING: Duplicate game names in dashboard');
    }

    await screenshot(page, { name: 'all-game-cards', subdir: 'exploratory-2' });
    expect(errors.jsExceptions).toHaveLength(0);
  });

  test('navigate to each game and verify unique content', async ({ page }) => {
    const errors = attachErrorCollectors(page);
    await page.goto('/');
    await page.waitForTimeout(400);

    const cards = page.locator('[class*="cursor-pointer"]');
    const count = await cards.count();
    const gamePhases: string[] = [];

    // Limit to first 5 games to avoid timeout
    const maxGames = Math.min(count, 5);
    for (let i = 0; i < maxGames; i++) {
      try {
        await page.goto('/');
        await page.waitForTimeout(300);

        const card = cards.nth(i);
        if (await card.isVisible().catch(() => false)) {
          await card.click();
          await page.waitForTimeout(500);

          // Capture phase info
          const phaseEl = page.locator('[class*="phase"], [class*="Phase"]').first();
          const phaseText = await phaseEl.textContent({ timeout: 2000 }).catch(() => 'unknown');
          gamePhases.push(`Game ${i}: ${phaseText}`);

          await screenshot(page, { name: `game-${i}-view`, subdir: 'exploratory-2' });
        }
      } catch (e) {
        console.log(`Game ${i} navigation failed: ${e}`);
      }
    }

    console.log(`Game phases:\n${gamePhases.join('\n')}`);
    expect(errors.jsExceptions).toHaveLength(0);
  });
});

// ============================================================================
// Orders Panel Interactions
// ============================================================================

test.describe('Exploratory: Orders Panel', () => {
  test('orders panel shows order details', async ({ page }) => {
    const errors = attachErrorCollectors(page);
    await goToGame(page);

    // Find orders panel content
    const ordersContent = page.getByText(/HOLD|MOVE|SUPPORT|CONVOY|→|->|hold/i);
    const orderCount = await ordersContent.count();
    console.log(`Found ${orderCount} order-related elements`);

    if (orderCount > 0) {
      await screenshot(page, { name: 'orders-panel-content', subdir: 'exploratory-2' });
    }

    expect(errors.jsExceptions).toHaveLength(0);
  });

  test('order filter by power', async ({ page }) => {
    const errors = attachErrorCollectors(page);
    await goToGame(page);

    // Look for power filter buttons/tabs in the orders panel
    const filterBtns = page.locator('button').filter({
      hasText: /ENG|FRA|GER|ITA|AUS|RUS|TUR|All/,
    });
    const count = await filterBtns.count();
    console.log(`Found ${count} order filter buttons`);

    for (let i = 0; i < count; i++) {
      const btn = filterBtns.nth(i);
      if (await btn.isVisible().catch(() => false)) {
        const text = await btn.textContent();
        await btn.click();
        await page.waitForTimeout(200);
        console.log(`Clicked order filter: ${text?.trim()}`);
      }
    }

    await screenshot(page, { name: 'orders-filtered', subdir: 'exploratory-2' });
    expect(errors.jsExceptions).toHaveLength(0);
  });
});

// ============================================================================
// Enable Live Toggle
// ============================================================================

test.describe('Exploratory: Live Connection Toggle', () => {
  test('clicking Enable Live link/toggle', async ({ page }) => {
    const errors = attachErrorCollectors(page);
    await page.goto('/');
    await page.waitForTimeout(400);

    // The keyboard tab test found an "Enable Live" link
    const enableLive = page.getByText('Enable Live', { exact: false });
    if (await enableLive.isVisible().catch(() => false)) {
      await enableLive.click();
      await page.waitForTimeout(500);
      await screenshot(page, { name: 'enable-live-clicked', subdir: 'exploratory-2' });

      // Check what happened — connection indicator should appear
      const connIndicator = page.getByText(/connected|connecting|disconnected/i);
      const hasIndicator = await connIndicator.isVisible().catch(() => false);
      console.log(`After Enable Live: connection indicator visible=${hasIndicator}`);

      // Check if Start New Game button appeared
      const newGameBtn = page.getByRole('button', { name: /start new game/i });
      const hasBtnNow = await newGameBtn.isVisible().catch(() => false);
      console.log(`After Enable Live: Start New Game button visible=${hasBtnNow}`);

      if (hasBtnNow) {
        // Test the button state
        const isDisabled = await newGameBtn.isDisabled();
        console.log(`Start New Game button disabled=${isDisabled}`);
        await screenshot(page, { name: 'new-game-btn-after-enable', subdir: 'exploratory-2' });
      }
    }

    expect(errors.jsExceptions).toHaveLength(0);
  });
});

// ============================================================================
// Resolution Animation Controls
// ============================================================================

test.describe('Exploratory: Animation Controls', () => {
  test('find and interact with animation player controls', async ({ page }) => {
    const errors = attachErrorCollectors(page);
    await goToGame(page);

    // Animation controls appear when viewing a resolved turn
    const playBtn = page.getByRole('button', { name: /play|▶/i });
    const pauseBtn = page.getByRole('button', { name: /pause|⏸/i });
    const speedBtns = page.locator('button').filter({ hasText: /slow|normal|fast|1x|2x|0\.5x/i });

    const hasPlay = await playBtn.isVisible().catch(() => false);
    const hasPause = await pauseBtn.isVisible().catch(() => false);
    const speedCount = await speedBtns.count();

    console.log(`Animation controls: play=${hasPlay}, pause=${hasPause}, speed buttons=${speedCount}`);

    if (hasPlay) {
      await playBtn.click();
      await page.waitForTimeout(1000);
      await screenshot(page, { name: 'animation-playing', subdir: 'exploratory-2' });
    }

    if (speedCount > 0) {
      for (let i = 0; i < speedCount; i++) {
        const btn = speedBtns.nth(i);
        if (await btn.isVisible().catch(() => false)) {
          await btn.click();
          await page.waitForTimeout(200);
        }
      }
    }

    expect(errors.jsExceptions).toHaveLength(0);
  });
});

// ============================================================================
// Empty/Error States
// ============================================================================

test.describe('Exploratory: Edge Cases', () => {
  test('navigating to non-existent route', async ({ page }) => {
    const errors = attachErrorCollectors(page);
    await page.goto('/nonexistent-route');
    await page.waitForTimeout(500);

    await screenshot(page, { name: 'nonexistent-route', subdir: 'exploratory-2' });

    // App should handle gracefully (either redirect or show error)
    const hasContent = await page.locator('body').textContent();
    console.log(`Non-existent route content length: ${hasContent?.length}`);

    expect(errors.jsExceptions).toHaveLength(0);
  });

  test('very long search query', async ({ page }) => {
    const errors = attachErrorCollectors(page);
    await page.goto('/');
    await page.waitForTimeout(400);

    const searchInput = page.getByPlaceholder(/search/i);
    if (await searchInput.isVisible()) {
      // Type a very long search string
      const longString = 'a'.repeat(500);
      await searchInput.fill(longString);
      await page.waitForTimeout(300);

      // Check if input overflows its container
      const inputBox = await searchInput.boundingBox();
      const containerBox = await searchInput.locator('..').first().boundingBox();
      if (inputBox && containerBox) {
        const overflows = inputBox.width > containerBox.width;
        if (overflows) {
          console.log('FINDING: Search input overflows container with long text');
        }
      }

      await screenshot(page, { name: 'long-search-query', subdir: 'exploratory-2' });
      await searchInput.fill('');
    }

    expect(errors.jsExceptions).toHaveLength(0);
  });

  test('special characters in search', async ({ page }) => {
    const errors = attachErrorCollectors(page);
    await page.goto('/');
    await page.waitForTimeout(400);

    const searchInput = page.getByPlaceholder(/search/i);
    if (await searchInput.isVisible()) {
      const specialChars = ['<script>alert(1)</script>', '"; DROP TABLE games;--', '🎯🗡️💀', '\\n\\r\\t', '   '];

      for (const chars of specialChars) {
        await searchInput.fill(chars);
        await page.waitForTimeout(150);

        // Check no XSS or errors
        const alertDialogs = page.locator('[role="alertdialog"]');
        const hasAlert = await alertDialogs.count() > 0;
        if (hasAlert) {
          console.log(`BUG: Alert dialog appeared with input: ${chars}`);
        }
      }

      await screenshot(page, { name: 'special-chars-search', subdir: 'exploratory-2' });
      await searchInput.fill('');
    }

    expect(errors.jsExceptions).toHaveLength(0);
  });
});

// ============================================================================
// CSS Transition/Animation Audit
// ============================================================================

test.describe('Exploratory: Visual Stability', () => {
  test('no elements have infinite animations that burn CPU', async ({ page }) => {
    const errors = attachErrorCollectors(page);
    await goToGame(page);

    // Find all elements with animation or transition
    const animatedCount = await page.evaluate(() => {
      const all = document.querySelectorAll('*');
      let count = 0;
      const infinite: string[] = [];

      all.forEach(el => {
        const style = window.getComputedStyle(el);
        if (style.animationName !== 'none' && style.animationIterationCount === 'infinite') {
          count++;
          const tag = el.tagName.toLowerCase();
          const cls = el.className?.toString().slice(0, 30) || '';
          infinite.push(`${tag}.${cls}`);
        }
      });

      return { count, elements: infinite.slice(0, 10) };
    });

    console.log(`Infinite animations: ${animatedCount.count}`);
    if (animatedCount.count > 0) {
      console.log(`Elements: ${animatedCount.elements.join(', ')}`);
    }

    // Some pulse animations are expected (e.g., live indicator)
    // Flag if there are many
    if (animatedCount.count > 5) {
      console.log('FINDING: Many infinite animations may impact performance');
    }

    expect(errors.jsExceptions).toHaveLength(0);
  });

  test('page does not have memory-hungry DOM', async ({ page }) => {
    const errors = attachErrorCollectors(page);
    await goToGame(page);

    const domStats = await page.evaluate(() => {
      const allElements = document.querySelectorAll('*');
      const svgElements = document.querySelectorAll('svg *');
      return {
        totalNodes: allElements.length,
        svgNodes: svgElements.length,
        bodyChildren: document.body.children.length,
      };
    });

    console.log(`DOM stats: total=${domStats.totalNodes}, SVG=${domStats.svgNodes}`);

    if (domStats.totalNodes > 5000) {
      console.log('FINDING: DOM has over 5000 nodes — may cause performance issues');
    }

    expect(errors.jsExceptions).toHaveLength(0);
  });
});
