/**
 * Browser-only: makes a phone video small and quick to start before it's
 * uploaded (src/app/trainer/exercises/exercise-detail-modal.tsx).
 *
 * A 30-second clip straight from a phone is 1080p/4K at 10–20 Mbps, often
 * HEVC in a .mov, with the index ("moov") at the END of the file — so it
 * uploads slowly and a browser has to download all of it before it can
 * play. Here it's re-encoded on the device (WebCodecs, via mediabunny) to
 * H.264 at most 720p (~2 Mbps), written with the index first
 * ("fast start"): typically 5–10× smaller, plays in every browser, and
 * starts playing at once.
 *
 * Never a dead end: when the browser can't do it (no WebCodecs, a codec it
 * can't decode) or it fails, the original file is uploaded as before.
 * mediabunny is loaded only when a video is actually being prepared.
 */

/** Uploads stay under the bucket's limit (MAX_VIDEO_BYTES); this is what may be picked. */
export const MAX_SOURCE_VIDEO_BYTES = 1024 * 1024 * 1024;

const MAX_SHORT_EDGE = 720;
/** Above this a file is re-encoded even when it's already small enough in pixels. */
const REENCODE_ABOVE_BITRATE = 3_000_000;

export type PreparedVideo = {
  blob: Blob;
  type: string;
  /** false = the original file, unchanged. */
  converted: boolean;
};

function even(n: number): number {
  return Math.max(2, Math.round(n / 2) * 2);
}

export async function prepareVideoForUpload(
  file: File,
  type: string,
  onProgress: (fraction: number) => void,
): Promise<PreparedVideo> {
  const original: PreparedVideo = { blob: file, type, converted: false };
  try {
    if (typeof VideoEncoder === "undefined" || typeof VideoDecoder === "undefined") return original;
    const mb = await import("mediabunny");

    const input = new mb.Input({ source: new mb.BlobSource(file), formats: mb.ALL_FORMATS });
    const track = await input.getPrimaryVideoTrack();
    if (!track) return original;

    const width = track.displayWidth;
    const height = track.displayHeight;
    const duration = await input.computeDuration();
    const scale = Math.min(1, MAX_SHORT_EDGE / Math.min(width, height));
    const outWidth = even(width * scale);
    const outHeight = even(height * scale);
    const bitrate = duration > 0 ? (file.size * 8) / duration : Infinity;

    // "medium" ≈ 2 Mbps at 720p. (A numeric Quality — an exact bitrate — makes mediabunny 1.65 decide
    // it can't encode at all and silently drop the video track.)
    const quality = new mb.Quality("medium");
    const reencode =
      (scale < 1 || bitrate > REENCODE_ABOVE_BITRATE || track.codec !== "avc") &&
      (await mb.canEncodeVideo("avc", { width: outWidth, height: outHeight, quality }));

    const output = new mb.Output({
      format: new mb.Mp4OutputFormat({ fastStart: "in-memory" }),
      target: new mb.BufferTarget(),
    });
    const conversion = await mb.Conversion.init({
      input,
      output,
      tracks: "primary",
      // Not re-encoding = only rewriting the container: same pictures, index first.
      video: reencode ? { codec: "avc", width: outWidth, height: outHeight, fit: "contain", quality, forceTranscode: true } : {},
      // AAC is copied as is; anything else becomes AAC (or is dropped if the browser can't).
      audio: { codec: "aac" },
    });
    // A video with its picture dropped (some codec the browser can't handle) is no use: upload the original.
    if (!conversion.isValid || conversion.discardedTracks.some((d) => d.track.type === "video")) return original;

    conversion.onProgress = (p) => onProgress(Math.max(0, Math.min(1, p)));
    await conversion.execute();

    const buffer = output.target.buffer;
    if (!buffer || buffer.byteLength === 0) return original;
    const blob = new Blob([buffer], { type: "video/mp4" });
    // Only a re-encode can be expected to shrink it; a rewrite is kept for the fast start.
    if (reencode && blob.size >= file.size) return original;
    return { blob, type: "video/mp4", converted: true };
  } catch (err) {
    console.warn("prepareVideoForUpload: uploading the original file", err);
    return original;
  }
}

/**
 * PUT to a one-time signed upload URL with upload progress (fetch has
 * none) — the same request supabase-js's uploadToSignedUrl makes. Cached
 * for a year: an uploaded file never changes (a new one gets a new name).
 */
export function uploadWithProgress(options: {
  supabaseUrl: string;
  anonKey: string;
  accessToken: string | null;
  bucket: string;
  path: string;
  token: string;
  blob: Blob;
  onProgress: (fraction: number) => void;
}): Promise<{ ok: true } | { ok: false; status: number }> {
  const { supabaseUrl, anonKey, accessToken, bucket, path, token, blob, onProgress } = options;
  const url = new URL(`${supabaseUrl.replace(/\/$/, "")}/storage/v1/object/upload/sign/${bucket}/${path}`);
  url.searchParams.set("token", token);

  const body = new FormData();
  body.append("cacheControl", "31536000");
  body.append("", blob);

  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url.toString());
    xhr.setRequestHeader("apikey", anonKey);
    xhr.setRequestHeader("authorization", `Bearer ${accessToken ?? anonKey}`);
    xhr.setRequestHeader("x-upsert", "false");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => resolve(xhr.status >= 200 && xhr.status < 300 ? { ok: true } : { ok: false, status: xhr.status });
    xhr.onerror = () => resolve({ ok: false, status: 0 });
    xhr.onabort = () => resolve({ ok: false, status: 0 });
    xhr.send(body);
  });
}
