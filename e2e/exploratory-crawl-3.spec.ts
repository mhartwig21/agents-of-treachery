import { test, expect, Page } from '@playwright/test';
import { screenshot } from './test-utils';

/**
 * Exploratory UI Crawl — Round 3
 *
 * Focuses on untested areas from rounds 1 & 2:
 * - Modal dialogs (press message, relationship history)
 * - Press timeline filters (power, intent, search, clear)
 * - Turn resolution player & keyboard shortcuts
 * - Commentary panel settings
 * - ARIA accessibility audit
 * - CSS animation/keyframe injection
 * - Empty & loading states
 * - Map deep zoom/pan interactions
 * - Power badge & color rendering
 * - Injected style tags
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
// Press Message Modal
// ============================================================================

test.describe('Exploratory: Press Message Modal', () => {
  test('click press channel message to open modal', async ({ page }) => {
    const errors = attachErrorCollectors(page);
    await goToGame(page);

    // Find the Press Channels panel and expand it
    const pressPanel = page.getByRole('button', { name: /Press Channels/i });
    if (await pressPanel.isVisible().catch(() => false)) {
      // Panel might need expanding
      await pressPanel.click();
      await page.waitForTimeout(300);
    }

    // Look for clickable message items in the press panel
    const messageItems = page.locator('button:has-text("ITA:"), button:has-text("ENG:"), button:has-text("FRA:"), button:has-text("GER:"), button:has-text("AUS:"), button:has-text("RUS:"), button:has-text("TUR:")');
    const count = await messageItems.count();
    console.log(`Press messages found: ${count}`);

    if (count > 0) {
      await messageItems.first().click();
      await page.waitForTimeout(500);

      // Check if modal opened (role="dialog")
      const modal = page.locator('[role="dialog"]');
      const modalVisible = await modal.isVisible().catch(() => false);
      console.log(`Press message modal opened: ${modalVisible}`);

      if (modalVisible) {
        // Check modal has aria-modal
        const ariaModal = await modal.getAttribute('aria-modal');
        console.log(`aria-modal attribute: ${ariaModal}`);

        // Check for close button
        const closeBtn = page.locator('[aria-label="Close modal"], [aria-label="Close"]');
        const closeBtnVisible = await closeBtn.isVisible().catch(() => false);
        console.log(`Close button visible: ${closeBtnVisible}`);

        // Check for content sections
        const sentimentBar = page.locator('.bg-green-500, .bg-red-500, .bg-yellow-500').first();
        const hasSentiment = await sentimentBar.isVisible().catch(() => false);
        console.log(`Sentiment indicator present: ${hasSentiment}`);

        await screenshot(page, { name: 'press-modal-open', subdir: 'exploratory-3' });

        // Test Escape key to close
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
        const modalAfterEsc = await modal.isVisible().catch(() => false);
        console.log(`Modal after Escape: ${modalAfterEsc}`);
        if (modalAfterEsc) {
          console.log('BUG: Escape key does not close press message modal');
        }
      } else {
        console.log('FINDING: Press message click does not open a modal dialog');
      }
    }

    expect(errors.jsExceptions).toHaveLength(0);
  });

  test('modal backdrop click closes it', async ({ page }) => {
    const errors = attachErrorCollectors(page);
    await goToGame(page);

    // Try to open a press message modal
    const pressPanel = page.getByRole('button', { name: /Press Channels/i });
    if (await pressPanel.isVisible().catch(() => false)) {
      await pressPanel.click();
      await page.waitForTimeout(300);
    }

    const messageItems = page.locator('button:has-text("ITA:"), button:has-text("ENG:"), button:has-text("FRA:")');
    if (await messageItems.first().isVisible().catch(() => false)) {
      await messageItems.first().click();
      await page.waitForTimeout(500);

      const modal = page.locator('[role="dialog"]');
      if (await modal.isVisible().catch(() => false)) {
        // Click the backdrop (the outer overlay)
        const backdrop = page.locator('.fixed.inset-0.z-50');
        if (await backdrop.isVisible().catch(() => false)) {
          // Click at the edge of the viewport (outside the modal content)
          await page.mouse.click(10, 10);
          await page.waitForTimeout(300);

          const modalAfterBackdropClick = await modal.isVisible().catch(() => false);
          console.log(`Modal after backdrop click: ${modalAfterBackdropClick}`);
          if (modalAfterBackdropClick) {
            console.log('BUG: Backdrop click does not close modal');
          }
        }
      }
    }

    expect(errors.jsExceptions).toHaveLength(0);
  });
});

// ============================================================================
// Relationship Graph → Relationship History Modal
// ============================================================================

test.describe('Exploratory: Relationship History Modal', () => {
  test('click relationship edge to open history modal', async ({ page }) => {
    const errors = attachErrorCollectors(page);
    await goToGame(page);

    // Find the Relationships panel
    const relPanel = page.getByRole('button', { name: /Relationships/i });
    if (await relPanel.isVisible().catch(() => false)) {
      await relPanel.scrollIntoViewIfNeeded();
      await page.waitForTimeout(200);
    }

    // Look for SVG relationship edges (lines with cursor-pointer)
    const edges = page.locator('svg line[cursor="pointer"], svg g[cursor="pointer"] line, svg [class*="cursor-pointer"] line');
    const edgeCount = await edges.count();
    console.log(`Relationship edges found: ${edgeCount}`);

    // Also try invisible hit areas (wider lines for easier clicking)
    const hitAreas = page.locator('svg line[stroke-width="12"], svg line[stroke-width="15"]');
    const hitAreaCount = await hitAreas.count();
    console.log(`Edge hit areas found: ${hitAreaCount}`);

    if (hitAreaCount > 0) {
      await hitAreas.first().click({ force: true });
      await page.waitForTimeout(500);

      // Check for relationship history modal
      const modal = page.locator('[role="dialog"], .fixed.inset-0.z-50');
      const modalVisible = await modal.isVisible().catch(() => false);
      console.log(`Relationship history modal opened: ${modalVisible}`);

      if (modalVisible) {
        // Check for modal content
        const scoreHistory = page.locator('text=Score History');
        const hasScoreHistory = await scoreHistory.isVisible().catch(() => false);
        console.log(`Score History section: ${hasScoreHistory}`);

        // Check for sparkline chart
        const sparkline = page.locator('svg polyline, svg path[d*="L"]').first();
        const hasSparkline = await sparkline.isVisible().catch(() => false);
        console.log(`Sparkline chart present: ${hasSparkline}`);

        // Check for legend
        const allied = page.locator('text=Allied');
        const hostile = page.locator('text=Hostile');
        const hasLegend = (await allied.isVisible().catch(() => false)) ||
                          (await hostile.isVisible().catch(() => false));
        console.log(`Legend present: ${hasLegend}`);

        await screenshot(page, { name: 'relationship-modal-open', subdir: 'exploratory-3' });

        // Close the modal
        const closeBtn = page.locator('[aria-label="Close"]');
        if (await closeBtn.isVisible().catch(() => false)) {
          await closeBtn.click();
          await page.waitForTimeout(300);
        }
      } else {
        console.log('FINDING: Edge click does not open relationship history modal');
      }
    }

    expect(errors.jsExceptions).toHaveLength(0);
  });
});

// ============================================================================
// Press Timeline Filters
// ============================================================================

test.describe('Exploratory: Press Filters', () => {
  test('press panel has power filter buttons', async ({ page }) => {
    const errors = attachErrorCollectors(page);
    await goToGame(page);

    // Expand press channels panel
    const pressPanel = page.getByRole('button', { name: /Press Channels/i });
    if (await pressPanel.isVisible().catch(() => false)) {
      await pressPanel.scrollIntoViewIfNeeded();
      await pressPanel.click();
      await page.waitForTimeout(300);
    }

    // Look for power filter buttons (All Powers, England, France, etc.)
    const powers = ['All Powers', 'England', 'France', 'Germany', 'Italy', 'Austria', 'Russia', 'Turkey'];
    const foundPowers: string[] = [];

    for (const power of powers) {
      const btn = page.getByRole('button', { name: power, exact: false });
      if (await btn.isVisible().catch(() => false)) {
        foundPowers.push(power);
      }
    }

    console.log(`Power filters found: ${foundPowers.join(', ')}`);

    // Click each power filter and check for visual feedback
    for (const power of foundPowers.slice(1, 4)) { // Test first 3 powers
      const btn = page.getByRole('button', { name: power, exact: false });
      await btn.click();
      await page.waitForTimeout(200);

      const classes = await btn.getAttribute('class') || '';
      const isHighlighted = classes.includes('ring') || classes.includes('blue') || classes.includes('active');
      console.log(`${power} filter active styling: ${isHighlighted}`);
    }

    await screenshot(page, { name: 'press-power-filters', subdir: 'exploratory-3' });
    expect(errors.jsExceptions).toHaveLength(0);
  });

  test('press panel has channel type filter tabs', async ({ page }) => {
    const errors = attachErrorCollectors(page);
    await goToGame(page);

    // Expand press channels panel
    const pressPanel = page.getByRole('button', { name: /Press Channels/i });
    if (await pressPanel.isVisible().catch(() => false)) {
      await pressPanel.scrollIntoViewIfNeeded();
      await pressPanel.click();
      await page.waitForTimeout(300);
    }

    // Look for channel type tabs
    const tabs = ['All', 'Bilateral', 'Multiparty', 'Global'];
    const foundTabs: string[] = [];

    for (const tab of tabs) {
      const btn = page.getByRole('button', { name: tab, exact: true });
      if (await btn.isVisible().catch(() => false)) {
        foundTabs.push(tab);
        await btn.click();
        await page.waitForTimeout(200);
      }
    }

    console.log(`Channel type tabs found: ${foundTabs.join(', ')}`);

    if (foundTabs.length < 4) {
      console.log('FINDING: Not all channel type tabs are visible');
    }

    await screenshot(page, { name: 'press-channel-tabs', subdir: 'exploratory-3' });
    expect(errors.jsExceptions).toHaveLength(0);
  });

  test('press search input filters messages', async ({ page }) => {
    const errors = attachErrorCollectors(page);
    await goToGame(page);

    // Expand press panel
    const pressPanel = page.getByRole('button', { name: /Press Channels/i });
    if (await pressPanel.isVisible().catch(() => false)) {
      await pressPanel.scrollIntoViewIfNeeded();
      await pressPanel.click();
      await page.waitForTimeout(300);
    }

    // Find search input
    const searchInput = page.getByPlaceholder(/search/i);
    const searchVisible = await searchInput.isVisible().catch(() => false);
    console.log(`Press search input visible: ${searchVisible}`);

    if (searchVisible) {
      // Type a search query
      await searchInput.fill('defensive');
      await page.waitForTimeout(300);
      await screenshot(page, { name: 'press-search-result', subdir: 'exploratory-3' });

      // Clear search
      await searchInput.fill('');
      await page.waitForTimeout(200);

      // Search for something that doesn't exist
      await searchInput.fill('zzzznonexistent');
      await page.waitForTimeout(300);

      // Check for "no messages" empty state
      const noMessages = page.locator('text=No messages');
      const hasEmpty = await noMessages.isVisible().catch(() => false);
      console.log(`Empty state for no-match search: ${hasEmpty}`);

      if (!hasEmpty) {
        console.log('FINDING: No empty state message when search has no results');
      }
    }

    expect(errors.jsExceptions).toHaveLength(0);
  });
});

// ============================================================================
// Turn Resolution Player
// ============================================================================

test.describe('Exploratory: Turn Resolution Player', () => {
  test('resolution player controls are present', async ({ page }) => {
    const errors = attachErrorCollectors(page);
    await goToGame(page);

    // Look for resolution player elements
    const resolutionLabel = page.locator('text=Resolution');
    const hasResolution = await resolutionLabel.isVisible().catch(() => false);
    console.log(`Resolution player visible: ${hasResolution}`);

    // Look for play/pause button with title
    const playBtn = page.locator('button[title="Play"], button[title="Play Resolution"]');
    const pauseBtn = page.locator('button[title="Pause"]');
    const resetBtn = page.locator('button[title="Reset"]');
    const skipBtn = page.locator('button[title="Skip to End"]');

    const hasPlay = await playBtn.isVisible().catch(() => false);
    const hasPause = await pauseBtn.isVisible().catch(() => false);
    const hasReset = await resetBtn.isVisible().catch(() => false);
    const hasSkip = await skipBtn.isVisible().catch(() => false);

    console.log(`Resolution controls: play=${hasPlay}, pause=${hasPause}, reset=${hasReset}, skip=${hasSkip}`);

    // Look for speed selector (Slow/Normal/Fast)
    const slowBtn = page.locator('button:text-is("Slow")');
    const normalBtn = page.locator('button:text-is("Normal")');
    const fastBtn = page.locator('button:text-is("Fast")');

    const hasSlow = await slowBtn.isVisible().catch(() => false);
    const hasNormal = await normalBtn.isVisible().catch(() => false);
    const hasFast = await fastBtn.isVisible().catch(() => false);

    console.log(`Speed controls: slow=${hasSlow}, normal=${hasNormal}, fast=${hasFast}`);

    // Look for segmented progress bar (6 segments)
    const progressSegments = page.locator('[title="Showing Orders"], [title="Highlighting Conflicts"], [title="Resolving Battles"], [title="Moving Units"], [title="Failed Orders"], [title="Dislodged Units"]');
    const segmentCount = await progressSegments.count();
    console.log(`Progress bar segments: ${segmentCount}/6`);

    await screenshot(page, { name: 'resolution-player', subdir: 'exploratory-3' });
    expect(errors.jsExceptions).toHaveLength(0);
  });

  test('keyboard shortcuts Space and ArrowRight work', async ({ page }) => {
    const errors = attachErrorCollectors(page);
    await goToGame(page);

    // Click on the map area first to ensure focus is in the right place
    // (Space can trigger scroll or button activation if focus is on a button)
    const mapArea = page.locator('svg.w-full.h-full, svg[viewBox]').first();
    if (await mapArea.isVisible().catch(() => false)) {
      await mapArea.click({ position: { x: 100, y: 100 } });
      await page.waitForTimeout(200);
    }

    // Check if the TurnResolutionPlayer responds to keyboard
    // Note: It has event listeners for Space (play/pause) and ArrowRight (skip)
    const playBtn = page.locator('button[title="Play"], button[title="Play Resolution"]');
    const hasPlayBtn = await playBtn.isVisible().catch(() => false);
    console.log(`Play button visible before keyboard: ${hasPlayBtn}`);

    // Use dispatchEvent to avoid Space scrolling the page
    await page.evaluate(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true }));
    });
    await page.waitForTimeout(500);

    const playBtnAfter = page.locator('button[title="Pause"]');
    const hasPauseNow = await playBtnAfter.isVisible().catch(() => false);
    console.log(`Pause button visible after Space: ${hasPauseNow}`);

    // ArrowRight to skip
    await page.evaluate(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowRight', key: 'ArrowRight', bubbles: true }));
    });
    await page.waitForTimeout(500);

    await screenshot(page, { name: 'resolution-after-keyboard', subdir: 'exploratory-3' });
    expect(errors.jsExceptions).toHaveLength(0);
  });
});

// ============================================================================
// ARIA & Accessibility Deep Audit
// ============================================================================

test.describe('Exploratory: ARIA Accessibility', () => {
  test('all buttons have accessible names', async ({ page }) => {
    const errors = attachErrorCollectors(page);
    await goToGame(page);

    // Find all buttons and check for accessible names
    const buttons = page.locator('button');
    const count = await buttons.count();
    const unlabeledButtons: string[] = [];

    for (let i = 0; i < count; i++) {
      const btn = buttons.nth(i);
      const isVisible = await btn.isVisible().catch(() => false);
      if (!isVisible) continue;

      const text = await btn.textContent().catch(() => '');
      const ariaLabel = await btn.getAttribute('aria-label').catch(() => null);
      const title = await btn.getAttribute('title').catch(() => null);

      if (!text?.trim() && !ariaLabel && !title) {
        const tag = await btn.evaluate(el => el.outerHTML.substring(0, 100));
        unlabeledButtons.push(tag);
      }
    }

    console.log(`Total visible buttons: ${count}`);
    console.log(`Buttons without accessible names: ${unlabeledButtons.length}`);
    if (unlabeledButtons.length > 0) {
      console.log('BUG: Buttons missing accessible names:');
      unlabeledButtons.slice(0, 5).forEach(b => console.log(`  ${b}`));
    }

    expect(errors.jsExceptions).toHaveLength(0);
  });

  test('interactive SVG elements have ARIA roles', async ({ page }) => {
    const errors = attachErrorCollectors(page);
    await goToGame(page);

    // Check SVG elements with cursor:pointer for ARIA attributes
    const clickableSvgElements = await page.evaluate(() => {
      const elements = document.querySelectorAll('svg [style*="cursor: pointer"], svg [cursor="pointer"], svg .cursor-pointer');
      const results: { tag: string; hasRole: boolean; hasLabel: boolean }[] = [];

      elements.forEach(el => {
        results.push({
          tag: el.tagName,
          hasRole: !!el.getAttribute('role'),
          hasLabel: !!(el.getAttribute('aria-label') || el.getAttribute('title')),
        });
      });

      return results;
    });

    const withoutRole = clickableSvgElements.filter(e => !e.hasRole);
    const withoutLabel = clickableSvgElements.filter(e => !e.hasLabel);

    console.log(`Clickable SVG elements: ${clickableSvgElements.length}`);
    console.log(`Without ARIA role: ${withoutRole.length}`);
    console.log(`Without label/title: ${withoutLabel.length}`);

    if (withoutRole.length > 0) {
      console.log('FINDING: Interactive SVG elements lack ARIA roles');
    }

    expect(errors.jsExceptions).toHaveLength(0);
  });

  test('focus order follows visual layout', async ({ page }) => {
    const errors = attachErrorCollectors(page);
    await goToGame(page);

    // Tab through elements and capture focus order
    const focusOrder: { tag: string; text: string; rect: { x: number; y: number } }[] = [];

    for (let i = 0; i < 25; i++) {
      await page.keyboard.press('Tab');
      await page.waitForTimeout(50);

      const focused = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return null;
        const rect = el.getBoundingClientRect();
        return {
          tag: el.tagName,
          text: (el.textContent || '').trim().substring(0, 30),
          rect: { x: Math.round(rect.x), y: Math.round(rect.y) },
        };
      });

      if (focused) {
        focusOrder.push(focused);
      }
    }

    console.log(`Focus order (${focusOrder.length} elements):`);
    focusOrder.forEach((el, i) =>
      console.log(`  ${i + 1}. ${el.tag} "${el.text}" at (${el.rect.x}, ${el.rect.y})`)
    );

    // Check for focus going backwards (y decreasing significantly)
    let backwardJumps = 0;
    for (let i = 1; i < focusOrder.length; i++) {
      if (focusOrder[i].rect.y < focusOrder[i - 1].rect.y - 50) {
        backwardJumps++;
      }
    }

    if (backwardJumps > 2) {
      console.log(`FINDING: Focus order jumps backward ${backwardJumps} times`);
    }

    expect(errors.jsExceptions).toHaveLength(0);
  });

  test('heading hierarchy is correct (h1 > h2 > h3)', async ({ page }) => {
    const errors = attachErrorCollectors(page);
    await goToGame(page);

    const headings = await page.evaluate(() => {
      const result: { level: number; text: string }[] = [];
      document.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach(el => {
        result.push({
          level: parseInt(el.tagName.charAt(1)),
          text: (el.textContent || '').trim().substring(0, 50),
        });
      });
      return result;
    });

    console.log(`Heading hierarchy (${headings.length} headings):`);
    headings.forEach(h => console.log(`  h${h.level}: "${h.text}"`));

    // Check for skipped levels (e.g., h1 -> h3 without h2)
    let skipped = 0;
    for (let i = 1; i < headings.length; i++) {
      if (headings[i].level > headings[i - 1].level + 1) {
        skipped++;
        console.log(`FINDING: Heading skip from h${headings[i - 1].level} to h${headings[i].level}`);
      }
    }

    if (skipped > 0) {
      console.log(`BUG: ${skipped} heading level skip(s) found`);
    }

    expect(errors.jsExceptions).toHaveLength(0);
  });
});

// ============================================================================
// CSS Animations & Injected Styles
// ============================================================================

test.describe('Exploratory: CSS Animations Audit', () => {
  test('injected style tags are present for animations', async ({ page }) => {
    const errors = attachErrorCollectors(page);
    await goToGame(page);

    // Check for dynamically injected style tags
    const styleIds = await page.evaluate(() => {
      const styles = document.querySelectorAll('style[id]');
      return Array.from(styles).map(s => ({
        id: s.id,
        contentLength: s.textContent?.length || 0,
      }));
    });

    console.log(`Injected style tags: ${styleIds.length}`);
    styleIds.forEach(s => console.log(`  #${s.id}: ${s.contentLength} chars`));

    // Check for specific expected animation style tags
    const expected = ['betrayal-highlight-styles', 'game-event-overlay-styles'];
    for (const id of expected) {
      const found = styleIds.some(s => s.id === id);
      console.log(`Expected style #${id}: ${found ? 'present' : 'MISSING'}`);
    }

    expect(errors.jsExceptions).toHaveLength(0);
  });

  test('all CSS animations have reasonable durations', async ({ page }) => {
    const errors = attachErrorCollectors(page);
    await goToGame(page);

    // Find all elements with animations and check durations
    const animations = await page.evaluate(() => {
      const results: { selector: string; name: string; duration: string; iteration: string }[] = [];
      const allElements = document.querySelectorAll('*');

      allElements.forEach(el => {
        const style = window.getComputedStyle(el);
        const animName = style.animationName;
        const animDuration = style.animationDuration;
        const animIteration = style.animationIterationCount;

        if (animName && animName !== 'none') {
          const classes = el.className?.toString().substring(0, 50) || el.tagName;
          results.push({
            selector: classes,
            name: animName,
            duration: animDuration,
            iteration: animIteration,
          });
        }
      });

      return results;
    });

    console.log(`Active CSS animations: ${animations.length}`);
    animations.forEach(a =>
      console.log(`  ${a.selector}: ${a.name} (${a.duration}, ${a.iteration} iterations)`)
    );

    // Flag animations with infinite iteration and fast duration (potential CPU waste)
    const cpuHeavy = animations.filter(
      a => a.iteration === 'infinite' && parseFloat(a.duration) < 0.5
    );

    if (cpuHeavy.length > 0) {
      console.log(`FINDING: ${cpuHeavy.length} potentially CPU-heavy animations (infinite + <0.5s)`);
    }

    expect(errors.jsExceptions).toHaveLength(0);
  });
});

// ============================================================================
// Map Deep Zoom & Pan
// ============================================================================

test.describe('Exploratory: Map Deep Interactions', () => {
  test('scroll wheel zooms the map', async ({ page }) => {
    const errors = attachErrorCollectors(page);
    await goToGame(page);

    const map = page.locator('svg.w-full.h-full, svg[viewBox]').first();
    const mapVisible = await map.isVisible().catch(() => false);

    if (mapVisible) {
      const box = await map.boundingBox();
      if (box) {
        const centerX = box.x + box.width / 2;
        const centerY = box.y + box.height / 2;

        // Get initial viewBox
        const initialViewBox = await map.getAttribute('viewBox');
        console.log(`Initial viewBox: ${initialViewBox}`);

        // Scroll to zoom in
        await page.mouse.move(centerX, centerY);
        await page.mouse.wheel(0, -300); // scroll up = zoom in
        await page.waitForTimeout(300);

        const afterZoomIn = await map.getAttribute('viewBox');
        console.log(`After zoom in: ${afterZoomIn}`);

        // Scroll to zoom out
        await page.mouse.wheel(0, 600); // scroll down = zoom out
        await page.waitForTimeout(300);

        const afterZoomOut = await map.getAttribute('viewBox');
        console.log(`After zoom out: ${afterZoomOut}`);

        const viewBoxChanged = initialViewBox !== afterZoomIn || initialViewBox !== afterZoomOut;
        console.log(`ViewBox changed with scroll: ${viewBoxChanged}`);

        if (!viewBoxChanged) {
          console.log('FINDING: Scroll wheel does not zoom the map (viewBox unchanged)');
        }

        await screenshot(page, { name: 'map-after-zoom', subdir: 'exploratory-3' });
      }
    }

    expect(errors.jsExceptions).toHaveLength(0);
  });

  test('drag to pan the map', async ({ page }) => {
    const errors = attachErrorCollectors(page);
    await goToGame(page);

    const map = page.locator('svg.w-full.h-full, svg[viewBox]').first();
    const mapVisible = await map.isVisible().catch(() => false);

    if (mapVisible) {
      const box = await map.boundingBox();
      if (box) {
        const startX = box.x + box.width / 2;
        const startY = box.y + box.height / 2;

        // Get initial viewBox
        const initialViewBox = await map.getAttribute('viewBox');

        // First zoom in so there's room to pan
        await page.mouse.move(startX, startY);
        await page.mouse.wheel(0, -500);
        await page.waitForTimeout(200);

        const afterZoom = await map.getAttribute('viewBox');

        // Now drag to pan
        await page.mouse.move(startX, startY);
        await page.mouse.down();
        await page.mouse.move(startX - 100, startY - 80, { steps: 10 });
        await page.mouse.up();
        await page.waitForTimeout(200);

        const afterPan = await map.getAttribute('viewBox');
        console.log(`ViewBox: initial=${initialViewBox}, afterZoom=${afterZoom}, afterPan=${afterPan}`);

        const panWorked = afterZoom !== afterPan;
        console.log(`Pan changed viewBox: ${panWorked}`);

        // Test reset button (⟲)
        const resetBtn = page.locator('button:text-is("⟲")');
        if (await resetBtn.isVisible().catch(() => false)) {
          await resetBtn.click();
          await page.waitForTimeout(300);

          const afterReset = await map.getAttribute('viewBox');
          console.log(`ViewBox after reset: ${afterReset}`);
          console.log(`Reset restored original: ${afterReset === initialViewBox}`);
        }
      }
    }

    expect(errors.jsExceptions).toHaveLength(0);
  });

  test('zoom buttons (+ − ⟲) work correctly', async ({ page }) => {
    const errors = attachErrorCollectors(page);
    await goToGame(page);

    const map = page.locator('svg.w-full.h-full, svg[viewBox]').first();
    if (await map.isVisible().catch(() => false)) {
      const initialViewBox = await map.getAttribute('viewBox');

      // Click + button
      const zoomIn = page.locator('button:text-is("+")');
      if (await zoomIn.isVisible().catch(() => false)) {
        await zoomIn.click();
        await zoomIn.click();
        await zoomIn.click();
        await page.waitForTimeout(300);

        const afterPlus = await map.getAttribute('viewBox');
        console.log(`ViewBox after 3x zoom in: ${afterPlus}`);
        console.log(`Zoom in worked: ${afterPlus !== initialViewBox}`);

        // Click − button
        const zoomOut = page.locator('button:text-is("−")');
        if (await zoomOut.isVisible().catch(() => false)) {
          await zoomOut.click();
          await zoomOut.click();
          await zoomOut.click();
          await page.waitForTimeout(300);

          const afterMinus = await map.getAttribute('viewBox');
          console.log(`ViewBox after 3x zoom out: ${afterMinus}`);
        }

        // Click ⟲ reset
        const reset = page.locator('button:text-is("⟲")');
        if (await reset.isVisible().catch(() => false)) {
          await reset.click();
          await page.waitForTimeout(300);

          const afterReset = await map.getAttribute('viewBox');
          console.log(`Reset to: ${afterReset}`);
          console.log(`Matches initial: ${afterReset === initialViewBox}`);
        }
      }
    }

    expect(errors.jsExceptions).toHaveLength(0);
  });
});

// ============================================================================
// Power Badge & Color Rendering
// ============================================================================

test.describe('Exploratory: Power Colors', () => {
  test('all 7 powers have distinct colors in power stats', async ({ page }) => {
    const errors = attachErrorCollectors(page);
    await goToGame(page);

    const powerColors = await page.evaluate(() => {
      const results: { power: string; color: string }[] = [];
      // Look for power color indicators in stats panel
      const powerButtons = document.querySelectorAll('button[class*="cursor-pointer"]');

      powerButtons.forEach(btn => {
        const text = btn.textContent || '';
        const powers = ['England', 'France', 'Germany', 'Italy', 'Austria', 'Russia', 'Turkey'];
        for (const power of powers) {
          if (text.includes(power)) {
            // Find the color dot/badge inside the button
            const colorEl = btn.querySelector('[style*="background"]') as HTMLElement;
            if (colorEl) {
              results.push({
                power,
                color: colorEl.style.backgroundColor,
              });
            }
          }
        }
      });

      return results;
    });

    console.log(`Power colors found: ${powerColors.length}`);
    powerColors.forEach(p => console.log(`  ${p.power}: ${p.color}`));

    // Check for duplicates
    const uniqueColors = new Set(powerColors.map(p => p.color));
    if (uniqueColors.size < powerColors.length && powerColors.length > 0) {
      console.log('BUG: Some powers share the same color');
    }

    expect(errors.jsExceptions).toHaveLength(0);
  });

  test('relationship graph uses distinct colors for each power', async ({ page }) => {
    const errors = attachErrorCollectors(page);
    await goToGame(page);

    // Scroll to relationship graph
    const relPanel = page.getByRole('button', { name: /Relationships/i });
    if (await relPanel.isVisible().catch(() => false)) {
      await relPanel.scrollIntoViewIfNeeded();
    }

    // Find SVG circle nodes in the relationship graph
    const nodeColors = await page.evaluate(() => {
      const circles = document.querySelectorAll('svg circle[fill]:not([fill="none"]):not([fill="transparent"])');
      const results: { fill: string; text: string }[] = [];

      circles.forEach(circle => {
        const fill = circle.getAttribute('fill') || '';
        // Skip tiny circles (dots) and filter/effect circles
        const r = parseFloat(circle.getAttribute('r') || '0');
        if (r >= 15 && fill !== '#1f2937' && fill !== '#374151') {
          // Find nearby text
          const parent = circle.closest('g');
          const text = parent?.querySelector('text')?.textContent || '';
          results.push({ fill, text });
        }
      });

      return results;
    });

    console.log(`Relationship graph nodes: ${nodeColors.length}`);
    nodeColors.forEach(n => console.log(`  ${n.text}: ${n.fill}`));

    expect(errors.jsExceptions).toHaveLength(0);
  });
});

// ============================================================================
// Empty States & Loading States
// ============================================================================

test.describe('Exploratory: Empty & Loading States', () => {
  test('live activity shows waiting message', async ({ page }) => {
    const errors = attachErrorCollectors(page);
    await goToGame(page);

    // Check Live Activity panel content
    const livePanel = page.getByRole('button', { name: /Live Activity/i });
    if (await livePanel.isVisible().catch(() => false)) {
      // Panel should already be expanded by default
      const waitingMsg = page.locator('text=Waiting for agent activity');
      const hasWaiting = await waitingMsg.isVisible().catch(() => false);
      console.log(`Live activity waiting state: ${hasWaiting}`);
    }

    expect(errors.jsExceptions).toHaveLength(0);
  });

  test('commentary panel shows empty state', async ({ page }) => {
    const errors = attachErrorCollectors(page);
    await goToGame(page);

    // Look for AI Commentary panel
    const commentaryHeader = page.locator('text=AI Commentary');
    const hasCommentary = await commentaryHeader.isVisible().catch(() => false);
    console.log(`Commentary panel visible: ${hasCommentary}`);

    if (hasCommentary) {
      // Check for empty state message
      const emptyMsg = page.locator('text=Commentary will appear');
      const hasEmpty = await emptyMsg.isVisible().catch(() => false);
      console.log(`Commentary empty state: ${hasEmpty}`);

      // Check for settings button
      const settingsBtn = page.locator('button[title="Settings"]');
      const hasSettings = await settingsBtn.isVisible().catch(() => false);
      console.log(`Settings button present: ${hasSettings}`);

      if (hasSettings) {
        // Click settings to open configuration
        await settingsBtn.click();
        await page.waitForTimeout(300);

        // Check for style dropdown
        const styleSelect = page.locator('select').first();
        const hasStyleSelect = await styleSelect.isVisible().catch(() => false);
        console.log(`Style selector visible: ${hasStyleSelect}`);

        if (hasStyleSelect) {
          // Check for options
          const options = await styleSelect.locator('option').allTextContents();
          console.log(`Commentary style options: ${options.join(', ')}`);
        }

        await screenshot(page, { name: 'commentary-settings', subdir: 'exploratory-3' });
      }
    }

    expect(errors.jsExceptions).toHaveLength(0);
  });

  test('victory condition text is displayed', async ({ page }) => {
    const errors = attachErrorCollectors(page);
    await goToGame(page);

    const victoryText = page.locator('text=Victory: 18 supply centers');
    const hasVictory = await victoryText.isVisible().catch(() => false);
    console.log(`Victory condition displayed: ${hasVictory}`);

    if (!hasVictory) {
      console.log('FINDING: Victory condition (18 SC) not visible in power stats panel');
    }

    expect(errors.jsExceptions).toHaveLength(0);
  });
});

// ============================================================================
// Scrubber Timeline Interactions
// ============================================================================

test.describe('Exploratory: Scrubber Deep Dive', () => {
  test('speed buttons change visual state', async ({ page }) => {
    const errors = attachErrorCollectors(page);
    await goToGame(page);

    // Find speed buttons
    const speeds = ['0.5x', '1x', '2x', '4x'];
    const foundSpeeds: string[] = [];

    for (const speed of speeds) {
      const btn = page.locator(`button:text-is("${speed}")`);
      if (await btn.isVisible().catch(() => false)) {
        foundSpeeds.push(speed);

        // Click and check for active state
        await btn.click();
        await page.waitForTimeout(100);

        const classes = await btn.getAttribute('class') || '';
        const isActive = classes.includes('bg-blue') || classes.includes('bg-indigo') || classes.includes('font-bold');
        console.log(`Speed ${speed}: active=${isActive}, classes="${classes.substring(0, 80)}"`);
      }
    }

    console.log(`Speed buttons found: ${foundSpeeds.join(', ')}`);
    await screenshot(page, { name: 'scrubber-speed-buttons', subdir: 'exploratory-3' });
    expect(errors.jsExceptions).toHaveLength(0);
  });

  test('timeline slider click-to-seek', async ({ page }) => {
    const errors = attachErrorCollectors(page);
    await goToGame(page);

    // Look for timeline/slider element
    const timeline = page.locator('[class*="slider"], [class*="timeline"], input[type="range"]');
    const count = await timeline.count();
    console.log(`Timeline/slider elements: ${count}`);

    // Look for the LIVE indicator
    const liveIndicator = page.locator('text=LIVE');
    const hasLive = await liveIndicator.isVisible().catch(() => false);
    console.log(`LIVE indicator: ${hasLive}`);

    // Look for year display in scrubber
    const yearDisplay = page.locator('text=1901');
    const hasYear = await yearDisplay.isVisible().catch(() => false);
    console.log(`Year display: ${hasYear}`);

    expect(errors.jsExceptions).toHaveLength(0);
  });
});

// ============================================================================
// Cross-Component Interactions
// ============================================================================

test.describe('Exploratory: Cross-Component', () => {
  test('clicking power in stats panel highlights map territories', async ({ page }) => {
    const errors = attachErrorCollectors(page);
    await goToGame(page);

    // Find a power button in stats
    const englandBtn = page.getByRole('button', { name: /England.*SC/i });
    if (await englandBtn.isVisible().catch(() => false)) {
      // Click England
      await englandBtn.click();
      await page.waitForTimeout(300);

      // Check if map territories got highlighted
      const highlightedPaths = await page.evaluate(() => {
        const paths = document.querySelectorAll('svg path[fill], svg path[style*="fill"]');
        let highlighted = 0;
        paths.forEach(p => {
          const opacity = window.getComputedStyle(p).opacity;
          if (opacity !== '1' && opacity !== '') {
            highlighted++;
          }
        });
        return highlighted;
      });

      console.log(`Map paths with opacity change after power click: ${highlightedPaths}`);

      // Click again to deselect
      await englandBtn.click();
      await page.waitForTimeout(200);

      await screenshot(page, { name: 'power-highlight-map', subdir: 'exploratory-3' });
    }

    expect(errors.jsExceptions).toHaveLength(0);
  });

  test('collapsing all panels reclaims sidebar space', async ({ page }) => {
    const errors = attachErrorCollectors(page);
    await goToGame(page);

    // Get initial sidebar height
    const sidebar = page.locator('[class*="overflow-y-auto"]').last();
    const initialScroll = await sidebar.evaluate(el => el.scrollHeight).catch(() => 0);
    console.log(`Initial sidebar scroll height: ${initialScroll}`);

    // Collapse all collapsible panels by clicking their headers
    const panelHeaders = page.locator('button:has(h3)');
    const headerCount = await panelHeaders.count();
    console.log(`Collapsible panel headers: ${headerCount}`);

    for (let i = 0; i < headerCount; i++) {
      const header = panelHeaders.nth(i);
      if (await header.isVisible().catch(() => false)) {
        await header.click();
        await page.waitForTimeout(100);
      }
    }

    await page.waitForTimeout(300);
    const collapsedScroll = await sidebar.evaluate(el => el.scrollHeight).catch(() => 0);
    console.log(`Collapsed sidebar scroll height: ${collapsedScroll}`);

    const reduction = initialScroll > 0 ? Math.round((1 - collapsedScroll / initialScroll) * 100) : 0;
    console.log(`Sidebar height reduction: ${reduction}%`);

    await screenshot(page, { name: 'all-panels-collapsed', subdir: 'exploratory-3' });
    expect(errors.jsExceptions).toHaveLength(0);
  });
});
