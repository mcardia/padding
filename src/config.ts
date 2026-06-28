// Configuration: read once from the script's kwinrc section via readConfig().

const enum DockMode {
    Off = 0,
    MaximizedOnly = 1,
    AllWindows = 2,
}

interface PaddingConfig {
    // Outer-edge gaps (the side touching the screen / work-area boundary). Used on
    // all four sides of a maximized window and on the outer sides of snapped windows.
    gapTop: number;
    gapBottom: number;
    gapLeft: number;
    gapRight: number;
    // Gap on the interior divider shared between adjacent snapped windows.
    gapSnapped: number;
    dockMargin: number;
    dockMode: DockMode;
    padSnapped: boolean;
    ignored: string[];
}

// Windows that must never be touched (compositor/system surfaces).
const DEFAULT_IGNORED: string[] = [
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

function readInt(key: string, fallback: number): number {
    const raw = readConfig(key, fallback);
    const value = typeof raw === "number" ? raw : parseInt(String(raw), 10);
    return isNaN(value) ? fallback : value;
}

function readBool(key: string, fallback: boolean): boolean {
    const raw = readConfig(key, fallback);
    if (typeof raw === "boolean") {
        return raw;
    }
    const text = String(raw).toLowerCase();
    return text === "true" || text === "1";
}

function readString(key: string, fallback: string): string {
    const raw = readConfig(key, fallback);
    return raw === null || raw === undefined ? fallback : String(raw);
}

function clampDockMode(value: number): DockMode {
    if (value <= 0) {
        return DockMode.Off;
    }
    return value === 1 ? DockMode.MaximizedOnly : DockMode.AllWindows;
}

function parseIgnored(raw: string): string[] {
    const extra = raw
        .split(",")
        .map(function (entry: string): string {
            return entry.trim().toLowerCase();
        })
        .filter(function (entry: string): boolean {
            return entry.length > 0;
        });
    return DEFAULT_IGNORED.concat(extra);
}

function loadConfig(): PaddingConfig {
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

let CONFIG: PaddingConfig = loadConfig();

// Re-read the configuration (called when the user applies new settings).
function reloadConfig(): void {
    CONFIG = loadConfig();
}

function isIgnored(win: KWinWindow): boolean {
    const resourceClass = String(win.resourceClass).toLowerCase();
    const resourceName = String(win.resourceName).toLowerCase();
    return CONFIG.ignored.indexOf(resourceClass) >= 0 || CONFIG.ignored.indexOf(resourceName) >= 0;
}

// Tolerance for fractional scaling: frameGeometry/clientArea can return floats.
function near(a: number, b: number): boolean {
    return Math.abs(a - b) < 2;
}
