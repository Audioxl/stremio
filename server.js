import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";

const PORT = Number(process.env.PORT || 7000);
const HOST = process.env.HOST || "0.0.0.0";
const BASE_URL = process.env.BASE_URL || "";
const CATALOG_ID = "private-drive-videos";
const RESOURCE_TYPES = ["catalog", "meta", "stream"];

const manifest = {
  id: "org.personal.drive-videos",
  version: "1.0.0",
  name: "Private Drive Videos",
  description: "A private Stremio add-on for your own Google Drive videos.",
  resources: RESOURCE_TYPES,
  types: ["movie"],
  catalogs: [
    {
      type: "movie",
      id: CATALOG_ID,
      name: "Google Drive"
    }
  ],
  idPrefixes: ["drive:"],
  behaviorHints: {
    configurable: false,
    adult: false
  }
};

const jsonHeaders = {
  "content-type": "application/json; charset=utf-8",
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "*"
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
  const poster = video.poster || `https://drive.google.com/thumbnail?id=${driveId}&sz=w780`;
  const filename = video.filename || title;

  return {
    ...video,
    id,
    driveId,
    title,
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

function toMetaPreview(video) {
  return {
    id: video.id,
    type: "movie",
    name: video.title,
    poster: video.poster,
    posterShape: "poster",
    description: video.description,
    genres: asArray(video.genre),
    releaseInfo: video.released ? String(new Date(video.released).getFullYear()) : undefined
  };
}

function toFullMeta(video) {
  return {
    ...toMetaPreview(video),
    background: video.background || video.poster,
    logo: video.logo,
    videos: []
  };
}

function asArray(value) {
  if (!value) return undefined;
  return Array.isArray(value) ? value : [value];
}

function driveDownloadUrl(driveId) {
  return `https://drive.google.com/uc?export=download&id=${encodeURIComponent(driveId)}`;
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

  const videos = await loadVideos();

  if (url.pathname === `/catalog/movie/${CATALOG_ID}.json`) {
    sendJson(res, { metas: videos.map(toMetaPreview) });
    return;
  }

  const metaMatch = url.pathname.match(/^\/meta\/movie\/(.+)\.json$/);
  if (metaMatch) {
    const video = findVideo(videos, decodeURIComponent(metaMatch[1]));
    sendJson(res, { meta: video ? toFullMeta(video) : null }, video ? 200 : 404);
    return;
  }

  const streamMatch = url.pathname.match(/^\/stream\/movie\/(.+)\.json$/);
  if (streamMatch) {
    const video = findVideo(videos, decodeURIComponent(streamMatch[1]));
    if (!video) {
      sendJson(res, { streams: [] }, 404);
      return;
    }

    sendJson(res, {
      streams: [
        {
          title: video.streamTitle || "Google Drive",
          name: video.title,
          url: streamUrl(req, video),
          behaviorHints: {
            notWebReady: ![".mp4", ".m4v", ".webm"].includes(extname(video.filename).toLowerCase())
          }
        }
      ]
    });
    return;
  }

  const driveMatch = url.pathname.match(/^\/drive\/([^/]+)\/.+$/);
  if (driveMatch) {
    const driveId = decodeURIComponent(driveMatch[1]);
    const filename = decodeURIComponent(url.pathname.split("/").at(-1) || "");
    const type = contentTypeByExtension[extname(filename).toLowerCase()] || "application/octet-stream";

    res.writeHead(302, {
      location: driveDownloadUrl(driveId),
      "content-type": type,
      "access-control-allow-origin": "*"
    });
    res.end();
    return;
  }

  sendJson(res, { error: "Not found" }, 404);
}

function findVideo(videos, id) {
  return videos.find((video) => video.id === id || video.driveId === id);
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
