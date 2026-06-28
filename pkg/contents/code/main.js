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
        gapTop: Math.max(0, readInt("gapTop", 15)),
        gapBottom: Math.max(0, readInt("gapBottom", 15)),
        gapLeft: Math.max(0, readInt("gapLeft", 15)),
        gapRight: Math.max(0, readInt("gapRight", 15)),
        gapSnapped: Math.max(0, readInt("gapSnapped", 15)),
        dockMargin: Math.min(20, Math.max(10, readInt("dockMargin", 12))),
        dockMode: clampDockMode(readInt("compensateDockMode", legacyMode)),
        padSnapped: readBool("padSnapped", true),
        ignored: parseIgnored(readString("ignoredApps", "")),
    };
}
let CONFIG = loadConfig();
// Re-read the configuration (called when the user applies new settings).
function reloadConfig() {
    CONFIG = loadConfig();
}
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
// Tolerance (px) for deciding whether a tile edge sits on the work-area boundary.
const EDGE_TOLERANCE = 1;
// Determine the slot a window currently occupies, or null when it is floating
// (and therefore should not be padded).
//
// Quick-tile state is not exposed as a property in KWin 6.7 scripting, so snapped
// (and custom-tiled) windows are detected via their assigned `tile`, whose
// absoluteGeometry is the real tile rect. An edge that does not sit on the
// work-area boundary is interior (shared with a neighbour) and gets the snapped gap.
function slotForWindow(win) {
    if (win.maximizeMode === 3 /* MaximizeMode.Full */) {
        return { rect: maximizeArea(win), edges: OUTER_EDGES, maximized: true };
    }
    const tile = win.tile;
    if (!tile) {
        return null;
    }
    const rect = tile.absoluteGeometry;
    const area = maximizeArea(win);
    const edges = {
        leftInner: rect.x > area.x + EDGE_TOLERANCE,
        rightInner: rect.x + rect.width < area.x + area.width - EDGE_TOLERANCE,
        topInner: rect.y > area.y + EDGE_TOLERANCE,
        bottomInner: rect.y + rect.height < area.y + area.height - EDGE_TOLERANCE,
    };
    return { rect: cloneRect(rect), edges, maximized: false };
}
// Per-side gaps: each outer edge uses its directional gap; each inner (shared)
// edge of a snapped window uses half of the snapped-divider gap, so the total
// space between two adjacent snapped windows equals gapSnapped.
// Dock compensation adds dockMargin on outer edges that face a panel.
function gapsForSlot(win, slot) {
    const innerHalf = CONFIG.gapSnapped / 2;
    const edges = slot.edges;
    const gaps = {
        top: edges.topInner ? innerHalf : CONFIG.gapTop,
        bottom: edges.bottomInner ? innerHalf : CONFIG.gapBottom,
        left: edges.leftInner ? innerHalf : CONFIG.gapLeft,
        right: edges.rightInner ? innerHalf : CONFIG.gapRight,
    };
    const dockActive = CONFIG.dockMode === 2 /* DockMode.AllWindows */ ||
        (slot.maximized && CONFIG.dockMode === 1 /* DockMode.MaximizedOnly */);
    if (dockActive) {
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
function rectKey(rect) {
    return Math.round(rect.x) + "," + Math.round(rect.y) + "," +
        Math.round(rect.width) + "x" + Math.round(rect.height);
}
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
    // Only capture the floating geometry when the window is genuinely floating
    // (not maximized and not assigned to a tile). A snapped window may not fill
    // its tile, so geometry matching is unreliable here — the slot check is enough.
    if (slotForWindow(win)) {
        return;
    }
    winState[id] = { gapped: false, geo: cloneRect(win.frameGeometry), tileKey: null };
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
    const maxGap = Math.max(CONFIG.gapTop, CONFIG.gapBottom, CONFIG.gapLeft, CONFIG.gapRight);
    const threshold = CONFIG.dockMargin + maxGap;
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
    win.tileChanged.connect(function () {
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
// Signature of the gap-affecting config, to skip unrelated reconfigure events.
function configSignature() {
    return [
        CONFIG.gapTop, CONFIG.gapBottom, CONFIG.gapLeft, CONFIG.gapRight,
        CONFIG.gapSnapped, CONFIG.dockMode, CONFIG.dockMargin, CONFIG.padSnapped,
        CONFIG.ignored.join("|"),
    ].join(",");
}
let lastConfigSignature = configSignature();
// KWin does not reload a running script when its settings change; instead we
// re-read the config on reconfigure and re-pad every window so the new gaps
// take effect live (including windows that are already maximized/snapped).
function onConfigChanged() {
    reloadConfig();
    const signature = configSignature();
    if (signature === lastConfigSignature) {
        return;
    }
    lastConfigSignature = signature;
    workspace.windowList().forEach(function (win) {
        if (!isCandidate(win)) {
            return;
        }
        const id = winId(win);
        const state = winState[id];
        const slot = slotForWindow(win);
        if (slot) {
            // Snapped (or freshly maximized): clear the tile marker and re-apply.
            if (state) {
                winState[id] = { gapped: state.gapped, geo: state.geo, tileKey: null };
            }
            applyGap(win);
            return;
        }
        // Previously padded while maximized (now unmaximized): re-inset to new gaps.
        if (state && state.gapped && state.tileKey === null) {
            busy[id] = true;
            const area = maximizeArea(win);
            const gaps = gapsForSlot(win, { rect: area, edges: OUTER_EDGES, maximized: true });
            win.frameGeometry = insetRect(area, gaps);
            busy[id] = false;
        }
    });
}
workspace.windowList().forEach(connectWindow);
workspace.windowAdded.connect(connectWindow);
workspace.screensChanged.connect(applyAll);
workspace.virtualScreenSizeChanged.connect(applyAll);
workspace.virtualScreenGeometryChanged.connect(applyAll);
options.configChanged.connect(onConfigChanged);
