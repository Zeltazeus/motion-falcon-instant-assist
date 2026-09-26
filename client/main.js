import { PipecatClient, RTVIEvent } from "@pipecat-ai/client-js";
import { SmallWebRTCTransport } from "@pipecat-ai/small-webrtc-transport";
import { getYouTubeVideoId, normalizePortfolioManifest, normalizePortfolioSection } from "./portfolio.js";

const LOCAL_BOT_URL = "http://localhost:7860/api/offer";
const CLOUD_API_URL = import.meta.env.VITE_PCC_API_URL || "https://api.pipecat.daily.co/v1/public";
const CLOUD_AGENT_NAME = import.meta.env.VITE_PCC_AGENT_NAME || "pipecat-quickstart";
const CLOUD_PUBLIC_KEY = import.meta.env.VITE_PCC_PUBLIC_KEY;
const connectButton = document.getElementById("connect");
const studioBoard = document.querySelector(".studio-board");
const signalCanvas = document.getElementById("signal-field");
const liveNotesList = document.getElementById("live-notes-list");
const status = document.getElementById("status");
const botAudio = document.getElementById("bot-audio");
const sessionLabel = document.getElementById("session-label");
const themeToggle = document.getElementById("theme-toggle");
const themeIcon = themeToggle.querySelector(".theme-icon");
const leadCaptureDialog = document.getElementById("lead-capture-dialog");
const schedulingDialog = document.getElementById("scheduling-dialog");
const portfolioDialog = document.getElementById("portfolio-dialog");
const portfolioTabs = [...document.querySelectorAll("[data-portfolio-section]")];
const portfolioPanels = {
  "current-work": document.getElementById("portfolio-panel-current-work"),
  images: document.getElementById("portfolio-panel-images"),
  videos: document.getElementById("portfolio-panel-videos"),
};
const leadCaptureForm = document.getElementById("lead-capture-form");
const leadCaptureStatus = document.getElementById("lead-capture-status");
const meetingScheduledState = document.getElementById("meeting-scheduled-state");
const meetingScheduledIndicator = document.getElementById("meeting-scheduled-indicator");
const calendlyEmbed = document.getElementById("calendly-embed");
const calendlyFallback = document.getElementById("calendly-fallback");
const schedulingStatus = document.getElementById("scheduling-status");
const openLeadCaptureButton = document.getElementById("open-lead-capture");

let client;

let orbState = "idle";
let dialogTrigger;
let portfolioDialogTrigger;
let portfolioSection = "current-work";
let portfolioManifest;
let portfolioManifestPromise;
let portfolioLoadState = "idle";
const portfolioIndexes = { "current-work": 0, images: 0 };
let calendlyWidgetPromise;
let signalIntensity = 0.32;
let redrawSignalField = () => {};

function renderLiveNotes(payload) {
  if (!liveNotesList) return;

  const notes = (Array.isArray(payload?.notes) ? payload.notes : [])
    .filter((note) => typeof note === "string")
    .map((note) => note.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 4);
  const rows = notes.length ? notes : ["Listening for conversation details..."];
  const items = rows.map((note) => {
    const item = document.createElement("li");
    item.textContent = note;
    item.title = note;
    return item;
  });

  if (!notes.length) items[0].classList.add("is-placeholder");
  liveNotesList.replaceChildren(...items);
}

