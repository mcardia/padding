// Entry point: per-window state machine that keeps a gap around maximized and
// snapped (quick-tiled) windows. Reacts to geometry/maximize/tile/fullscreen
// changes, guarded against the recursion its own geometry writes would cause.

interface WindowState {
    gapped: boolean;
    // Floating geometry captured before the window was gapped (for the maximize toggle).
    geo: RectF | null;
    // Key of the tile rect we last padded a snapped window for (null otherwise).
    tileKey: string | null;
}

function rectKey(rect: RectF): string {
    return Math.round(rect.x) + "," + Math.round(rect.y) + "," +
        Math.round(rect.width) + "x" + Math.round(rect.height);
}

const MIN_SIZE = 50;

const winState: { [id: string]: WindowState } = {};
const busy: { [id: string]: boolean } = {};

function winId(win: KWinWindow): string {
    return String(win.internalId);
}

function isCandidate(win: KWinWindow): boolean {
    return (
        !!win &&
        win.normalWindow &&
        !win.fullScreen &&
        !win.dock &&
        !win.desktopWindow &&
        !win.move &&
        !win.resize &&
        !isIgnored(win)
    );
}

// Cache the floating geometry so the maximize toggle can restore it. Skips when
// the window currently fills a slot (fresh or already padded), to avoid storing
// a maximized/tiled rect as if it were the floating size.
function saveGeo(win: KWinWindow): void {
    const id = winId(win);
    if (busy[id]) {
        return;
    }
    const state = winState[id];
    if (state && state.gapped) {
        return;
    }

    // Only capture the floating geometry when the window is genuinely floating
    // (not maximized and not assigned to a tile). A snapped window may not fill
    // its tile, so geometry matching is unreliable here — the slot check is enough.
    if (slotForWindow(win)) {
        return;
    }

    winState[id] = { gapped: false, geo: cloneRect(win.frameGeometry), tileKey: null };
}

// Mode 2 only: nudge a floating window away from a dock edge it intrudes into.
function compensateDockEdge(win: KWinWindow): void {
    if (CONFIG.dockMode !== DockMode.AllWindows) {
        return;
    }
    if (!isCandidate(win) || slotForWindow(win)) {
        return;
    }
    const id = winId(win);
    if (busy[id]) {
        return;
    }

    const usable = maximizeArea(win);
    const screen = screenArea(win);
    const geometry = win.frameGeometry;
    // Fullscreen-by-size race: fullScreen flag can lag behind the geometry change.
    if (near(geometry.width, screen.width) && near(geometry.height, screen.height)) {
        return;
    }

    const threshold = CONFIG.dockMargin + CONFIG.gapSize;
    let x = geometry.x;
    let y = geometry.y;
    let width = geometry.width;
    let height = geometry.height;
    let adjusted = false;

    if (usable.y > screen.y && geometry.y - usable.y < threshold) {
        y = usable.y + threshold;
        height = geometry.y + geometry.height - y;
        adjusted = true;
    }
    if (screen.y + screen.height > usable.y + usable.height &&
        usable.y + usable.height - (y + height) < threshold) {
        height = usable.y + usable.height - threshold - y;
        adjusted = true;
    }
    if (usable.x > screen.x && geometry.x - usable.x < threshold) {
        x = usable.x + threshold;
        width = geometry.x + geometry.width - x;
        adjusted = true;
    }
    if (screen.x + screen.width > usable.x + usable.width &&
        usable.x + usable.width - (x + width) < threshold) {
        width = usable.x + usable.width - threshold - x;
        adjusted = true;
    }

    if (!adjusted) {
        return;
    }
    if (width < MIN_SIZE) {
        width = MIN_SIZE;
    }
    if (height < MIN_SIZE) {
        height = MIN_SIZE;
    }

    busy[id] = true;
    win.frameGeometry = { x: x, y: y, width: width, height: height };
    busy[id] = false;
}

// Apply (or toggle off) the gap for a window that fills a slot.
function applyGap(win: KWinWindow): void {
    if (!isCandidate(win)) {
        return;
    }
    const id = winId(win);
    if (busy[id]) {
        return;
    }

    const slot = slotForWindow(win);
    if (!slot) {
        // Floating again: forget any snap-padding marker so a future snap re-pads.
        const prev = winState[id];
        if (prev && prev.tileKey) {
            winState[id] = { gapped: false, geo: prev.geo, tileKey: null };
        }
        return;
    }
    if (!slot.maximized && !CONFIG.padSnapped) {
        return;
    }

    const gaps = gapsForSlot(win, slot);
    if (gaps.top <= 0 && gaps.bottom <= 0 && gaps.left <= 0 && gaps.right <= 0) {
        return;
    }

    const padded = insetRect(slot.rect, gaps);
    const state = winState[id];

    if (slot.maximized) {
        // Maximized windows reliably fill the maximize area, so gate on an exact
        // match and support the second-maximize-restores toggle.
        if (!rectsNear(win.frameGeometry, slot.rect)) {
            return;
        }
        busy[id] = true;
        if (state && state.gapped) {
            win.setMaximize(false, false);
            if (state.geo) {
                win.frameGeometry = state.geo;
            }
            winState[id] = { gapped: false, geo: state.geo, tileKey: null };
            busy[id] = false;
            return;
        }
        win.setMaximize(false, false);
        win.frameGeometry = padded;
        winState[id] = { gapped: true, geo: state ? state.geo : null, tileKey: null };
        busy[id] = false;
        return;
    }

    // Snapped/tiled: pad based on the tile assignment, not an exact geometry match.
    // Some apps (e.g. Electron) do not fill their tile, so a strict match would
    // never trigger. The tileKey marker prevents re-padding the same tile.
    const tileKey = rectKey(slot.rect);
    if (state && state.tileKey === tileKey) {
        return;
    }
    if (rectsNear(win.frameGeometry, padded)) {
        winState[id] = { gapped: true, geo: state ? state.geo : null, tileKey: tileKey };
        return;
    }
    busy[id] = true;
    win.frameGeometry = padded;
    winState[id] = { gapped: true, geo: state ? state.geo : null, tileKey: tileKey };
    busy[id] = false;
}

function handleGeometryChange(win: KWinWindow): void {
    saveGeo(win);
    compensateDockEdge(win);
    applyGap(win);
}

function connectWindow(win: KWinWindow): void {
    handleGeometryChange(win);
    win.frameGeometryChanged.connect(function (): void {
        handleGeometryChange(win);
    });
    win.maximizedChanged.connect(function (): void {
        applyGap(win);
    });
    win.quickTileModeChanged.connect(function (): void {
        applyGap(win);
    });
    win.tileChanged.connect(function (): void {
        applyGap(win);
    });
    win.fullScreenChanged.connect(function (): void {
        applyGap(win);
    });
}

function applyAll(): void {
    workspace.windowList().forEach(function (win: KWinWindow): void {
        compensateDockEdge(win);
        applyGap(win);
    });
}

workspace.windowList().forEach(connectWindow);
workspace.windowAdded.connect(connectWindow);
workspace.screensChanged.connect(applyAll);
workspace.virtualScreenSizeChanged.connect(applyAll);
workspace.virtualScreenGeometryChanged.connect(applyAll);
