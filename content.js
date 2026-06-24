(function () {
  "use strict";

  const STORAGE_KEY = "ffgOptions";
  const DEFAULTS = {
    enabled: true,
    autoOpen: true,
    showMeta: false,
    density: "balanced"
  };

  const DENSITY = {
    compact: { gap: "9px", column: "250px" },
    balanced: { gap: "14px", column: "330px" },
    spacious: { gap: "20px", column: "430px" }
  };

  const state = {
    options: { ...DEFAULTS },
    photos: new Map(),
    shell: null,
    grid: null,
    subtitle: null,
    launcher: null,
    wrap: null,
    detailRequests: new Set(),
    renderTimer: 0,
    scanTimer: 0,
    loadTimer: 0
  };

  init();

  async function init() {
    state.options = await loadOptions();
    buildUi();
    scanSoon();
    observePage();

    if (state.options.enabled && state.options.autoOpen && isFeedLikePage()) {
      openGallery();
    }
  }

  function loadOptions() {
    return new Promise((resolve) => {
      if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.sync) {
        resolve({ ...DEFAULTS });
        return;
      }

      chrome.storage.sync.get([STORAGE_KEY], (result) => {
        resolve({ ...DEFAULTS, ...(result[STORAGE_KEY] || {}) });
      });
    });
  }

  function saveOptions() {
    if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.sync) return;
    chrome.storage.sync.set({ [STORAGE_KEY]: state.options });
  }

  function buildUi() {
    state.launcher = document.createElement("button");
    state.launcher.className = "ffg-launcher";
    state.launcher.type = "button";
    state.launcher.textContent = "Open gallery";
    state.launcher.addEventListener("click", openGallery);
    document.documentElement.appendChild(state.launcher);

    state.shell = document.createElement("section");
    state.shell.className = "ffg-shell";
    state.shell.hidden = true;
    state.shell.setAttribute("aria-label", "Flickr Follow Gallery");
    state.shell.innerHTML = `
      <header class="ffg-toolbar">
        <div class="ffg-brand">
          <div class="ffg-mark" aria-hidden="true"></div>
          <div>
            <h1 class="ffg-title">Flickr Follow Gallery</h1>
            <p class="ffg-subtitle">Collecting photos from this feed...</p>
          </div>
        </div>
        <div class="ffg-actions">
          <select class="ffg-select" aria-label="Gallery density">
            <option value="compact">Compact</option>
            <option value="balanced">Balanced</option>
            <option value="spacious">Spacious</option>
          </select>
          <button class="ffg-toggle" type="button" data-action="meta">Metadata</button>
          <button class="ffg-button" type="button" data-action="refresh">Refresh</button>
          <button class="ffg-button" type="button" data-action="close">Close</button>
        </div>
      </header>
      <main class="ffg-gallery-wrap">
        <div class="ffg-grid"></div>
      </main>
    `;

    document.documentElement.appendChild(state.shell);
    state.grid = state.shell.querySelector(".ffg-grid");
    state.wrap = state.shell.querySelector(".ffg-gallery-wrap");
    state.subtitle = state.shell.querySelector(".ffg-subtitle");

    const densitySelect = state.shell.querySelector(".ffg-select");
    densitySelect.value = state.options.density;
    densitySelect.addEventListener("change", () => {
      state.options.density = densitySelect.value;
      applyOptions();
      saveOptions();
    });

    state.shell.querySelector('[data-action="meta"]').addEventListener("click", () => {
      state.options.showMeta = !state.options.showMeta;
      applyOptions();
      saveOptions();
    });

    state.shell.querySelector('[data-action="refresh"]').addEventListener("click", () => {
      scanPage({ reset: true });
      render();
    });

    state.shell.querySelector('[data-action="close"]').addEventListener("click", closeGallery);
    state.wrap.addEventListener("scroll", maybeLoadMore);
    window.addEventListener("keydown", handleKeys, true);
    applyOptions();
  }

  function applyOptions() {
    const density = DENSITY[state.options.density] || DENSITY.balanced;
    state.shell.style.setProperty("--ffg-gap", density.gap);
    state.shell.style.setProperty("--ffg-min-column", density.column);
    state.shell.classList.toggle("ffg-show-meta", Boolean(state.options.showMeta));
    state.shell.querySelector('[data-action="meta"]').dataset.on = String(Boolean(state.options.showMeta));
  }

  function openGallery() {
    state.options.enabled = true;
    saveOptions();
    scanPage({ reset: true });
    render();
    state.shell.hidden = false;
    document.documentElement.classList.add("ffg-active");
    document.body.classList.add("ffg-active");
  }

  function closeGallery() {
    state.shell.hidden = true;
    document.documentElement.classList.remove("ffg-active");
    document.body.classList.remove("ffg-active");
  }

  function handleKeys(event) {
    if (!state.shell || state.shell.hidden) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeGallery();
    }
    if (event.key.toLowerCase() === "m") {
      event.preventDefault();
      state.options.showMeta = !state.options.showMeta;
      applyOptions();
      saveOptions();
    }
  }

  function observePage() {
    const observer = new MutationObserver(scanSoon);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["src", "srcset", "style"]
    });
  }

  function scanSoon() {
    clearTimeout(state.scanTimer);
    state.scanTimer = setTimeout(() => {
      const previous = state.photos.size;
      scanPage();
      if (!state.shell.hidden && state.photos.size !== previous) render();
      updateSubtitle();
    }, 250);
  }

  function scanPage({ reset = false } = {}) {
    if (reset) state.photos.clear();

    getScanRoots().forEach((root) => {
      root.querySelectorAll("img").forEach((img) => {
        if (img.closest(".ffg-shell") || hasBlockedAncestor(img)) return;

        const src = bestImageUrl(img);
        if (!src || !isFlickrPhoto(src) || isLikelyChromeOrAvatar(img, src)) return;

        const photo = extractPhoto(img, src);
        if (!photo) return;
        state.photos.set(photo.key, mergePhoto(state.photos.get(photo.key), photo));
      });
    });
  }

  function getScanRoots() {
    const roots = Array.from(document.querySelectorAll('main, [role="main"]'))
      .filter((root) => root.querySelector('a[href*="/photos/"], a[href*="flickr.com/photos/"] img'));

    return roots.length ? roots : [document.body];
  }

  function hasBlockedAncestor(element) {
    const blockedSelector = [
      "header",
      "nav",
      "aside",
      "footer",
      '[role="banner"]',
      '[role="navigation"]',
      '[role="contentinfo"]',
      '[aria-label*="navigation" i]',
      '[aria-label*="sidebar" i]',
      '[aria-label*="menu" i]'
    ].join(",");

    if (element.closest(blockedSelector)) return true;

    let node = element.parentElement;
    for (let depth = 0; node && node !== document.body && depth < 8; depth += 1) {
      const signature = `${node.id || ""} ${String(node.className || "")} ${node.getAttribute("aria-label") || ""}`.toLowerCase();
      if (/(avatar|buddy|icon|logo|menu|nav|notification|sidebar|side-bar|rail|recommend|suggest|comment|reply|contact-card|person-card|profile-card)/.test(signature)) {
        return true;
      }
      node = node.parentElement;
    }

    return false;
  }

  function mergePhoto(existing, incoming) {
    if (!existing) return incoming;

    return {
      ...existing,
      src: existing.src || incoming.src,
      page: existing.page || incoming.page,
      title: existing.title || incoming.title,
      author: existing.author || incoming.author,
      exif: existing.exif || incoming.exif || "",
      detailsLoaded: existing.detailsLoaded || incoming.detailsLoaded || false
    };
  }

  function bestImageUrl(img) {
    const srcset = img.getAttribute("srcset") || "";
    if (srcset) {
      const candidates = srcset.split(",")
        .map((part) => {
          const bits = part.trim().split(/\s+/);
          const width = bits[1] && bits[1].endsWith("w") ? parseInt(bits[1], 10) : 0;
          return { url: bits[0], width };
        })
        .filter((candidate) => candidate.url)
        .sort((a, b) => b.width - a.width);
      if (candidates[0]) return candidates[0].url;
    }
    return img.currentSrc || img.src || "";
  }

  function isFlickrPhoto(src) {
    return /\/\/[^/]*staticflickr\.com\//i.test(src) || /\/\/live\.staticflickr\.com\//i.test(src);
  }

  function isLikelyChromeOrAvatar(img, src) {
    const width = img.naturalWidth || img.width || 0;
    const height = img.naturalHeight || img.height || 0;
    const alt = (img.alt || "").toLowerCase();
    const className = String(img.className || "").toLowerCase();

    if (width && height && (width < 180 || height < 140)) return true;
    if (/buddy|avatar|icon|logo|sprite|profile/.test(src + " " + alt + " " + className)) return true;
    return false;
  }

  function extractPhoto(img, src) {
    const container = findPhotoContainer(img);
    const anchor = findPhotoPageAnchor(img, container);
    if (!anchor) return null;

    const href = anchor ? resolveHref(anchor.getAttribute("href")) : src;
    const metadata = findMetadata(img, anchor, container, href);
    const largeSrc = upscaleFlickrUrl(src);
    const key = canonicalFlickrImageKey(largeSrc);

    return {
      key,
      src: largeSrc,
      page: href,
      title: metadata.title,
      author: metadata.author
    };
  }

  function findPhotoPageAnchor(img, container) {
    const closest = img.closest("a[href]");
    if (closest && isPhotoPageHref(closest.getAttribute("href"))) return closest;

    if (!container) return null;
    return Array.from(container.querySelectorAll("a[href]")).find((link) => isPhotoPageHref(link.getAttribute("href"))) || null;
  }

  function isPhotoPageHref(href) {
    const value = String(href || "");
    if (!value) return false;

    try {
      const url = new URL(value, location.href);
      if (!/(^|\.)flickr\.com$/i.test(url.hostname)) return false;
      return /^\/photos\/[^/]+\/\d+(?:\/|$)/i.test(url.pathname);
    } catch {
      return /^\/photos\/[^/]+\/\d+(?:\/|$)/i.test(value);
    }
  }

  function canonicalFlickrImageKey(src) {
    try {
      const url = new URL(src, location.href);
      const match = url.pathname.match(/\/([^/]+)\/([^/_]+)_([^_.]+)(?:_[a-z])?\.[a-z0-9]+$/i);
      if (match) return `${match[1]}/${match[2]}_${match[3]}`;
      return `${url.hostname}${url.pathname.replace(/_[a-z](?=\.[a-z0-9]+$)/i, "")}`;
    } catch {
      return src.replace(/_[a-z](?=\.[a-z0-9]+$)/i, "");
    }
  }

  function resolveHref(href) {
    try {
      return new URL(href, location.href).href;
    } catch {
      try {
        return new URL(href, "https://www.flickr.com/").href;
      } catch {
        return href || "";
      }
    }
  }

  function findPhotoContainer(img) {
    let node = img.parentElement;
    for (let depth = 0; node && node !== document.body && depth < 8; depth += 1) {
      const photoLinks = node.querySelectorAll('a[href*="/photos/"], a[href*="flickr.com/photos/"]');
      const text = cleanText(node.textContent);
      if (photoLinks.length > 1 || text.length > 0 || node.matches("article, li")) return node;
      node = node.parentElement;
    }
    return img.closest("article, li, div") || img.parentElement;
  }

  function findNearbyAnchor(card) {
    if (!card) return null;
    return Array.from(card.querySelectorAll("a[href]")).find((link) => isPhotoPageHref(link.getAttribute("href"))) || null;
  }

  function findMetadata(img, anchor, card, href) {
    const titleCandidates = [
      img.alt,
      img.title,
      img.getAttribute("aria-label"),
      img.getAttribute("data-title"),
      anchor && anchor.getAttribute("aria-label"),
      anchor && anchor.getAttribute("title"),
      card && card.getAttribute("aria-label")
    ].map(cleanText).map(stripFlickrChromeText);

    let title = "";
    let author = "";

    for (const candidate of titleCandidates) {
      const split = splitTitleAndAuthor(candidate);
      if (!title && isUsefulTitle(split.title)) title = split.title;
      if (!author && isUsefulAuthor(split.author)) author = split.author;
      if (title && author) break;
    }

    if (!author) author = findAuthor(img, card, href);
    if (!author) author = authorFromPhotoHref(href);

    if (sameText(title, author)) {
      const fallbackAuthor = authorFromPhotoHref(href);
      author = sameText(title, fallbackAuthor) ? "" : fallbackAuthor;
    }

    return { title, author };
  }

  function findAuthor(img, card = findPhotoContainer(img), href = "") {
    if (!card) return "";

    const authorLinks = Array.from(card.querySelectorAll('a[href^="/photos/"], a[href*="flickr.com/photos/"]'))
      .filter((link) => isProfileHref(link.getAttribute("href")));

    const author = authorLinks
      .map((link) => cleanText(link.textContent) || cleanText(link.getAttribute("aria-label")) || cleanText(link.getAttribute("title")))
      .map(stripFlickrChromeText)
      .find(isUsefulAuthor);
    if (author) return author;

    const labeledAuthor = Array.from(card.querySelectorAll("[aria-label], [title]"))
      .map((node) => cleanText(node.getAttribute("aria-label")) || cleanText(node.getAttribute("title")))
      .map(stripFlickrChromeText)
      .map((text) => splitTitleAndAuthor(text).author || text)
      .find(isUsefulAuthor);
    if (labeledAuthor) return labeledAuthor;

    return authorFromPhotoHref(href);
  }

  function isProfileHref(href) {
    const value = String(href || "");
    try {
      const url = new URL(value, location.href);
      if (!/(^|\.)flickr\.com$/i.test(url.hostname)) return false;
      return /^\/photos\/[^/]+\/?$/i.test(url.pathname);
    } catch {
      return /^\/photos\/[^/]+\/?$/i.test(value);
    }
  }

  function authorFromPhotoHref(href) {
    try {
      const url = new URL(href, location.href);
      const match = url.pathname.match(/^\/photos\/([^/]+)\/\d+/i);
      return match ? humanizeSlug(match[1]) : "";
    } catch {
      const match = String(href || "").match(/^\/photos\/([^/]+)\/\d+/i);
      return match ? humanizeSlug(match[1]) : "";
    }
  }

  function humanizeSlug(value) {
    return cleanText(decodeURIComponent(String(value || ""))
      .replace(/[-_]+/g, " ")
      .replace(/\b\w/g, (letter) => letter.toUpperCase()));
  }

  function splitTitleAndAuthor(value) {
    const text = cleanText(value);
    if (!text) return { title: "", author: "" };

    const byMatch = text.match(/^(.*?)(?:\s+-\s+|\s+)(?:by|from)\s+(.+)$/i);
    if (byMatch) {
      return {
        title: stripFlickrChromeText(byMatch[1]),
        author: stripFlickrChromeText(byMatch[2])
      };
    }

    return { title: text, author: "" };
  }

  function isUsefulTitle(text) {
    const value = cleanText(text);
    return Boolean(value && value.length < 140 && !/^(photo|open|view|untitled)$/i.test(value));
  }

  function isUsefulAuthor(text) {
    const value = cleanText(text);
    return Boolean(value && value.length < 80 && !/^(photo|open|view|untitled|flickr)$/i.test(value));
  }

  function sameText(first, second) {
    const normalize = (value) => cleanText(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
    return Boolean(first && second && normalize(first) === normalize(second));
  }

  function cleanText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function stripFlickrChromeText(value) {
    return cleanText(value)
      .replace(/^photo:\s*/i, "")
      .replace(/\s+by\s+.+$/i, "")
      .replace(/^open\s+/i, "");
  }

  function upscaleFlickrUrl(src) {
    try {
      const url = new URL(src, location.href);
      url.search = "";
      url.pathname = url.pathname.replace(/_([mstnzwcbhk])(?=\.[a-z0-9]+$)/i, "_b");
      if (!/_([mstnzwcbhk])\.[a-z0-9]+$/i.test(url.pathname)) {
        url.pathname = url.pathname.replace(/(\.[a-z0-9]+)$/i, "_b$1");
      }
      return url.href;
    } catch {
      return src;
    }
  }

  function render() {
    const fragment = document.createDocumentFragment();
    const photos = Array.from(state.photos.values());

    if (!photos.length) {
      const empty = document.createElement("div");
      empty.className = "ffg-empty";
      empty.textContent = "No feed photos found yet. Open your Flickr following or friends feed, then refresh this gallery.";
      fragment.appendChild(empty);
    } else {
      photos.forEach((photo) => fragment.appendChild(createCard(photo)));
    }

    state.grid.replaceChildren(fragment);
    updateSubtitle();
    schedulePhotoDetails(photos);
  }

  function renderSoon() {
    clearTimeout(state.renderTimer);
    state.renderTimer = setTimeout(() => {
      if (!state.shell.hidden) render();
    }, 120);
  }

  function createCard(photo) {
    const card = document.createElement("figure");
    card.className = "ffg-card";

    const img = document.createElement("img");
    img.loading = "lazy";
    img.decoding = "async";
    img.src = photo.src;
    img.alt = photo.title || "Flickr photo";

    const caption = document.createElement("figcaption");
    caption.className = "ffg-caption";
    caption.innerHTML = `
      <div>
        <div class="ffg-photo-title"></div>
        <div class="ffg-author"></div>
        <div class="ffg-details"></div>
      </div>
      <a class="ffg-open" target="_blank" rel="noreferrer">Open</a>
    `;
    const title = caption.querySelector(".ffg-photo-title");
    const author = caption.querySelector(".ffg-author");
    const details = caption.querySelector(".ffg-details");
    title.textContent = photo.title;
    author.textContent = photo.author;
    details.textContent = photo.exif || "";
    title.hidden = !photo.title;
    author.hidden = !photo.author;
    details.hidden = !photo.exif;
    caption.querySelector(".ffg-open").href = photo.page;

    card.append(img, caption);
    return card;
  }

  function schedulePhotoDetails(photos) {
    photos.slice(0, 80).forEach((photo) => {
      if (!photo.page || photo.detailsLoaded || state.detailRequests.has(photo.key)) return;

      state.detailRequests.add(photo.key);
      fetchPhotoDetails(photo)
        .then((details) => {
          const current = state.photos.get(photo.key);
          if (!current) return;

          current.exif = details.exif || current.exif || "";
          current.detailsLoaded = true;
          renderSoon();
        })
        .catch(() => {
          const current = state.photos.get(photo.key);
          if (current) current.detailsLoaded = true;
        })
        .finally(() => state.detailRequests.delete(photo.key));
    });
  }

  async function fetchPhotoDetails(photo) {
    const url = new URL(photo.page, location.href);
    if (!/(^|\.)flickr\.com$/i.test(url.hostname)) return { exif: "" };

    const urls = [buildMetaUrl(url), url.href].filter(Boolean);
    for (const href of urls) {
      const response = await fetch(href, {
        credentials: "include",
        cache: "force-cache"
      });

      if (!response.ok) continue;

      const html = await response.text();
      const doc = new DOMParser().parseFromString(html, "text/html");
      const exif = extractExifSummary(doc);
      if (exif) return { exif };
    }

    return { exif: "" };
  }

  function buildMetaUrl(url) {
    const match = url.pathname.match(/^(\/photos\/[^/]+\/\d+)(?:\/|$)/i);
    if (!match) return "";

    const metaUrl = new URL(url.href);
    metaUrl.pathname = `${match[1]}/meta/`;
    metaUrl.search = "";
    metaUrl.hash = "";
    return metaUrl.href;
  }

  function extractExifSummary(doc) {
    const structured = extractStructuredExifSummary(doc);
    if (structured) return structured;

    const text = getExifSearchText(doc);
    if (!text) return "";

    const make = findExifValue(text, ["Camera Make", "Make"]);
    const model = findExifValue(text, ["Camera Model", "Model"]);
    const exposure = findExposureValue(text);
    const aperture = findExifValue(text, ["Aperture", "F Number", "F-Number"]);
    const iso = findExifValue(text, ["ISO", "ISO Speed"]);
    const focal = findExifValue(text, ["Focal Length"]);

    const camera = formatCamera(make, model);
    const settings = [
      formatExposure(exposure),
      formatAperture(aperture),
      formatIso(iso),
      formatFocalLength(focal)
    ].filter(Boolean);

    return [camera, ...settings].filter(Boolean).join(" \u00b7 ");
  }

  function extractStructuredExifSummary(doc) {
    const pairs = new Map();
    const addPair = (label, value) => {
      const cleanLabel = cleanText(label).replace(/:$/, "");
      const cleanValue = cleanExifValue(value);
      if (cleanLabel && isPlausibleExifValue(cleanValue)) {
        pairs.set(cleanLabel.toLowerCase(), cleanValue);
      }
    };

    doc.querySelectorAll("tr").forEach((row) => {
      const cells = row.querySelectorAll("th, td");
      if (cells.length >= 2) addPair(cells[0].textContent, cells[1].textContent);
    });

    doc.querySelectorAll("dt").forEach((term) => {
      let value = term.nextElementSibling;
      if (value && value.tagName.toLowerCase() === "dd") addPair(term.textContent, value.textContent);
    });

    doc.querySelectorAll("li, div, p").forEach((node) => {
      const text = cleanText(node.textContent);
      const match = text.match(/^(Camera Make|Camera Model|Make|Model|Exposure Time|Exposure|Shutter Speed|Aperture|F Number|F-Number|ISO Speed|ISO|Focal Length)\s*:?\s+(.+)$/i);
      if (match) addPair(match[1], match[2]);
    });

    if (!pairs.size) return "";

    const get = (...labels) => {
      for (const label of labels) {
        const value = pairs.get(label.toLowerCase());
        if (value) return value;
      }
      return "";
    };

    const camera = formatCamera(get("Camera Make", "Make"), get("Camera Model", "Model"));
    const settings = [
      formatExposure(get("Exposure", "Exposure Time", "Shutter Speed")),
      formatAperture(get("Aperture", "F Number", "F-Number")),
      formatIso(get("ISO", "ISO Speed")),
      formatFocalLength(get("Focal Length"))
    ].filter(Boolean);

    return [camera, ...settings].filter(Boolean).join(" \u00b7 ");
  }

  function findExifValue(text, labels) {
    const stopLabels = [
      "Camera Make",
      "Camera Model",
      "Camera",
      "Make",
      "Model",
      "Lens",
      "Exposure Time",
      "Exposure",
      "Shutter Speed",
      "Aperture",
      "F Number",
      "F-Number",
      "ISO Speed",
      "ISO",
      "Focal Length",
      "Flash",
      "Date Taken",
      "Software"
    ];

    for (const label of labels) {
      const escaped = escapeRegExp(label);
      const stops = stopLabels
        .filter((stop) => stop !== label)
        .map(escapeRegExp)
        .join("|");
      const pattern = new RegExp(`\\b${escaped}\\b\\s*:?\\s*(.+?)(?=\\s+(?:${stops})\\b|$)`, "i");
      const match = text.match(pattern);
      if (match) {
        const value = cleanExifValue(match[1]);
        if (isPlausibleExifValue(value)) return value;
      }
    }

    return "";
  }

  function getExifSearchText(doc) {
    if (!doc.body) return "";

    const clone = doc.body.cloneNode(true);
    clone.querySelectorAll("script, style, template, noscript, svg").forEach((node) => node.remove());
    return cleanText(clone.textContent);
  }

  function findExposureValue(text) {
    const match = text.match(/\b(?:Exposure Time|Exposure|Shutter Speed)\b\s*:?\s*(\d+\/\d+|\d+(?:\.\d+)?\s*(?:sec|second|seconds|s)?)/i);
    const value = match ? cleanExifValue(match[1]) : findExifValue(text, ["Exposure", "Exposure Time", "Shutter Speed"]);
    return isPlausibleExifValue(value) ? value : "";
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function cleanExifValue(value) {
    return cleanText(value)
      .replace(/^[:-]+/, "")
      .replace(/^["']|["']$/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80);
  }

  function isPlausibleExifValue(value) {
    const text = cleanExifValue(value);
    if (!text || text.length > 80) return false;
    if (/[{}[\]",]/.test(text)) return false;
    if (/\b(?:true|false|null|undefined)\b/i.test(text)) return false;
    if (/\b(?:enable|disable|debug|debugging|eviction|bots|serv|seo|feature|experiment|flag)\b/i.test(text)) return false;
    if (/^[a-z0-9-]+:[a-z0-9-]+/i.test(text)) return false;
    return true;
  }

  function formatCamera(make, model) {
    const cleanMake = cleanExifValue(make);
    const cleanModel = cleanExifValue(model);
    if (!isCameraText(cleanMake) && !isCameraText(cleanModel)) return "";
    if (!cleanMake) return cleanModel;
    if (!cleanModel || cleanModel.toLowerCase().startsWith(cleanMake.toLowerCase())) return cleanModel || cleanMake;
    return `${cleanMake} ${cleanModel}`;
  }

  function isCameraText(value) {
    const text = cleanExifValue(value);
    if (!isPlausibleExifValue(text)) return false;
    if (!/[a-z]/i.test(text)) return false;
    return !/\b(?:settings|privacy|cookie|account|login|upload|download|photos|albums)\b/i.test(text);
  }

  function formatExposure(value) {
    const text = cleanExifValue(value).replace(/\s*sec(?:ond)?s?\.?$/i, "s");
    const fraction = text.match(/\b\d+\/\d+/);
    if (fraction) return fraction[0];

    const seconds = text.match(/\b\d+(?:\.\d+)?\s*s\b/i);
    return seconds ? seconds[0].replace(/\s+/g, "") : "";
  }

  function formatAperture(value) {
    const text = cleanExifValue(value);
    const match = text.match(/(?:f\/?)\s*(\d+(?:\.\d+)?)/i) || text.match(/\b(\d+(?:\.\d+)?)\b/);
    return match ? `f/${match[1]}` : "";
  }

  function formatIso(value) {
    const text = cleanExifValue(value);
    const match = text.match(/\b(\d{2,6})\b/);
    return match ? `ISO ${match[1]}` : "";
  }

  function formatFocalLength(value) {
    const text = cleanExifValue(value);
    const match = text.match(/\b(\d+(?:\.\d+)?)\s*mm\b/i);
    return match ? `${match[1]}mm` : "";
  }

  function updateSubtitle() {
    if (!state.subtitle) return;
    const count = state.photos.size;
    state.subtitle.textContent = count === 1 ? "1 photo found on this page" : `${count} photos found on this page`;
  }

  function maybeLoadMore() {
    if (state.loadTimer) return;
    const remaining = state.wrap.scrollHeight - state.wrap.scrollTop - state.wrap.clientHeight;
    if (remaining > 900) return;

    state.loadTimer = setTimeout(() => {
      state.loadTimer = 0;
      window.scrollBy({ top: Math.max(window.innerHeight * 0.9, 700), behavior: "smooth" });
      scanSoon();
    }, 450);
  }

  function isFeedLikePage() {
    return /\/photos\/friends|\/activity|\/groups|\/explore/i.test(location.pathname);
  }
})();