function setupSignalField() {
  const context = signalCanvas?.getContext("2d");
  if (!studioBoard || !signalCanvas || !context) return;

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const palette = [
    { line: "rgba(255, 177, 96, 0.46)", fill: "rgba(255, 151, 82, 0.055)" },
    { line: "rgba(255, 111, 112, 0.38)", fill: "rgba(255, 111, 112, 0.045)" },
    { line: "rgba(48, 221, 242, 0.42)", fill: "rgba(32, 207, 238, 0.045)" },
    { line: "rgba(238, 83, 210, 0.40)", fill: "rgba(238, 83, 210, 0.045)" },
    { line: "rgba(164, 132, 255, 0.35)", fill: "rgba(164, 132, 255, 0.04)" },
  ];
  const offsets = [-42, -21, 0, 21, 42];
  let width = 0;
  let height = 0;
  let focusX = 0;
  let focusY = 0;
  let frameId;

  function envelopeAt(x) {
    const distance = (x - focusX) / Math.max(width * 0.34, 1);
    return 0.16 + 0.84 * Math.exp(-distance * distance);
  }

  function waveY(x, index, phase) {
    const envelope = envelopeAt(x);
    const progress = x / Math.max(width, 1);
    const amplitude = (13 + 8 * Math.sin(progress * Math.PI)) * envelope;
    const ripple = Math.sin(progress * Math.PI * 12 + phase + index * 0.78)
      + 0.2 * Math.sin(progress * Math.PI * 25 - phase * 0.62 + index);
    return focusY + offsets[index] * envelope + ripple * amplitude;
  }

  function draw(timestamp = 0) {
    context.clearRect(0, 0, width, height);
    if (!width || !height) return;

    const phase = reducedMotion.matches ? 0 : timestamp * (0.00008 + signalIntensity * 0.00018);
    const glow = context.createRadialGradient(focusX, focusY, 0, focusX, focusY, Math.max(width * 0.48, 1));
    glow.addColorStop(0, "rgba(255, 142, 103, 0.12)");
    glow.addColorStop(0.42, "rgba(32, 178, 219, 0.045)");
    glow.addColorStop(1, "rgba(32, 178, 219, 0)");
    context.fillStyle = glow;
    context.fillRect(0, 0, width, height);

    const step = Math.max(3, width / 440);
    palette.forEach((color, index) => {
      const thickness = 3 + index % 2;
      context.beginPath();
      for (let x = 0; x <= width; x += step) {
        const y = waveY(x, index, phase);
        if (x === 0) context.moveTo(x, y - thickness);
        else context.lineTo(x, y - thickness);
      }
      for (let x = width; x >= 0; x -= step) {
        context.lineTo(x, waveY(x, index, phase) + thickness);
      }
      context.closePath();
      context.globalAlpha = 0.55 + signalIntensity * 0.3;
      context.fillStyle = color.fill;
      context.fill();
      context.globalAlpha = 0.72;
      context.strokeStyle = color.line;
      context.lineWidth = 1;
      context.stroke();
    });

    const tickStep = Math.max(13, Math.min(22, width / 62));
    for (let x = 0, index = 0; x <= width; x += tickStep, index += 1) {
      const envelope = envelopeAt(x);
      const center = waveY(x, 2, phase);
      const tickHeight = 3 + envelope * (5 + signalIntensity * 13);
      context.globalAlpha = 0.12 + envelope * (0.12 + signalIntensity * 0.2);
      context.strokeStyle = palette[index % palette.length].line;
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(x, center - tickHeight);
      context.lineTo(x, center + tickHeight);
      context.stroke();
    }

    for (let index = 0; index < 5; index += 1) {
      const progress = (timestamp * (0.000018 + signalIntensity * 0.00003) + index * 0.23) % 1;
      const x = progress * width;
      const envelope = envelopeAt(x);
      context.globalAlpha = 0.3 + envelope * 0.65;
      context.fillStyle = palette[index].line;
      context.shadowColor = palette[index].line;
      context.shadowBlur = 8 + signalIntensity * 8;
      context.beginPath();
      context.arc(x, waveY(x, index, phase), 1.5 + signalIntensity, 0, Math.PI * 2);
      context.fill();
    }
    context.globalAlpha = 1;
    context.shadowBlur = 0;
  }

  function animate(timestamp) {
    frameId = undefined;
    if (document.hidden || reducedMotion.matches) return;
    draw(timestamp);
    frameId = window.requestAnimationFrame(animate);
  }

  function updateMotion() {
    if (document.hidden || reducedMotion.matches) {
      if (frameId !== undefined) window.cancelAnimationFrame(frameId);
      frameId = undefined;
      draw(0);
    } else if (frameId === undefined) {
      frameId = window.requestAnimationFrame(animate);
    }
  }

  function resize() {
    const boardRect = studioBoard.getBoundingClientRect();
    width = boardRect.width;
    height = boardRect.height;
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5, 2200 / Math.max(width, 1), 1400 / Math.max(height, 1));
    signalCanvas.width = Math.round(width * pixelRatio);
    signalCanvas.height = Math.round(height * pixelRatio);
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    const orbRect = document.querySelector(".orb-wrap")?.getBoundingClientRect();
    focusX = orbRect ? orbRect.left + orbRect.width / 2 - boardRect.left : width / 2;
    focusY = orbRect ? orbRect.top + orbRect.height / 2 - boardRect.top : height / 2;
    draw(0);
    updateMotion();
  }

  redrawSignalField = () => draw(reducedMotion.matches ? 0 : performance.now());
  document.addEventListener("visibilitychange", updateMotion);
  reducedMotion.addEventListener("change", updateMotion);
  if ("ResizeObserver" in window) new ResizeObserver(resize).observe(studioBoard);
  else window.addEventListener("resize", resize);
  resize();
}

