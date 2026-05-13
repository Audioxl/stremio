import http from "node:http";
import { Readable } from "node:stream";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";

const PORT = Number(process.env.PORT || 7000);
const HOST = process.env.HOST || "0.0.0.0";
const BASE_URL = process.env.BASE_URL || "";
const SERIES_CATALOG_ID = "private-drive-series";
const MOVIE_CATALOG_ID = "private-drive-movies";
const RESOURCE_TYPES = ["catalog", "meta", "stream"];
const SERIES = [
  {
    id: "series:spyxfamily",
    name: "SPYXFAMILY",
    match: /^SPYXFAMILY (\d+)X(\d+)$/i,
    poster: "https://drive.google.com/thumbnail?id=124kGqfIzgelRD5VGCEiOoRGcdFoy2qqP&sz=w780",
    seasonPosters: {
      1: "https://drive.google.com/thumbnail?id=124kGqfIzgelRD5VGCEiOoRGcdFoy2qqP&sz=w780",
      2: "https://drive.google.com/thumbnail?id=1Xf7j6iWx5fIV6dkhh7c_cnA7GguxTnLc&sz=w780"
    },
    description: "SPYXFAMILY"
  },
  {
    id: "series:death-note",
    name: "DEATH NOTE",
    match: /^DEATH NOTE (\d+)$/i,
    poster: "https://drive.google.com/thumbnail?id=1K2eRqmwDaEimYzn01yFHdNuA5RSFfsms&sz=w780",
    description: "DEATH NOTE"
  }
];

const manifest = {
  id: "org.personal.drive-videos",
  version: "1.0.0",
  name: "MaxServer",
  description: "Personal Google Drive video catalog.",
  resources: RESOURCE_TYPES,
  types: ["series", "movie"],
  catalogs: [
    {
      type: "series",
      id: SERIES_CATALOG_ID,
      name: "MaxServer"
    },
    {
      type: "movie",
      id: MOVIE_CATALOG_ID,
      name: "MaxServer"
    }
  ],
  idPrefixes: ["series:", "drive:"],
  behaviorHints: {
    configurable: false,
    adult: false
  }
};

const jsonHeaders = {
  "content-type": "application/json; charset=utf-8",
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "*",
  "access-control-expose-headers": "content-length, content-range, accept-ranges"
};

const contentTypeByExtension = {
  ".mp4": "video/mp4",
  ".m4v": "video/x-m4v",
  ".mkv": "video/x-matroska",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".avi": "video/x-msvideo"
};

async function loadVideos() {
  const raw = await readFile(new URL("./videos.json", import.meta.url), "utf8");
  return JSON.parse(raw).map(normalizeVideo);
}

function normalizeVideo(video, index) {
  const driveId = video.driveId || extractDriveId(video.driveUrl || video.url || "");
  if (!driveId) {
    throw new Error(`Missing Google Drive file id for video at index ${index}`);
  }

  const id = `drive:${driveId}`;
  const title = video.title || `Drive video ${index + 1}`;
  const seriesInfo = getSeriesInfo(title);
  const poster = video.poster || `https://drive.google.com/thumbnail?id=${driveId}&sz=w780`;
  const filename = video.filename || title;

  return {
    ...video,
    id,
    driveId,
    title,
    seriesInfo,
    mediaType: seriesInfo ? "series" : "movie",
    filename,
    poster,
    description: video.description || "",
    released: video.released || undefined,
    genre: video.genre || undefined
  };
}

function extractDriveId(value) {
  const patterns = [
    /\/file\/d\/([^/]+)/,
    /[?&]id=([^&]+)/,
    /^[-\w]{20,}$/
  ];

  for (const pattern of patterns) {
    const match = String(value).match(pattern);
    if (match) return decodeURIComponent(match[1] || match[0]);
  }

  return "";
}

function getSeriesInfo(title) {
  for (const series of SERIES) {
    const match = title.match(series.match);
    if (!match) continue;

    if (series.id === "series:death-note") {
      return { seriesId: series.id, season: 1, episode: Number(match[1]) };
    }

    return { seriesId: series.id, season: Number(match[1]), episode: Number(match[2]) };
  }

  return null;
}

function toMovieMetaPreview(req, video) {
  return {
    id: video.id,
    type: "movie",
    name: video.title,
    poster: posterUrl(req, video.poster),
    posterShape: "poster",
    description: video.description,
    genres: asArray(video.genre),
    releaseInfo: video.released ? String(new Date(video.released).getFullYear()) : undefined
  };
}

function toMovieFullMeta(req, video) {
  return {
    ...toMovieMetaPreview(req, video),
    background: posterUrl(req, video.background || video.poster),
    logo: video.logo,
    videos: []
  };
}

function toSeriesMetaPreview(req, series) {
  return {
    id: series.id,
    type: "series",
    name: series.name,
    poster: posterUrl(req, series.poster),
    posterShape: "poster",
    description: series.description,
    genres: ["Anime"]
  };
}

