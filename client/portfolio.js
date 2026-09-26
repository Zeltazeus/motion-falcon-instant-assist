const YOUTUBE_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

export function normalizePortfolioSection(section) {
  const normalized = typeof section === "string"
    ? section.trim().toLowerCase().replace(/[^a-z]/g, "")
    : "";
  if (["image", "images", "gallery", "photo", "photos"].includes(normalized)) return "images";
  if (["video", "videos", "shortvideo", "shortvideos", "film", "films"].includes(normalized)) return "videos";
  return "current-work";
}

export function getYouTubeVideoId(value) {
  if (typeof value !== "string") return null;

  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;

  let videoId = null;
  if (url.hostname === "youtu.be") {
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments.length === 1) videoId = segments[0];
  } else if (url.hostname === "youtube.com" || url.hostname.endsWith(".youtube.com")) {
    if (url.pathname === "/watch") videoId = url.searchParams.get("v");
    else videoId = url.pathname.match(/^\/shorts\/([^/]+)\/?$/)?.[1] || null;
  }

  return videoId && YOUTUBE_ID_PATTERN.test(videoId) ? videoId : null;
}

function isPortfolioImagePath(value, directory) {
  if (typeof value !== "string") {
    return false;
  }

  let decodedPath;
  try {
    decodedPath = decodeURIComponent(value);
  } catch {
    return false;
  }

  if (
    !decodedPath.startsWith(`/portfolio/${directory}/`)
    || !/^\/portfolio\/[A-Za-z0-9 ._/-]+$/.test(decodedPath)
  ) {
    return false;
  }
  return decodedPath.split("/").every((segment) => segment !== "." && segment !== "..");
}

function requiredText(value, field) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`Portfolio entry requires ${field}.`);
  }
  return value.trim();
}

function optionalText(value, field) {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string") throw new TypeError(`Portfolio ${field} must be text.`);
  return value.trim();
}

function normalizeImageEntries(entries, collection) {
  const directory = collection === "currentWork" ? "current-work" : "images";
  return entries.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new TypeError(`Portfolio ${collection} entries must be objects.`);
    }
    const src = requiredText(entry.src, "src");
    if (!isPortfolioImagePath(src, directory)) {
      throw new TypeError(`Portfolio ${collection} image src must point inside /portfolio/${directory}/.`);
    }
    return {
      src,
      title: requiredText(entry.title, "title"),
      alt: requiredText(entry.alt, "alt text"),
      description: optionalText(entry.description, "description"),
    };
  });
}

export function normalizePortfolioManifest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Portfolio manifest must be an object.");
  }
  for (const key of ["currentWork", "images", "videos"]) {
    if (!Array.isArray(value[key])) throw new TypeError(`Portfolio manifest requires a ${key} array.`);
  }

  const videos = value.videos.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new TypeError("Portfolio videos entries must be objects.");
    }
    const url = requiredText(entry.url, "url");
    const videoId = getYouTubeVideoId(url);
    if (!videoId) throw new TypeError("Portfolio video url must be a valid YouTube watch or short URL.");
    return {
      videoId,
      title: optionalText(entry.title, "title") || `Video ${index + 1}`,
      description: optionalText(entry.description, "description"),
    };
  });

  return {
    currentWork: normalizeImageEntries(value.currentWork, "currentWork"),
    images: normalizeImageEntries(value.images, "images"),
    videos,
  };
}