function openDialog(dialog, trigger) {
  dialogTrigger = trigger || document.activeElement;
  if (!dialog.open) dialog.showModal();
}

function closeDialog(dialog) {
  if (dialog.open) dialog.close();
  dialogTrigger?.focus();
}

function setPortfolioStatus(panel, message, retry = false) {
  panel.replaceChildren();
  const statusMessage = document.createElement("p");
  statusMessage.className = "portfolio-state";
  statusMessage.setAttribute("role", "status");
  statusMessage.setAttribute("aria-live", "polite");
  statusMessage.textContent = message;
  panel.append(statusMessage);

  if (retry) {
    const retryButton = document.createElement("button");
    retryButton.className = "portfolio-retry";
    retryButton.type = "button";
    retryButton.textContent = "Try again";
    retryButton.addEventListener("click", async () => {
      try {
        await loadPortfolioManifest(true);
      } catch {
        // The error state is rendered after the failed request.
      }
      renderPortfolioSection();
    });
    panel.append(retryButton);
  }
}

function renderPortfolioCarousel(section) {
  const panel = portfolioPanels[section];
  const items = portfolioManifest[section === "current-work" ? "currentWork" : "images"];
  if (!items.length) {
    setPortfolioStatus(
      panel,
      section === "current-work"
        ? "There is no current work published yet. Please check back soon."
        : "There are no images published yet. Please check back soon.",
    );
    return;
  }

  const index = portfolioIndexes[section] % items.length;
  const item = items[index];
  const figure = document.createElement("figure");
  figure.className = "portfolio-figure";
  const image = document.createElement("img");
  image.className = "portfolio-image";
  image.src = item.src;
  image.alt = item.alt;
  image.loading = "lazy";
  figure.append(image);

  const caption = document.createElement("figcaption");
  caption.className = "portfolio-caption";
  const title = document.createElement("h3");
  title.textContent = item.title;
  caption.append(title);
  if (item.description) {
    const description = document.createElement("p");
    description.textContent = item.description;
    caption.append(description);
  }

  const controls = document.createElement("div");
  controls.className = "portfolio-carousel-controls";
  const previous = document.createElement("button");
  previous.className = "portfolio-arrow";
  previous.type = "button";
  previous.setAttribute("aria-label", "Previous item");
  previous.textContent = "\u2190";
  previous.disabled = items.length < 2;
  previous.addEventListener("click", () => {
    portfolioIndexes[section] = (index - 1 + items.length) % items.length;
    renderPortfolioCarousel(section);
  });
  const counter = document.createElement("span");
  counter.className = "portfolio-counter";
  counter.setAttribute("aria-live", "polite");
  counter.textContent = `${index + 1} / ${items.length}`;
  const next = document.createElement("button");
  next.className = "portfolio-arrow";
  next.type = "button";
  next.setAttribute("aria-label", "Next item");
  next.textContent = "\u2192";
  next.disabled = items.length < 2;
  next.addEventListener("click", () => {
    portfolioIndexes[section] = (index + 1) % items.length;
    renderPortfolioCarousel(section);
  });
  controls.append(previous, counter, next);

  const content = document.createElement("div");
  content.className = "portfolio-carousel";
  content.append(figure, caption, controls);
  panel.replaceChildren(content);
}

