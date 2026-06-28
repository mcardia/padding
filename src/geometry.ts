// Geometry: figure out a window's target "slot" (maximized area or tile rect) and
// the per-side gaps to inset it by.

interface Gaps {
    top: number;
    bottom: number;
    left: number;
    right: number;
}

// Which edges of a slot are interior (shared with an adjacent tile) vs outer
// (touching the screen/work-area boundary). Inner edges get the snapped-divider gap.
interface SlotEdges {
    topInner: boolean;
    bottomInner: boolean;
    leftInner: boolean;
    rightInner: boolean;
}

interface Slot {
    rect: RectF;
    edges: SlotEdges;
    maximized: boolean;
}

const OUTER_EDGES: SlotEdges = {
    topInner: false,
    bottomInner: false,
    leftInner: false,
    rightInner: false,
};

function maximizeArea(win: KWinWindow): RectF {
    return workspace.clientArea(KWin.MaximizeArea, win);
}

function screenArea(win: KWinWindow): RectF {
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
function slotForWindow(win: KWinWindow): Slot | null {
    if (win.maximizeMode === MaximizeMode.Full) {
        return { rect: maximizeArea(win), edges: OUTER_EDGES, maximized: true };
    }

    const tile = win.tile;
    if (!tile) {
        return null;
    }

    const rect = tile.absoluteGeometry;
    const area = maximizeArea(win);
    const edges: SlotEdges = {
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
function gapsForSlot(win: KWinWindow, slot: Slot): Gaps {
    const innerHalf = CONFIG.gapSnapped / 2;
    const edges = slot.edges;

    const gaps: Gaps = {
        top: edges.topInner ? innerHalf : CONFIG.gapTop,
        bottom: edges.bottomInner ? innerHalf : CONFIG.gapBottom,
        left: edges.leftInner ? innerHalf : CONFIG.gapLeft,
        right: edges.rightInner ? innerHalf : CONFIG.gapRight,
    };

    const dockActive =
        CONFIG.dockMode === DockMode.AllWindows ||
        (slot.maximized && CONFIG.dockMode === DockMode.MaximizedOnly);

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

function insetRect(rect: RectF, gaps: Gaps): RectF {
    return {
        x: rect.x + gaps.left,
        y: rect.y + gaps.top,
        width: rect.width - gaps.left - gaps.right,
        height: rect.height - gaps.top - gaps.bottom,
    };
}

function rectsNear(a: RectF, b: RectF): boolean {
    return near(a.x, b.x) && near(a.y, b.y) && near(a.width, b.width) && near(a.height, b.height);
}

function cloneRect(rect: RectF): RectF {
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}
