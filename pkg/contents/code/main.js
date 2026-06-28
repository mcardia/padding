"use strict";
// Configuration: read once from the script's kwinrc section via readConfig().
// Windows that must never be touched (compositor/system surfaces).
const DEFAULT_IGNORED = [
    "plasmashell",
    "krunner",
    "spectacle",
    "org.kde.spectacle",
    "polkit-kde-authentication-agent-1",
    "kscreen_osd_service",
    "ksplashqml",
    "ksmserver",
    "xdg-desktop-portal-kde",
];
function readInt(key, fallback) {
    const raw = readConfig(key, fallback);
    const value = typeof raw === "number" ? raw : parseInt(String(raw), 10);
    return isNaN(value) ? fallback : value;
}
function readBool(key, fallback) {
    const raw = readConfig(key, fallback);
    if (typeof raw === "boolean") {
        return raw;
    }
    const text = String(raw).toLowerCase();
    return text === "true" || text === "1";
}
function readString(key, fallback) {
    const raw = readConfig(key, fallback);
    return raw === null || raw === undefined ? fallback : String(raw);
}
function clampDockMode(value) {
    if (value <= 0) {
        return 0 /* DockMode.Off */;
    }
    return value === 1 ? 1 /* DockMode.MaximizedOnly */ : 2 /* DockMode.AllWindows */;
}
function parseIgnored(raw) {
    const extra = raw
        .split(",")
        .map(function (entry) {
        return entry.trim().toLowerCase();
    })
        .filter(function (entry) {
        return entry.length > 0;
    });
    return DEFAULT_IGNORED.concat(extra);
}
function loadConfig() {
    // Legacy: older versions used a boolean "compensateDock"; honour it as mode 1.
    const legacyMode = readBool("compensateDock", false) ? 1 : 0;
    return {
        gapSize: Math.max(0, readInt("gapSize", 15)),
        dockMargin: Math.min(20, Math.max(10, readInt("dockMargin", 12))),
        dockMode: clampDockMode(readInt("compensateDockMode", legacyMode)),
        padSnapped: readBool("padSnapped", true),
        ignored: parseIgnored(readString("ignoredApps", "")),
    };
}
const CONFIG = loadConfig();
function isIgnored(win) {
    const resourceClass = String(win.resourceClass).toLowerCase();
    const resourceName = String(win.resourceName).toLowerCase();
    return CONFIG.ignored.indexOf(resourceClass) >= 0 || CONFIG.ignored.indexOf(resourceName) >= 0;
}
// Tolerance for fractional scaling: frameGeometry/clientArea can return floats.
function near(a, b) {
    return Math.abs(a - b) < 2;
}
// Geometry: figure out a window's target "slot" (maximized area or tile rect) and
// the per-side gaps to inset it by.
const OUTER_EDGES = {
    topInner: false,
    bottomInner: false,
    leftInner: false,
    rightInner: false,
};
function maximizeArea(win) {
    return workspace.clientArea(KWin.MaximizeArea, win);
}
function screenArea(win) {
    return workspace.clientArea(KWin.ScreenArea, win);
}
// Determine the slot a window currently occupies, or null when it is floating
// (and therefore should not be padded). Custom tiles are intentionally skipped.
function slotForWindow(win) {
    if (win.maximizeMode === 3 /* MaximizeMode.Full */) {
        return { rect: maximizeArea(win), edges: OUTER_EDGES, maximized: true };
    }
    const mode = win.quickTileMode;
    if (mode === 0 /* QuickTileFlag.None */ || (mode & 16 /* QuickTileFlag.Custom */) !== 0) {
        return null;
    }
    const hasLeft = (mode & 1 /* QuickTileFlag.Left */) !== 0;
    const hasRight = (mode & 2 /* QuickTileFlag.Right */) !== 0;
    const hasTop = (mode & 4 /* QuickTileFlag.Top */) !== 0;
    const hasBottom = (mode & 8 /* QuickTileFlag.Bottom */) !== 0;
    if (!hasLeft && !hasRight && !hasTop && !hasBottom) {
        return null;
    }
    const area = maximizeArea(win);
    const halfWidth = area.width / 2;
    const halfHeight = area.height / 2;
    const rect = {
        x: hasRight ? area.x + halfWidth : area.x,
        y: hasBottom ? area.y + halfHeight : area.y,
        width: hasLeft || hasRight ? halfWidth : area.width,
        height: hasTop || hasBottom ? halfHeight : area.height,
    };
    // The edge opposite the tiled side is the split line shared with a neighbour.
    const edges = {
        leftInner: hasRight,
        rightInner: hasLeft,
        topInner: hasBottom,
        bottomInner: hasTop,
    };
    return { rect, edges, maximized: false };
}
// Per-side gaps: full gap on outer edges, half gap on inner (shared) edges.
// Dock compensation adds dockMargin on outer edges that face a panel.
function gapsForSlot(win, slot) {
    const gap = CONFIG.gapSize;
    const half = gap / 2;
    const edges = slot.edges;
    const gaps = {
        top: edges.topInner ? half : gap,
        bottom: edges.bottomInner ? half : gap,
        left: edges.leftInner ? half : gap,
        right: edges.rightInner ? half : gap,
    };
    const dockActive = CONFIG.dockMode === 2 /* DockMode.AllWindows */ ||
        (slot.maximized && CONFIG.dockMode === 1 /* DockMode.MaximizedOnly */);
    if (dockActive && gap > 0) {
        const margin = CONFIG.dockMargin;
        const screen = screenArea(win);
        const usable = maximizeArea(win);
        if (!edges.topInner && usable.y > screen.y) {
            gaps.top += margin;
        }
        if (!edges.bottomInner && usable.y + usable.height < screen.y + screen.height) {
            gaps.bottom += margin;
        }
        if (!edges.leftInner && usable.x > screen.x) {
            gaps.left += margin;
        }
        if (!edges.rightInner && usable.x + usable.width < screen.x + screen.width) {
            gaps.right += margin;
        }
    }
    return gaps;
}
function insetRect(rect, gaps) {
    return {
        x: rect.x + gaps.left,
        y: rect.y + gaps.top,
        width: rect.width - gaps.left - gaps.right,
        height: rect.height - gaps.top - gaps.bottom,
    };
}
function rectsNear(a, b) {
    return near(a.x, b.x) && near(a.y, b.y) && near(a.width, b.width) && near(a.height, b.height);
}
function cloneRect(rect) {
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}
// Entry point: per-window state machine that keeps a gap around maximized and
// snapped (quick-tiled) windows. Reacts to geometry/maximize/tile/fullscreen
// changes, guarded against the recursion its own geometry writes would cause.
const MIN_SIZE = 50;
const winState = {};
const busy = {};
function winId(win) {
    return String(win.internalId);
}
function isCandidate(win) {
    return (!!win &&
        win.normalWindow &&
        !win.fullScreen &&
        !win.dock &&
        !win.desktopWindow &&
        !win.move &&
        !win.resize &&
        !isIgnored(win));
}
// Cache the floating geometry so the maximize toggle can restore it. Skips when
// the window currently fills a slot (fresh or already padded), to avoid storing
// a maximized/tiled rect as if it were the floating size.
function saveGeo(win) {
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
function compensateDockEdge(win) {
    if (CONFIG.dockMode !== 2 /* DockMode.AllWindows */) {
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
function applyGap(win) {
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
function handleGeometryChange(win) {
    saveGeo(win);
    compensateDockEdge(win);
    applyGap(win);
}
function connectWindow(win) {
    handleGeometryChange(win);
    win.frameGeometryChanged.connect(function () {
        handleGeometryChange(win);
    });
    win.maximizedChanged.connect(function () {
        applyGap(win);
    });
    win.quickTileModeChanged.connect(function () {
        applyGap(win);
    });
    win.fullScreenChanged.connect(function () {
        applyGap(win);
    });
}
function applyAll() {
    workspace.windowList().forEach(function (win) {
        compensateDockEdge(win);
        applyGap(win);
    });
}
workspace.windowList().forEach(connectWindow);
workspace.windowAdded.connect(connectWindow);
workspace.screensChanged.connect(applyAll);
workspace.virtualScreenSizeChanged.connect(applyAll);
workspace.virtualScreenGeometryChanged.connect(applyAll);
