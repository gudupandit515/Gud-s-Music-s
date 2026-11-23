/* Gud'S Music — music player front-end.
   Catalogue + audio streams come from /api/search and /api/home. */

const $ = (id) => document.getElementById(id);

const audio = $("audio");
const seek = $("seek");
const npSeek = $("npSeek");
const volume = $("volume");
const sheet = $("sheet");
const toastEl = $("toast");

const state = {
  queue: [],
  index: -1,
  shuffle: false,
  repeat: "off", // off | all | one
  muted: false,
  view: "home",
};

let homeSections = [];
let searchItems = [];
let searchSeq = 0;
let searchTimer = null;
let toastTimer = null;

const PLAY_ICON =
  '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8.2 5.7v12.6c0 .9 1 1.4 1.7.9l9-6.3a1.1 1.1 0 0 0 0-1.8l-9-6.3c-.7-.5-1.7 0-1.7.9z"/></svg>';

const CHIPS = [
  "Arijit Singh",
  "Lata Mangeshkar",
  "Kishore Kumar",
  "Kesariya",
  "Punjabi hits",
  "Lo-fi",
  "90s Bollywood",
  "Party songs",
];

/* The catalogue API sends CORS headers, so the app works two ways:
   1. with server.py (local / any host that runs Python) through /api/*,
   2. as plain static files (GitHub Pages) by calling the API directly. */
const UPSTREAM = "https://saavn.sumit.co/api";
const HOME_SECTIONS = [
  { id: "fresh", title: "Fresh releases", subtitle: "New Hindi songs everyone is playing", query: "latest hindi hits" },
  { id: "romance", title: "Bollywood romance", subtitle: "Soft, slow and full of feeling", query: "romantic hindi songs" },
  { id: "arijit", title: "Arijit Singh", subtitle: "The voice of a generation", query: "arijit singh hits" },
  { id: "classics", title: "90s classics", subtitle: "Timeless Hindi melodies", query: "90s hindi songs" },
  { id: "punjabi", title: "Punjabi heat", subtitle: "Bhangra and beyond", query: "punjabi hits" },
  { id: "lofi", title: "Lo-fi & chill", subtitle: "Late night, low volume", query: "lofi hindi songs" },
];

// Static hosts (GitHub Pages, file://) have no /api backend, so call the catalogue directly.
let hasBackend = location.protocol.startsWith("http") && !location.hostname.endsWith("github.io");

/* ------------------------------------------------------------ utilities ---- */
function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[ch]));
}

