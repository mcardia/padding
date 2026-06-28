// Entry point: per-window state machine that keeps a gap around maximized and
// snapped (quick-tiled) windows. Reacts to geometry/maximize/tile/fullscreen
// changes, guarded against the recursion its own geometry writes would cause.

interface WindowState {
    gapped: boolean;
    // Floating geometry captured before the window was gapped (for the maximize toggle).
    geo: RectF | null;
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

    const slot = slotForWindow(win);
    const geometry = win.frameGeometry;
    if (slot) {
        if (rectsNear(geometry, slot.rect)) {
            return;
        }
        // Stale gapped geometry left by a previous script instance.
        if (rectsNear(geometry, insetRect(slot.rect, gapsForSlot(win, slot)))) {
            return;
        }
    }

    winState[id] = { gapped: false, geo: cloneRect(geometry) };
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
        return;
    }
    if (!slot.maximized && !CONFIG.padSnapped) {
        return;
    }

    const gaps = gapsForSlot(win, slot);
    if (gaps.top <= 0 && gaps.bottom <= 0 && gaps.left <= 0 && gaps.right <= 0) {
        return;
    }

    const geometry = win.frameGeometry;
    // Only act when the window is sitting at the fresh, un-gapped slot rect.
    // (When already padded, geometry != slot.rect and we leave it be.)
    if (!rectsNear(geometry, slot.rect)) {
        return;
    }

    busy[id] = true;
    const state = winState[id];

    // Maximize toggle: a second maximize from a gapped state restores the window.
    if (slot.maximized && state && state.gapped) {
        win.setMaximize(false, false);
        if (state.geo) {
            win.frameGeometry = state.geo;
        }
        winState[id] = { gapped: false, geo: state.geo };
        busy[id] = false;
        return;
    }

    if (slot.maximized) {
        // Exit the maximized state so KWin stops enforcing the full rect.
        win.setMaximize(false, false);
    }

    win.frameGeometry = insetRect(slot.rect, gaps);
    winState[id] = { gapped: true, geo: state ? state.geo : null };
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
