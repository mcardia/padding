// Geometry: figure out a window's target "slot" (maximized area or tile rect) and
// the per-side gaps to inset it by.

interface Gaps {
    top: number;
    bottom: number;
    left: number;
    right: number;
}

// Which edges of a slot are interior (shared with an adjacent tile) vs outer
// (touching the screen/work-area boundary). Inner edges get a half gap.
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

// Determine the slot a window currently occupies, or null when it is floating
// (and therefore should not be padded). Custom tiles are intentionally skipped.
function slotForWindow(win: KWinWindow): Slot | null {
    if (win.maximizeMode === MaximizeMode.Full) {
        return { rect: maximizeArea(win), edges: OUTER_EDGES, maximized: true };
    }

    const mode = win.quickTileMode;
    if (mode === QuickTileFlag.None || (mode & QuickTileFlag.Custom) !== 0) {
        return null;
    }

    const hasLeft = (mode & QuickTileFlag.Left) !== 0;
    const hasRight = (mode & QuickTileFlag.Right) !== 0;
    const hasTop = (mode & QuickTileFlag.Top) !== 0;
    const hasBottom = (mode & QuickTileFlag.Bottom) !== 0;
    if (!hasLeft && !hasRight && !hasTop && !hasBottom) {
        return null;
    }

    const area = maximizeArea(win);
    const halfWidth = area.width / 2;
    const halfHeight = area.height / 2;

    const rect: RectF = {
        x: hasRight ? area.x + halfWidth : area.x,
        y: hasBottom ? area.y + halfHeight : area.y,
        width: hasLeft || hasRight ? halfWidth : area.width,
        height: hasTop || hasBottom ? halfHeight : area.height,
    };

    // The edge opposite the tiled side is the split line shared with a neighbour.
    const edges: SlotEdges = {
        leftInner: hasRight,
        rightInner: hasLeft,
        topInner: hasBottom,
        bottomInner: hasTop,
    };

    return { rect, edges, maximized: false };
}

// Per-side gaps: full gap on outer edges, half gap on inner (shared) edges.
// Dock compensation adds dockMargin on outer edges that face a panel.
function gapsForSlot(win: KWinWindow, slot: Slot): Gaps {
    const gap = CONFIG.gapSize;
    const half = gap / 2;
    const edges = slot.edges;

    const gaps: Gaps = {
        top: edges.topInner ? half : gap,
        bottom: edges.bottomInner ? half : gap,
        left: edges.leftInner ? half : gap,
        right: edges.rightInner ? half : gap,
    };

    const dockActive =
        CONFIG.dockMode === DockMode.AllWindows ||
        (slot.maximized && CONFIG.dockMode === DockMode.MaximizedOnly);

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