function renderPortfolioVideos() {
  const panel = portfolioPanels.videos;
  if (!portfolioManifest.videos.length) {
    setPortfolioStatus(panel, "There are no videos published yet. Please check back soon.");
    return;
  }

  const list = document.createElement("ul");
  list.className = "portfolio-video-list";
  for (const video of portfolioManifest.videos) {
    const item = document.createElement("li");
    item.className = "portfolio-video-item";
    const preview = document.createElement("div");
    preview.className = "portfolio-video-preview";
    const thumbnail = document.createElement("img");
    thumbnail.src = `https://i.ytimg.com/vi/${video.videoId}/hqdefault.jpg`;
    thumbnail.alt = `${video.title} video thumbnail`;
    thumbnail.loading = "lazy";
    thumbnail.addEventListener("error", () => thumbnail.remove(), { once: true });
    const play = document.createElement("button");
    play.className = "portfolio-play";
    play.type = "button";
    play.setAttribute("aria-label", `Play ${video.title}`);
    play.textContent = "\u25b6";
    play.addEventListener("click", () => {
      const frame = document.createElement("iframe");
      frame.className = "portfolio-video-frame";
      frame.src = `https://www.youtube-nocookie.com/embed/${video.videoId}?rel=0&playsinline=1`;
      frame.title = video.title;
      frame.allow = "encrypted-media; picture-in-picture; web-share";
      frame.referrerPolicy = "strict-origin-when-cross-origin";
      frame.allowFullscreen = true;
      preview.replaceChildren(frame);
    }, { once: true });
    preview.append(thumbnail, play);

    const details = document.createElement("div");
    details.className = "portfolio-video-details";
    const title = document.createElement("h3");
    title.textContent = video.title;
    details.append(title);
    if (video.description) {
      const description = document.createElement("p");
      description.textContent = video.description;
      details.append(description);
    }
    item.append(preview, details);
    list.append(item);
  }
  panel.replaceChildren(list);
}

function renderPortfolioSection() {
  const panel = portfolioPanels[portfolioSection];
  if (portfolioLoadState === "loading" || portfolioLoadState === "idle") {
    setPortfolioStatus(panel, "Loading the portfolio...");
    return;
  }
  if (portfolioLoadState === "error") {
    setPortfolioStatus(panel, "The portfolio could not be loaded.", true);
    return;
  }
  if (portfolioSection === "videos") renderPortfolioVideos();
  else renderPortfolioCarousel(portfolioSection);
}

function selectPortfolioSection(section, focusTab = false) {
  portfolioSection = normalizePortfolioSection(section);
  portfolioTabs.forEach((tab) => {
    const selected = tab.dataset.portfolioSection === portfolioSection;
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
    if (selected && focusTab) tab.focus();
  });
  Object.entries(portfolioPanels).forEach(([key, panel]) => {
    panel.hidden = key !== portfolioSection;
  });
  if (portfolioSection !== "videos") portfolioPanels.videos.replaceChildren();
  renderPortfolioSection();
}