function toSeriesFullMeta(req, series, videos) {
  const episodes = videos
    .filter((video) => video.seriesInfo?.seriesId === series.id)
    .sort((a, b) => a.seriesInfo.season - b.seriesInfo.season || a.seriesInfo.episode - b.seriesInfo.episode)
    .map((video) => ({
      id: video.id,
      title: video.title,
      season: video.seriesInfo.season,
      episode: video.seriesInfo.episode,
      released: video.released,
      thumbnail: posterUrl(req, series.seasonPosters?.[video.seriesInfo.season] || video.poster),
      overview: video.description
    }));

  return {
    ...toSeriesMetaPreview(req, series),
    background: posterUrl(req, series.background || series.poster),
    seasonPosters: proxySeasonPosters(req, series.seasonPosters),
    videos: episodes
  };
}

function asArray(value) {
  if (!value) return undefined;
  return Array.isArray(value) ? value : [value];
}

function driveDownloadUrl(driveId) {
  return `https://drive.google.com/uc?export=download&id=${encodeURIComponent(driveId)}`;
}

function driveConfirmUrl(driveId, confirmation) {
  const url = new URL("https://drive.usercontent.google.com/download");
  url.searchParams.set("id", driveId);
  url.searchParams.set("export", "download");
  url.searchParams.set("confirm", confirmation.confirm);

  if (confirmation.uuid) {
    url.searchParams.set("uuid", confirmation.uuid);
  }

  return url.toString();
}

function publicBaseUrl(req) {
  if (BASE_URL) return BASE_URL.replace(/\/$/, "");

  const host = req.headers["x-forwarded-host"] || req.headers.host || `127.0.0.1:${PORT}`;
  const proto = req.headers["x-forwarded-proto"] || (String(host).startsWith("127.") ? "http" : "https");
  return `${proto}://${host}`;
}

function streamUrl(req, video) {
  return `${publicBaseUrl(req)}/drive/${encodeURIComponent(video.driveId)}/${encodeURIComponent(video.filename)}`;
}

function posterUrl(req, poster) {
  if (!poster) return poster;

  const driveId = extractDriveId(poster);
  if (!driveId) return poster;

  return `${publicBaseUrl(req)}/poster/${encodeURIComponent(driveId)}.jpg`;
}

function proxySeasonPosters(req, seasonPosters) {
  if (!seasonPosters) return undefined;

  return Object.fromEntries(
    Object.entries(seasonPosters).map(([season, poster]) => [season, posterUrl(req, poster)])
  );
}

async function route(req, res) {
  const url = new URL(req.url, publicBaseUrl(req));

  if (req.method === "OPTIONS") {
    res.writeHead(204, jsonHeaders);
    res.end();
    return;
  }

  if (url.pathname === "/" || url.pathname === "/manifest.json") {
    sendJson(res, manifest);
    return;
  }

  const posterMatch = url.pathname.match(/^\/poster\/([^/]+)\.jpg$/);
  if (posterMatch) {
    await proxyDrivePoster(res, decodeURIComponent(posterMatch[1]));
    return;
  }

  const videos = await loadVideos();

  if (url.pathname === `/catalog/series/${SERIES_CATALOG_ID}.json`) {
    sendJson(res, { metas: SERIES.map((series) => toSeriesMetaPreview(req, series)).sort(compareByName) });
    return;
  }

  if (url.pathname === `/catalog/movie/${MOVIE_CATALOG_ID}.json`) {
    sendJson(res, {
      metas: videos
        .filter((video) => video.mediaType === "movie")
        .map((video) => toMovieMetaPreview(req, video))
        .sort(compareByName)
    });
    return;
  }

  const seriesMetaMatch = url.pathname.match(/^\/meta\/series\/(.+)\.json$/);
  if (seriesMetaMatch) {
    const series = SERIES.find((item) => item.id === decodeURIComponent(seriesMetaMatch[1]));
    sendJson(res, { meta: series ? toSeriesFullMeta(req, series, videos) : null }, series ? 200 : 404);
    return;
  }

  const movieMetaMatch = url.pathname.match(/^\/meta\/movie\/(.+)\.json$/);
  if (movieMetaMatch) {
    const video = findVideo(videos, decodeURIComponent(movieMetaMatch[1]));
    sendJson(res, { meta: video ? toMovieFullMeta(req, video) : null }, video ? 200 : 404);
    return;
  }

  const streamMatch = url.pathname.match(/^\/stream\/(?:movie|series)\/(.+)\.json$/);
  if (streamMatch) {
    const video = findVideo(videos, decodeURIComponent(streamMatch[1]));
    if (!video) {
      sendJson(res, { streams: [] }, 404);
      return;
    }

    sendJson(res, { streams: [toStream(req, video)] });
    return;
  }

  const legacyMetaMatch = url.pathname.match(/^\/meta\/movie\/(.+)\.json$/);
  if (legacyMetaMatch) {
    const video = findVideo(videos, decodeURIComponent(legacyMetaMatch[1]));
    sendJson(res, { meta: video ? toMovieFullMeta(req, video) : null }, video ? 200 : 404);
    return;
  }

  const driveMatch = url.pathname.match(/^\/drive\/([^/]+)\/.+$/);
  if (driveMatch) {
    const driveId = decodeURIComponent(driveMatch[1]);
    const filename = decodeURIComponent(url.pathname.split("/").at(-1) || "");
    await proxyDriveVideo(req, res, driveId, filename);
    return;
  }

  sendJson(res, { error: "Not found" }, 404);
}