function fmt(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  if (mins >= 60) {
    const hours = Math.floor(mins / 60);
    return `${hours}:${String(mins % 60).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

function toast(message) {
  toastEl.textContent = message;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, 3600);
}

function current() {
  return state.queue[state.index] || null;
}

function setRangeFill(input, percent) {
  input.style.setProperty("--p", `${Math.max(0, Math.min(100, percent))}%`);
}

/* ------------------------------------------------- catalogue (dual mode) ---- */
function cleanText(value) {
  const node = document.createElement("textarea");
  node.innerHTML = String(value ?? "");
  return node.value.replace(/\s+/g, " ").trim();
}

function normalizeSong(entry) {
  const images = Array.isArray(entry.image) ? entry.image : [];
  const art = (images.find((image) => image.quality === "500x500") || images[images.length - 1] || {}).url || "";

  const downloads = Array.isArray(entry.downloadUrl) ? entry.downloadUrl : [];
  const best = downloads
    .slice()
    .sort((a, b) => parseInt(String(b.quality).replace(/\D/g, ""), 10) - parseInt(String(a.quality).replace(/\D/g, ""), 10))[0] || {};

  const primary = (entry.artists && entry.artists.primary) || [];
  const names = [];
  for (const artist of primary) {
    const name = cleanText(artist && artist.name);
    if (name && !names.includes(name)) names.push(name);
  }

  return {
    id: entry.id || "",
    title: cleanText(entry.name),
    artist: names.slice(0, 3).join(", ") || "Unknown artist",
    album: cleanText(entry.album && entry.album.name),
    year: String(entry.year || ""),
    duration: Number(entry.duration) || 0,
    art,
    url: best.url || "",
    page: entry.url || "",
    language: cleanText(entry.language),
  };
}

async function fetchSongs(query, limit = 30) {
  if (hasBackend) {
    try {
      const response = await fetch(
        `/api/search?q=${encodeURIComponent(query)}&limit=${limit}`,
        { headers: { Accept: "application/json" } }
      );
      if (response.ok) {
        const body = await response.json();
        if (Array.isArray(body.items)) return body.items;
      } else {
        hasBackend = false;
      }
    } catch (error) {
      hasBackend = false;
    }
  }

  const url = `${UPSTREAM}/search/songs?query=${encodeURIComponent(query)}&limit=${limit}`;
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error("The catalogue is unreachable right now.");
  const body = await response.json();
  const results = (body.data && body.data.results) || [];
  return results.map(normalizeSong).filter((song) => song.url && song.title);
}

async function fetchHomeSections() {
  if (hasBackend) {
    try {
      const response = await fetch("/api/home", { headers: { Accept: "application/json" } });
      if (response.ok) {
        const body = await response.json();
        if (Array.isArray(body.sections) && body.sections.length) return body.sections;
      } else {
        hasBackend = false;
      }
    } catch (error) {
      hasBackend = false;
    }
  }

  const sections = await Promise.all(
    HOME_SECTIONS.map(async (section) => {
      try {
        return { ...section, items: await fetchSongs(section.query, 12) };
      } catch (error) {
        return { ...section, items: [] };
      }
    })
  );
  return sections.filter((section) => section.items.length);
}

/* --------------------------------------------------------------- playing ---- */
function playList(list, start) {
  if (!Array.isArray(list) || !list.length) return;
  state.queue = list.slice();
  state.index = Math.max(0, Math.min(start, list.length - 1));
  loadCurrent(true);
  renderQueue();
  markActive();
}

function loadCurrent(autoplay) {
  const track = current();
  if (!track) return;

  audio.src = track.url;
  audio.load();

  if (autoplay) {
    const attempt = audio.play();
    if (attempt && typeof attempt.catch === "function") {
      attempt.catch(() => toast("Playback didn't start. Tap play to try again."));
    }
  }

  syncNow();
  markActive();
}

function togglePlay() {
  if (!current()) {
    const first = homeSections[0] && homeSections[0].items[0];
    if (first) playList(homeSections[0].items, 0);
    return;
  }
  if (audio.paused) {
    audio.play().catch(() => toast("Playback didn't start. Try another song."));
  } else {
    audio.pause();
  }
}

function step(direction, auto = false) {
  if (!state.queue.length) return;

  if (state.shuffle && state.queue.length > 1) {
    let next = state.index;
    while (next === state.index) next = Math.floor(Math.random() * state.queue.length);
    state.index = next;
  } else {
    let next = state.index + direction;
    if (next >= state.queue.length) {
      if (auto && state.repeat !== "all") {
        audio.pause();
        audio.currentTime = 0;
        syncNow();
        return;
      }
      next = 0;
    }
    if (next < 0) next = state.queue.length - 1;
    state.index = next;
  }

  loadCurrent(true);
  renderQueue();
}

function seekToFraction(fraction) {
  if (!Number.isFinite(audio.duration) || audio.duration <= 0) return;
  audio.currentTime = Math.max(0, Math.min(1, fraction)) * audio.duration;
}

/* ------------------------------------------------------------- rendering ---- */
function cardHTML(sectionId, track, i) {
  return `<button class="card" type="button" data-section="${esc(sectionId)}" data-i="${i}" data-id="${esc(track.id)}">
    <span class="card-art">
      ${track.art ? `<img src="${esc(track.art)}" alt="" loading="lazy" />` : ""}
      <span class="card-play" aria-hidden="true">${PLAY_ICON}</span>
    </span>
    <span class="card-title">${esc(track.title)}</span>
    <span class="card-sub">${esc(track.artist)}</span>
  </button>`;
}

function rowHTML(track, i) {
  const meta = [track.artist, track.album, track.year].filter(Boolean).join(" · ");
  return `<li class="row" data-id="${esc(track.id)}">
    <button class="row-main" type="button" data-i="${i}">
      <span class="row-art">
        ${track.art ? `<img src="${esc(track.art)}" alt="" loading="lazy" />` : "<span aria-hidden=\"true\">♪</span>"}
        <span class="row-hover" aria-hidden="true">${PLAY_ICON}</span>
      </span>
      <span class="row-text">
        <span class="row-title">${esc(track.title)}</span>
        <span class="row-sub">${esc(meta)}</span>
      </span>
      <span class="row-dur">${track.duration ? fmt(track.duration) : ""}</span>
    </button>
  </li>`;
}

function renderHome() {
  const wrap = $("homeSections");
  if (!homeSections.length) {
    wrap.innerHTML = '<p class="loading">No songs loaded. Check your connection and reload.</p>';
    return;
  }
  wrap.innerHTML = homeSections.map((section) => `
    <section class="section" data-section="${esc(section.id)}">
      <div class="section-head">
        <div>
          <h2>${esc(section.title)}</h2>
          <p>${esc(section.subtitle)}</p>
        </div>
      </div>
      <div class="cards" role="list">
        ${section.items.map((track, i) => cardHTML(section.id, track, i)).join("")}
      </div>
    </section>`).join("");
  markActive();
}

function renderQueue() {
  const list = $("queueList");
  const active = current();

  $("navCount").textContent = String(state.queue.length);
  $("queueSub").textContent = state.queue.length
    ? `${state.queue.length} song${state.queue.length === 1 ? "" : "s"}${active ? ` · playing ${state.index + 1}` : ""}`
    : "Nothing queued yet — pick a song anywhere.";

  list.innerHTML = state.queue
    .map((track, i) => {
      const isActive = active && track.id === active.id;
      const meta = [track.artist, track.album].filter(Boolean).join(" · ");
      return `<li class="row${isActive ? " active" : ""}" data-id="${esc(track.id)}">
        <button class="row-main" type="button" data-i="${i}">
          <span class="row-art">
            ${track.art ? `<img src="${esc(track.art)}" alt="" loading="lazy" />` : "<span aria-hidden=\"true\">♪</span>"}
            <span class="row-hover" aria-hidden="true">${PLAY_ICON}</span>
          </span>
          <span class="row-text">
            <span class="row-title">${esc(track.title)}</span>
            <span class="row-sub">${esc(meta)}</span>
          </span>
          <span class="row-dur">${track.duration ? fmt(track.duration) : ""}</span>
        </button>
      </li>`;
    })
    .join("");

  markActive();
}

function markActive() {
  const active = current();
  document.querySelectorAll("[data-id]").forEach((node) => {
    node.classList.toggle("active", Boolean(active) && node.dataset.id === active.id);
  });
}

function syncNow() {
  const track = current();
  const hasArt = Boolean(track && track.art);

  for (const imgId of ["pArt", "npArt"]) {
    const img = $(imgId);
    img.hidden = !hasArt;
    if (hasArt) img.src = track.art;
    else img.removeAttribute("src");
  }

  $("pTitle").textContent = track ? track.title : "Nothing playing";
  $("pArtist").textContent = track ? track.artist : "Pick a song to start";
  $("npTitle").textContent = track ? track.title : "Nothing playing";
  $("npArtist").textContent = track
    ? [track.artist, track.album, track.year].filter(Boolean).join(" · ")
    : "Pick a song to start";

  if (track) {
    const link = $("npLink");
    link.href = track.page || "https://www.jiosaavn.com/";
    $("npSource").textContent = track.language
      ? `Streaming · ${track.language.charAt(0).toUpperCase()}${track.language.slice(1)}`
      : "Streaming from JioSaavn";
  }

  document.title = track ? `${track.title} — Gud'S Music` : "Gud'S Music";
  updateProgress();
  renderQueue();
}

/* -------------------------------------------------------------- progress ---- */
function updateProgress() {
  const duration = Number.isFinite(audio.duration) && audio.duration > 0
    ? audio.duration
    : (current() ? current().duration : 0);
  const position = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
  const percent = duration ? (position / duration) * 100 : 0;

  $("curTime").textContent = fmt(position);
  $("durTime").textContent = fmt(duration);
  $("npCur").textContent = fmt(position);
  $("npDur").textContent = fmt(duration);

  if (document.activeElement !== seek) seek.value = String(Math.round(percent * 10));
  if (document.activeElement !== npSeek) npSeek.value = String(Math.round(percent * 10));
  setRangeFill(seek, percent);
  setRangeFill(npSeek, percent);
}

function setPlayingUI(playing) {
  document.body.classList.toggle("playing", playing);
  $("playBtn").setAttribute("aria-label", playing ? "Pause" : "Play");
  $("npPlay").setAttribute("aria-label", playing ? "Pause" : "Play");
}

function setToggle(button, on) {
  button.setAttribute("aria-pressed", on ? "true" : "false");
}

/* ---------------------------------------------------------------- search ---- */
function setStatus(text, isError = false) {
  const el = $("searchStatus");
  el.textContent = text;
  el.classList.toggle("error", Boolean(isError));
}

async function runSearch(query) {
  const q = query.trim();
  $("searchClear").hidden = !q;

  if (!q) {
    searchItems = [];
    $("searchResults").innerHTML = "";
    setStatus("");
    return;
  }

  const seq = ++searchSeq;
  setStatus("Searching…");

  try {
    const items = await fetchSongs(q, 30);
    if (seq !== searchSeq) return;
    searchItems = items;
    $("searchResults").innerHTML = searchItems.map((track, i) => rowHTML(track, i)).join("");
    setStatus(searchItems.length ? `${searchItems.length} songs` : `No songs found for “${q}”.`);
    markActive();
  } catch (error) {
    if (seq !== searchSeq) return;
    searchItems = [];
    $("searchResults").innerHTML = "";
    setStatus(error.message || "Search failed. Try again.", true);
  }
}

/* ------------------------------------------------------------------ views ---- */
function setView(name) {
  state.view = name;
  document.querySelectorAll(".view").forEach((view) => {
    view.hidden = view.id !== `view-${name}`;
  });
  document.querySelectorAll("[data-nav]").forEach((node) => {
    if (node.classList.contains("nav-item")) {
      node.setAttribute("aria-current", node.dataset.nav === name ? "page" : "false");
    }
  });

  const copy = {
    home: ["Listen now", "Full songs, straight from the web."],
    search: ["Search", "Any song in the catalogue — old or new."],
    queue: ["Queue", "What plays next."],
  }[name];
  if (copy) {
    $("pageTitle").textContent = copy[0];
    $("pageSub").textContent = copy[1];
  }

  window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
  if (name === "search") setTimeout(() => $("searchInput").focus(), 60);
}

function openSheet() {
  sheet.hidden = false;
  $("sheetClose").focus({ preventScroll: true });
}

function closeSheet() {
  sheet.hidden = true;
  $("npOpen").focus({ preventScroll: true });
}

/* ------------------------------------------------------------------- init ---- */
async function loadHome() {
  try {
    homeSections = await fetchHomeSections();
  } catch (error) {
    homeSections = [];
  }
  renderHome();
}

function bind() {
  document.querySelectorAll("[data-nav]").forEach((node) => {
    node.addEventListener("click", (event) => {
      event.preventDefault();
      setView(node.dataset.nav);
    });
  });

  $("homeSections").addEventListener("click", (event) => {
    const card = event.target.closest(".card");
    if (!card) return;
    const section = homeSections.find((item) => item.id === card.dataset.section);
    if (!section) return;
    playList(section.items, Number(card.dataset.i));
  });

  $("searchResults").addEventListener("click", (event) => {
    const row = event.target.closest(".row-main");
    if (!row) return;
    playList(searchItems, Number(row.dataset.i));
  });

  $("queueList").addEventListener("click", (event) => {
    const row = event.target.closest(".row-main");
    if (!row) return;
    state.index = Number(row.dataset.i);
    loadCurrent(true);
    renderQueue();
  });

  $("queueClear").addEventListener("click", () => {
    state.queue = [];
    state.index = -1;
    audio.pause();
    audio.removeAttribute("src");
    syncNow();
    renderQueue();
  });

  $("playBtn").addEventListener("click", togglePlay);
  $("npPlay").addEventListener("click", togglePlay);
  $("prevBtn").addEventListener("click", () => step(-1));
  $("npPrev").addEventListener("click", () => step(-1));
  $("nextBtn").addEventListener("click", () => step(1));
  $("npNext").addEventListener("click", () => step(1));

  const shuffleToggle = () => {
    state.shuffle = !state.shuffle;
    setToggle($("shuffleBtn"), state.shuffle);
    setToggle($("npShuffle"), state.shuffle);
  };
  $("shuffleBtn").addEventListener("click", shuffleToggle);
  $("npShuffle").addEventListener("click", shuffleToggle);

  const repeatToggle = () => {
    state.repeat = state.repeat === "off" ? "all" : state.repeat === "all" ? "one" : "off";
    const on = state.repeat !== "off";
    for (const id of ["repeatBtn", "npRepeat"]) {
      const button = $(id);
      setToggle(button, on);
      button.setAttribute(
        "aria-label",
        state.repeat === "one" ? "Repeat one" : state.repeat === "all" ? "Repeat all" : "Repeat off"
      );
    }
    $("repeatOne").hidden = state.repeat !== "one";
    $("npRepeatOne").hidden = state.repeat !== "one";
  };
  $("repeatBtn").addEventListener("click", repeatToggle);
  $("npRepeat").addEventListener("click", repeatToggle);

  for (const input of [seek, npSeek]) {
    input.addEventListener("input", () => {
      seekToFraction(Number(input.value) / 1000);
      updateProgress();
    });
  }

  volume.addEventListener("input", () => {
    const value = Number(volume.value);
    audio.volume = value / 100;
    audio.muted = value === 0;
    state.muted = audio.muted;
    setToggle($("muteBtn"), audio.muted);
    setRangeFill(volume, value);
  });

  $("muteBtn").addEventListener("click", () => {
    audio.muted = !audio.muted;
    setToggle($("muteBtn"), audio.muted);
  });

  $("npOpen").addEventListener("click", openSheet);
  $("expandBtn").addEventListener("click", openSheet);
  $("pArtBtn").addEventListener("click", openSheet);
  $("sheetClose").addEventListener("click", closeSheet);
  sheet.addEventListener("click", (event) => {
    if (event.target === sheet) closeSheet();
  });

  const input = $("searchInput");
  input.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => runSearch(input.value), 350);
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      clearTimeout(searchTimer);
      runSearch(input.value);
    }
  });
  $("searchClear").addEventListener("click", () => {
    input.value = "";
    clearTimeout(searchTimer);
    runSearch("");
    input.focus();
  });

  $("searchChips").innerHTML = CHIPS.map(
    (chip) => `<button class="chip" type="button">${esc(chip)}</button>`
  ).join("");
  $("searchChips").addEventListener("click", (event) => {
    const chip = event.target.closest(".chip");
    if (!chip) return;
    input.value = chip.textContent;
    runSearch(chip.textContent);
  });

  audio.addEventListener("timeupdate", updateProgress);
  audio.addEventListener("durationchange", updateProgress);
  audio.addEventListener("play", () => { setPlayingUI(true); renderQueue(); });
  audio.addEventListener("pause", () => { setPlayingUI(false); renderQueue(); });
  audio.addEventListener("ended", () => {
    if (state.repeat === "one") {
      audio.currentTime = 0;
      audio.play().catch(() => toast("Playback didn't restart."));
      return;
    }
    step(1, true);
  });
  audio.addEventListener("error", () => {
    if (audio.getAttribute("src")) toast("This song won't play. Trying the next result.");
  });

  document.addEventListener("keydown", (event) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
    if (event.key === "Escape" && !sheet.hidden) {
      closeSheet();
      return;
    }
    if (typing) return;
    if (event.code === "Space") {
      event.preventDefault();
      togglePlay();
    } else if (event.key === "ArrowRight") {
      audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 5);
    } else if (event.key === "ArrowLeft") {
      audio.currentTime = Math.max(0, audio.currentTime - 5);
    } else if (event.key === "ArrowUp") {
      volume.value = String(Math.min(100, Number(volume.value) + 5));
      volume.dispatchEvent(new Event("input"));
    } else if (event.key === "ArrowDown") {
      volume.value = String(Math.max(0, Number(volume.value) - 5));
      volume.dispatchEvent(new Event("input"));
    } else if (event.key === "/") {
      event.preventDefault();
      setView("search");
    }
  });
}

function init() {
  audio.volume = Number(volume.value) / 100;
  setRangeFill(volume, Number(volume.value));
  setRangeFill(seek, 0);
  setRangeFill(npSeek, 0);
  bind();
  setView("home");
  renderQueue();
  syncNow();
  loadHome();
}

init();