function loadPortfolioManifest(force = false) {
  if (portfolioManifest) return Promise.resolve(portfolioManifest);
  if (portfolioManifestPromise && !force) return portfolioManifestPromise;

  portfolioLoadState = "loading";
  renderPortfolioSection();
  portfolioManifestPromise = fetch("/portfolio/manifest.json")
    .then((response) => {
      if (!response.ok) throw new Error(`Portfolio request failed (${response.status})`);
      return response.json();
    })
    .then((data) => {
      portfolioManifest = normalizePortfolioManifest(data);
      portfolioLoadState = "ready";
      return portfolioManifest;
    })
    .catch((error) => {
      portfolioManifestPromise = undefined;
      portfolioLoadState = "error";
      throw error;
    });
  return portfolioManifestPromise;
}

async function openPortfolio(section, trigger) {
  if (!portfolioDialog.open) portfolioDialogTrigger = trigger || document.activeElement;
  openDialog(portfolioDialog, portfolioDialogTrigger);
  selectPortfolioSection(section);
  try {
    await loadPortfolioManifest();
  } catch {
    // Keep the retryable error state in the selected panel.
  }
  if (portfolioDialog.open) renderPortfolioSection();
}

function stopPortfolioVideos() {
  portfolioPanels.videos.querySelectorAll("iframe").forEach((frame) => frame.remove());
}

function confirmMilestone(indicator, state, message) {
  indicator.classList.remove("is-idle");
  indicator.classList.add("is-confirmed");
  state.textContent = message;
}

function loadCalendlyWidget() {
  if (window.Calendly?.initInlineWidget) return Promise.resolve();
  if (calendlyWidgetPromise) return calendlyWidgetPromise;

  calendlyWidgetPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://assets.calendly.com/assets/external/widget.js";
    script.async = true;
    script.addEventListener("load", resolve, { once: true });
    script.addEventListener("error", () => {
      calendlyWidgetPromise = undefined;
      reject(new Error("Calendly failed to load."));
    }, { once: true });
    document.head.append(script);
  });

  return calendlyWidgetPromise;
}

async function openScheduling(payload) {
  let bookingUrl;
  try {
    bookingUrl = new URL(payload?.url);
  } catch {
    return;
  }
  if (bookingUrl.protocol !== "https:" || !/^(?:[^.]+\.)*calendly\.com$/i.test(bookingUrl.hostname)) return;

  const name = typeof payload?.name === "string" ? payload.name.trim() : "";
  const email = typeof payload?.email === "string" ? payload.email.trim() : "";
  if (name) bookingUrl.searchParams.set("name", name);
  if (email) bookingUrl.searchParams.set("email", email);

  calendlyFallback.href = bookingUrl.href;
  calendlyEmbed.replaceChildren();
  schedulingStatus.textContent = "Loading available times...";
  openDialog(schedulingDialog);

  try {
    await loadCalendlyWidget();
    if (!schedulingDialog.open) return;
    window.Calendly.initInlineWidget({
      url: bookingUrl.href,
      parentElement: calendlyEmbed,
      resize: true,
    });
    schedulingStatus.textContent = "";
  } catch {
    schedulingStatus.textContent = "Calendly could not load. Use the link below to book.";
  }
}

function setStatus(message, state = orbState) {
  orbState = state;
  studioBoard.dataset.signalState = state;
  signalIntensity = state === "speaking" ? 1 : state === "connecting" ? 0.9 : state === "connected" ? 0.72 : state === "error" ? 0.25 : 0.32;
  redrawSignalField();
  status.textContent = message;
  connectButton.className = `orb orb-${state}`;
  connectButton.setAttribute("aria-label", state === "idle" || state === "error" ? "Talk to us" : "End session");
  sessionLabel.textContent = state === "idle" ? "READY WHEN YOU ARE" : state === "connecting" ? "OPENING A SECURE LINE" : state === "speaking" ? "FALCON IS RESPONDING" : "LISTENING LIVE";
}

function teardownUI() {
  if (botAudio.srcObject) {
    botAudio.srcObject = null;
  }
  client = undefined;
}

