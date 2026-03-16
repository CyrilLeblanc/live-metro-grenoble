// ---------------------------------------------------------------------------
// Map viewport — Grenoble metropolitan area
// ---------------------------------------------------------------------------

/** Default map center [lat, lng] */
export const GRENOBLE_CENTER: [number, number] = [45.1885, 5.7245]

/** Hard bounds that prevent panning outside the Grenoble area */
export const GRENOBLE_BOUNDS: [[number, number], [number, number]] = [
  [44.95, 5.45], // SW corner
  [45.45, 6.05], // NE corner
]

// ---------------------------------------------------------------------------
// Tram animation — useAnimatedTrams
// ---------------------------------------------------------------------------

/** Seconds before the next stop at which deceleration starts (linear ramp to 0). */
export const DECEL_THRESHOLD = 20

/** Maximum tram speed cap used when deriving speed from position deltas (m/s = 25 km/h). */
export const MAX_SPEED = 6.94

// ---------------------------------------------------------------------------
// GPS / on-tram tracking — useUserOnTram
// ---------------------------------------------------------------------------

/** Distance within which a tram is considered "nearby" for selection (metres). */
export const NEARBY_THRESHOLD_M = 80

/** Distance at which an auto-deconfirm vote is cast (metres). */
export const AUTODECONFIRM_THRESHOLD_M = 150

/** Number of consecutive GPS fixes beyond AUTODECONFIRM_THRESHOLD_M before deconfirming. */
export const AUTODECONFIRM_FIXES = 20

/** GPS fixes with accuracy worse than this are ignored (metres). */
export const MAX_ACCURACY_M = 50

/** Speed readings above this value are discarded as GPS noise (m/s = 36 km/h). */
export const MAX_SPEED_MS = 10

/** Number of GPS fixes to retain in the rolling history buffer. */
export const GPS_HISTORY = 30

/** Window length used to compute average speed from GPS history (seconds). */
export const SPEED_WINDOW_SEC = 10

// ---------------------------------------------------------------------------
// Polling — real-time tram position refresh
// ---------------------------------------------------------------------------

/** Interval between automatic tram position API requests (milliseconds). */
export const POLLING_INTERVAL_MS = 10_000

/** Starting value of the countdown timer shown in the UI (seconds). */
export const COUNTDOWN_START_S = 10

// ---------------------------------------------------------------------------
// Stop markers — StopMarker component
// ---------------------------------------------------------------------------

/** Zoom level at which stop markers switch from small circles to SVG icons. */
export const SVG_THRESHOLD = 14

// ---------------------------------------------------------------------------
// Segment speed graphs — GPS-contributed speed profiles
// ---------------------------------------------------------------------------

/** Maximum number of speed graph recordings kept per segment (oldest are dropped). */
export const SEGMENT_SPEEDS_MAX_RECORDS = 10

/** Resolution of the averaged speed grid (seconds between grid points). */
export const SEGMENT_SPEEDS_GRID_STEP_SEC = 2

/** Maximum accepted speed value in a submitted speed graph (m/s). */
export const MAX_SEGMENT_SPEED_MS = 10

// ---------------------------------------------------------------------------
// Upstream API — Métromobilité data.mobilites-m.fr
// ---------------------------------------------------------------------------

/** Base URL for the Métromobilité real-time and static GTFS APIs. */
export const UPSTREAM_API_BASE = 'https://data.mobilites-m.fr/api'

// ---------------------------------------------------------------------------
// Canvas rendering — CanvasTramLayer sprite dimensions
// ---------------------------------------------------------------------------

/** Base sprite size in px for tram icons on the map. */
export const TRAM_SPRITE_SIZE = 24

/** Sprite size in px when the tram is highlighted/hovered. */
export const TRAM_SPRITE_SIZE_HIGHLIGHTED = 32

/** Squared pixel radius for tram click/hover hit-testing on the canvas. */
export const TRAM_HIT_TEST_RADIUS_SQ = 16 * 16

// ---------------------------------------------------------------------------
// Upstream API timeouts and caching
// ---------------------------------------------------------------------------

/** Per-cluster fetch timeout when querying the upstream Métromobilité API (ms). */
export const CLUSTER_TIMEOUT_MS = 3000

/** Time-to-live for the shared tram position response cache (ms). */
export const RESPONSE_CACHE_TTL_MS = 10_000

/** Minimum elapsed time between API ticks to derive speed from displacement (seconds). */
export const MIN_ELAPSED_FOR_SPEED = 0.1

// ---------------------------------------------------------------------------
// Theme colors — shared across UI components
// ---------------------------------------------------------------------------

/** Dark panel background colour. */
export const PANEL_BG = '#343139'

/** Panel border colour. */
export const PANEL_BORDER = '#3d3a41'

/** Accent blue used for interactive elements. */
export const ACCENT_BLUE = '#96dbeb'

// ---------------------------------------------------------------------------
// Passive tracking — usePassiveTracking
// ---------------------------------------------------------------------------

/** Accelerometer horizontal-axis variance below which the user is considered stationary (m²/s⁴). */
export const ACCEL_IDLE_THRESHOLD = 0.15

/** Accelerometer horizontal-axis variance above which the user is considered moving (m²/s⁴). */
export const ACCEL_MOVE_THRESHOLD = 0.5

/** Maximum GPS accuracy accepted for passive tracking (metres). */
export const PASSIVE_MAX_ACCURACY_M = 35

/** Maximum duration of a valid passive segment (seconds). */
export const PASSIVE_MAX_SEGMENT_DURATION_S = 180

/** Maximum distance from a GPS point to the nearest GTFS segment path to be eligible (metres). */
export const PASSIVE_MAX_DISTANCE_TO_LINE_M = 50

/** Minimum GPS speed to exclude walking when no accelerometer is available (m/s ≈ 6 km/h). */
export const PASSIVE_MIN_SPEED_MS = 1.67

/** Minimum number of valid GPS points for a segment to be submitted. */
export const PASSIVE_MIN_POINTS_PER_SEGMENT = 10

/** Lower bound of walking step frequency for Z-axis peak detection (Hz). */
export const WALKING_STEP_FREQ_MIN_HZ = 1.5

/** Upper bound of walking step frequency for Z-axis peak detection (Hz). */
export const WALKING_STEP_FREQ_MAX_HZ = 2.5

// ---------------------------------------------------------------------------
// Unit conversions
// ---------------------------------------------------------------------------

/** Convert metres/second to km/h. */
export function msToKmh(ms: number): number { return ms * 3.6 }