function findVideo(videos, id) {
  return videos.find((video) => video.id === id || video.driveId === id);
}

function compareByName(a, b) {
  return a.name.localeCompare(b.name, "it", { numeric: true, sensitivity: "base" });
}

function toStream(req, video) {
  return {
    title: video.streamTitle || "Google Drive",
    name: video.title,
    url: streamUrl(req, video),
    behaviorHints: {
      notWebReady: ![".mp4", ".m4v", ".webm"].includes(extname(video.filename).toLowerCase())
    }
  };
}

async function proxyDriveVideo(req, res, driveId, filename) {
  const fallbackType = contentTypeByExtension[extname(filename).toLowerCase()] || "application/octet-stream";
  const driveResponse = await fetchDriveFile(driveId, req.headers.range);
  const contentType = driveResponse.headers.get("content-type") || fallbackType;

  if (contentType.includes("text/html")) {
    sendJson(
      res,
      {
        error: "Google Drive returned an HTML page instead of the video file.",
        hint: "Check that the file is shared with anyone who has the link and is downloadable."
      },
      502
    );
    return;
  }

  const headers = {
    "content-type": contentType,
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "*",
    "access-control-expose-headers": "content-length, content-range, accept-ranges",
    "accept-ranges": driveResponse.headers.get("accept-ranges") || "bytes",
    "cache-control": "no-store"
  };

  copyHeader(driveResponse, headers, "content-length");
  copyHeader(driveResponse, headers, "content-range");
  copyHeader(driveResponse, headers, "last-modified");
  copyHeader(driveResponse, headers, "etag");

  res.writeHead(driveResponse.status, headers);

  if (req.method === "HEAD" || !driveResponse.body) {
    res.end();
    return;
  }

  Readable.fromWeb(driveResponse.body).pipe(res);
}

async function proxyDrivePoster(res, driveId) {
  const response = await fetch(`https://drive.google.com/thumbnail?id=${encodeURIComponent(driveId)}&sz=w780`, {
    headers: {
      "user-agent": "Mozilla/5.0",
      accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8"
    },
    redirect: "follow"
  });

  const contentType = response.headers.get("content-type") || "image/jpeg";
  if (!response.ok || !contentType.startsWith("image/")) {
    sendJson(res, { error: "Poster not available" }, 502);
    return;
  }

  const headers = {
    "content-type": contentType,
    "access-control-allow-origin": "*",
    "cache-control": "public, max-age=86400"
  };

  copyHeader(response, headers, "content-length");
  res.writeHead(200, headers);

  if (!response.body) {
    res.end();
    return;
  }

  Readable.fromWeb(response.body).pipe(res);
}

async function fetchDriveFile(driveId, range) {
  const firstResponse = await requestDrive(driveDownloadUrl(driveId), range);
  const firstType = firstResponse.headers.get("content-type") || "";

  if (!firstType.includes("text/html")) {
    return firstResponse;
  }

  const html = await firstResponse.text();
  const confirmation = extractDriveConfirmation(html);
  if (!confirmation.confirm) {
    return new Response(html, {
      status: firstResponse.status,
      headers: firstResponse.headers
    });
  }

  return requestDrive(driveConfirmUrl(driveId, confirmation), range);
}

function requestDrive(url, range) {
  const headers = {
    "user-agent": "Mozilla/5.0",
    accept: "*/*"
  };

  if (range) headers.range = range;

  return fetch(url, {
    headers,
    redirect: "follow"
  });
}

function extractDriveConfirmation(html) {
  return {
    confirm: extractInputValue(html, "confirm") || extractPattern(html, /confirm=([0-9A-Za-z_-]+)&/) || extractPattern(html, /"confirm","([^"]+)"/),
    uuid: extractInputValue(html, "uuid")
  };
}

function extractInputValue(html, name) {
  return extractPattern(html, new RegExp(`name="${name}"\\s+value="([^"]+)"`));
}

function extractPattern(html, pattern) {
  const match = html.match(pattern);
  return match ? match[1] : "";
}

function copyHeader(response, headers, name) {
  const value = response.headers.get(name);
  if (value) headers[name] = value;
}

function sendJson(res, body, status = 200) {
  res.writeHead(status, jsonHeaders);
  res.end(JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  route(req, res).catch((error) => {
    console.error(error);
    sendJson(res, { error: error.message }, 500);
  });
});

server.listen(PORT, HOST, () => {
  const localUrl = BASE_URL || `http://127.0.0.1:${PORT}`;
  console.log(`Private Drive Stremio add-on running at ${localUrl}/manifest.json`);
});