async function createTransport() {
  if (!CLOUD_PUBLIC_KEY) {
    return new SmallWebRTCTransport();
  }

  const startResponse = await fetch(
    `${CLOUD_API_URL}/${encodeURIComponent(CLOUD_AGENT_NAME)}/start`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${CLOUD_PUBLIC_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        transport: "webrtc",
        enableDefaultIceServers: true,
      }),
    },
  );

  if (!startResponse.ok) {
    throw new Error(`Cloud session could not start (${startResponse.status})`);
  }

  const session = await startResponse.json();
  if (!session.sessionId) {
    throw new Error("Cloud session did not return a session ID");
  }

  const offerEndpoint = `${CLOUD_API_URL}/${encodeURIComponent(CLOUD_AGENT_NAME)}/sessions/${session.sessionId}/api/offer`;
  return new SmallWebRTCTransport({
    webrtcRequestParams: {
      endpoint: offerEndpoint,
      headers: new Headers({
        Authorization: `Bearer ${CLOUD_PUBLIC_KEY}`,
      }),
    },
    iceServers: session.iceConfig?.iceServers || [],
  });
}

async function ensureMicrophonePermission() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Microphone access is not supported by this browser");
  }

  if (navigator.permissions?.query) {
    const permission = await navigator.permissions.query({ name: "microphone" });
    if (permission.state === "denied") {
      throw new Error("Microphone access is blocked for this site. Allow it in browser settings, then reload.");
    }
  }
}

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  themeToggle.setAttribute("aria-label", `Switch to ${theme === "dark" ? "light" : "dark"} mode`);
  themeIcon.innerHTML = theme === "dark" ? "&#9788;" : "&#9790;";
  localStorage.setItem("motion-falcon-theme", theme);
}

async function connect() {
  connectButton.disabled = true;
  setStatus("Connecting to Instant Assist...", "connecting");

  try {
    await ensureMicrophonePermission();
    const transport = CLOUD_PUBLIC_KEY
      ? await createTransport()
      : new SmallWebRTCTransport({ webrtcUrl: LOCAL_BOT_URL });

    client = new PipecatClient({
      transport,
      enableMic: true,
      enableCam: false,
    });

    client.on(RTVIEvent.BotConnected, () => {
      setStatus("Connected. I am listening.", "connected");
    });

    client.on(RTVIEvent.BotStartedSpeaking, () => setStatus("Instant Assist is speaking.", "speaking"));
    client.on(RTVIEvent.BotStoppedSpeaking, () => setStatus("Connected. I am listening.", "connected"));
    client.on(RTVIEvent.UserStartedSpeaking, () => setStatus("I am listening.", "connected"));
    client.on(RTVIEvent.UICommand, ({ command, payload }) => {
      if (command === "update-live-notes") renderLiveNotes(payload);
      if (command === "open-lead-capture") openDialog(leadCaptureDialog);
      if (command === "open-scheduling") openScheduling(payload);
      if (command === "open-portfolio") openPortfolio(payload?.section);
      if (command === "lead-capture-confirmed") {
        openLeadCaptureButton.classList.add("is-confirmed");
        leadCaptureStatus.textContent = "Your details were received. Opening scheduling.";
        leadCaptureForm.reset();
        leadCaptureForm.querySelector('button[type="submit"]').disabled = false;
        closeDialog(leadCaptureDialog);
      }
      if (command === "lead-capture-failed") {
        const failedDestinations = Array.isArray(payload?.failedDestinations)
          ? payload.failedDestinations.filter((destination) => ["HubSpot", "Resend", "Transcript email"].includes(destination))
          : [];
        leadCaptureStatus.textContent = failedDestinations.length
          ? `Sharing did not complete with ${failedDestinations.join(" and ")}. Check the selected options before retrying.`
          : "We couldn't save your details. Please try again.";
        leadCaptureForm.querySelector('button[type="submit"]').disabled = false;
      }
    });

    client.on(RTVIEvent.Disconnected, () => {
      setStatus("", "idle");
      connectButton.textContent = "Connect";
      connectButton.disabled = false;
      teardownUI();
    });

    client.on(RTVIEvent.TrackStarted, (track, participant) => {
      if (track.kind !== "audio") return;
      if (participant?.local) return;
      botAudio.srcObject = new MediaStream([track]);
    });

    await client.connect();
    connectButton.textContent = "Disconnect";
    connectButton.disabled = false;
    setStatus("Connected");
  } catch (error) {
    console.error("Connection failed:", error);
    setStatus(error.message || "Could not open the voice line. Try again.", "error");
    teardownUI();
    connectButton.disabled = false;
  }
}

