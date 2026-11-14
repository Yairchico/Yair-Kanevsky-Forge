/**
 * Exercise videos are stored as a plain link (exercises.video_url, migration
 * 0015). This turns a link the trainer pasted into something safe to embed:
 * the player URL is always BUILT here from a validated video id on a known
 * host — the pasted text itself never becomes an iframe src. Pure, so the
 * same function validates on the server (Server Action) and renders on the
 * client.
 */

export type VideoKind = "youtube" | "vimeo" | "file";

export interface ParsedVideo {
  kind: VideoKind;
  /** iframe src (youtube/vimeo) or the file URL itself (file). */
  embedUrl: string;
  /** Where "open in a new tab" goes. */
  watchUrl: string;
}

export const MAX_VIDEO_URL_LENGTH = 500;

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
]);
const VIMEO_HOSTS = new Set(["vimeo.com", "www.vimeo.com"]);
const VIDEO_FILE = /\.(mp4|webm|m4v|mov)$/i;

/** "90", "90s", "1m30s", "1h2m3s" -> seconds. */
function parseStartSeconds(value: string | null): number | null {
  if (!value) return null;
  if (/^\d+$/.test(value)) return Number(value);
  const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(value);
  if (!match || !match[0]) return null;
  const seconds = Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
  return seconds > 0 ? seconds : null;
}

const UNSUPPORTED =
  "הקישור לא נתמך. אפשר להדביק קישור מ-YouTube או Vimeo, או קישור ישיר לקובץ וידאו (mp4).";

export function parseVideoUrl(input: string): ParsedVideo | { error: string } {
  const raw = input.trim();
  if (!raw) return { error: "נא להדביק קישור לסרטון" };
  if (raw.length > MAX_VIDEO_URL_LENGTH) return { error: "הקישור ארוך מדי" };

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { error: "הקישור לא תקין" };
  }
  if (url.protocol !== "https:") return { error: "הקישור חייב להתחיל ב-https://" };
  if (url.username || url.password) return { error: "הקישור לא תקין" };

  const host = url.hostname.toLowerCase();
  const segments = url.pathname.split("/").filter(Boolean);

  // ---- YouTube (watch, youtu.be, shorts, embed, live) ----
  let youtubeId: string | null = null;
  if (host === "youtu.be") {
    youtubeId = segments[0] ?? null;
  } else if (YOUTUBE_HOSTS.has(host)) {
    if (segments[0] === "watch") youtubeId = url.searchParams.get("v");
    else if (["shorts", "embed", "live", "v"].includes(segments[0] ?? "")) youtubeId = segments[1] ?? null;
    if (!youtubeId) return { error: "לא זוהה סרטון בקישור של YouTube" };
  }
  if (youtubeId !== null) {
    if (!YOUTUBE_ID.test(youtubeId)) return { error: "לא זוהה סרטון בקישור של YouTube" };
    const start = parseStartSeconds(url.searchParams.get("t") ?? url.searchParams.get("start"));
    return {
      kind: "youtube",
      embedUrl: `https://www.youtube-nocookie.com/embed/${youtubeId}?rel=0&playsinline=1${start ? `&start=${start}` : ""}`,
      watchUrl: `https://www.youtube.com/watch?v=${youtubeId}${start ? `&t=${start}s` : ""}`,
    };
  }

  // ---- Vimeo (vimeo.com/ID, vimeo.com/ID/HASH for unlisted, player.vimeo.com/video/ID?h=HASH) ----
  let vimeoId: string | null = null;
  let vimeoHash: string | null = null;
  if (VIMEO_HOSTS.has(host)) {
    vimeoId = segments[0] ?? null;
    vimeoHash = segments[1] ?? null;
  } else if (host === "player.vimeo.com") {
    vimeoId = segments[0] === "video" ? (segments[1] ?? null) : null;
    vimeoHash = url.searchParams.get("h");
  }
  if (VIMEO_HOSTS.has(host) || host === "player.vimeo.com") {
    if (!vimeoId || !/^\d{6,12}$/.test(vimeoId)) return { error: "לא זוהה סרטון בקישור של Vimeo" };
    const hash = vimeoHash && /^[0-9a-f]{6,20}$/i.test(vimeoHash) ? vimeoHash : null;
    return {
      kind: "vimeo",
      embedUrl: `https://player.vimeo.com/video/${vimeoId}${hash ? `?h=${hash}` : ""}`,
      watchUrl: `https://vimeo.com/${vimeoId}${hash ? `/${hash}` : ""}`,
    };
  }

  // ---- A direct link to a video file, played by the browser's own <video> ----
  if (VIDEO_FILE.test(url.pathname)) {
    return { kind: "file", embedUrl: url.toString(), watchUrl: url.toString() };
  }

  return { error: UNSUPPORTED };
}
