// Ambient declarations for the subset of the KWin 6.x scripting API used by this script.
// KWin runs on QJSEngine; these globals/objects are provided at runtime, not imported.

interface RectF {
    x: number;
    y: number;
    width: number;
    height: number;
}

interface Signal0 {
    connect(callback: () => void): void;
    disconnect(callback: () => void): void;
}

interface Signal1<A> {
    connect(callback: (arg: A) => void): void;
    disconnect(callback: (arg: A) => void): void;
}

// window.maximizeMode
declare const enum MaximizeMode {
    Restore = 0,
    Vertical = 1,
    Horizontal = 2,
    Full = 3,
}

// workspace.clientArea() option selector.
declare const enum ClientAreaOption {
    PlacementArea = 0,
    MovementArea = 1,
    MaximizeArea = 2,
    MaximizeFullArea = 3,
    FullScreenArea = 4,
    WorkArea = 5,
    FullArea = 6,
    ScreenArea = 7,
}

// A tile in KWin's tiling system. Quick-tiled (Super+Arrow) AND custom-tiled
// windows are assigned one; floating/maximized windows have `tile === null`.
interface KWinTile {
    readonly absoluteGeometry: RectF;
}

interface KWinWindow {
    readonly normalWindow: boolean;
    readonly dock: boolean;
    readonly desktopWindow: boolean;
    readonly fullScreen: boolean;
    readonly move: boolean;
    readonly resize: boolean;
    readonly resourceClass: string;
    readonly resourceName: string;
    readonly internalId: { toString(): string };
    readonly maximizeMode: MaximizeMode;
    // Quick-tile state is NOT exposed as `quickTileMode` in the scripting API;
    // the assigned tile (with its geometry) is the reliable snap indicator.
    readonly tile: KWinTile | null;

    frameGeometry: RectF;
    setMaximize(vertically: boolean, horizontally: boolean): void;

    readonly frameGeometryChanged: Signal1<RectF>;
    readonly maximizedChanged: Signal0;
    readonly quickTileModeChanged: Signal0;
    readonly tileChanged: Signal0;
    readonly fullScreenChanged: Signal0;
}

interface KWinWorkspace {
    windowList(): KWinWindow[];
    readonly windowAdded: Signal1<KWinWindow>;
    clientArea(option: ClientAreaOption, window: KWinWindow): RectF;
    readonly screensChanged: Signal0;
    readonly virtualScreenSizeChanged: Signal0;
    readonly virtualScreenGeometryChanged: Signal0;
}

interface KWinGlobals {
    readonly MaximizeArea: ClientAreaOption;
    readonly ScreenArea: ClientAreaOption;
    readonly PlacementArea: ClientAreaOption;
    readonly FullScreenArea: ClientAreaOption;
}

interface KWinOptions {
    // Emitted on every KWin reconfigure, including when the user applies the
    // script's own settings — used to re-read config and re-pad live.
    readonly configChanged: Signal0;
}

declare const workspace: KWinWorkspace;
declare const KWin: KWinGlobals;
declare const options: KWinOptions;
declare function readConfig(key: string, defaultValue?: unknown): unknown;

declare const console: {
    log(...args: unknown[]): void;
    info(...args: unknown[]): void;
    warn(...args: unknown[]): void;
    error(...args: unknown[]): void;
};