async function disconnect() {
  connectButton.disabled = true;
  setStatus("Closing the voice line...", "connecting");

  try {
    await client?.disconnect();
  } finally {
    connectButton.textContent = "Connect";
    connectButton.disabled = false;
    teardownUI();
    setStatus("", "idle");
  }
}

connectButton.addEventListener("click", async () => {
  if (client) {
    await disconnect();
    return;
  }

  await connect();
});

window.addEventListener("message", (event) => {
  if (event.origin !== "https://calendly.com") return;
  if (event.data?.event !== "calendly.event_scheduled") return;
  confirmMilestone(meetingScheduledIndicator, meetingScheduledState, "Booking confirmed");
  closeDialog(schedulingDialog);
});

themeToggle.addEventListener("click", () => {
  setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
});

openLeadCaptureButton.addEventListener("click", () => openDialog(leadCaptureDialog, openLeadCaptureButton));
document.querySelectorAll("[data-close-dialog]").forEach((button) => {
  button.addEventListener("click", () => closeDialog(document.getElementById(button.dataset.closeDialog)));
});

portfolioTabs.forEach((tab) => {
  tab.addEventListener("click", () => selectPortfolioSection(tab.dataset.portfolioSection));
  tab.addEventListener("keydown", (event) => {
    const currentIndex = portfolioTabs.indexOf(tab);
    const nextIndex = event.key === "ArrowRight"
      ? (currentIndex + 1) % portfolioTabs.length
      : event.key === "ArrowLeft"
        ? (currentIndex - 1 + portfolioTabs.length) % portfolioTabs.length
        : event.key === "Home"
          ? 0
          : event.key === "End"
            ? portfolioTabs.length - 1
            : -1;
    if (nextIndex < 0) return;
    event.preventDefault();
    selectPortfolioSection(portfolioTabs[nextIndex].dataset.portfolioSection, true);
  });
});

[leadCaptureDialog, schedulingDialog, portfolioDialog].forEach((dialog) => {
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) closeDialog(dialog);
  });
  dialog.addEventListener("close", () => {
    if (dialog === schedulingDialog) {
      calendlyEmbed.replaceChildren();
      schedulingStatus.textContent = "";
    }
    if (dialog === portfolioDialog) {
      stopPortfolioVideos();
      portfolioDialogTrigger?.focus();
      portfolioDialogTrigger = undefined;
    }
  });
});

leadCaptureForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const formData = new FormData(leadCaptureForm);
  const recapConsent = formData.has("recap");
  const transcriptConsent = formData.has("transcript");
  const transcriptEmailConsent = formData.has("transcript-email");
  if (!recapConsent && !transcriptConsent && !transcriptEmailConsent) {
    leadCaptureStatus.textContent = "Choose at least one sharing option.";
    return;
  }
  if (!client) {
    leadCaptureStatus.textContent = "Start a voice session before sharing your enquiry.";
    return;
  }
  const submitButton = leadCaptureForm.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  leadCaptureStatus.textContent = "Saving your details securely...";
  client.sendUIEvent("lead.capture", {
    name: formData.get("name"),
    email: formData.get("email"),
    recapConsent,
    transcriptConsent,
    transcriptEmailConsent,
  });
});

setupSignalField();
setTheme(localStorage.getItem("motion-falcon-theme") || "dark");
