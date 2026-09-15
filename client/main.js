import { PipecatClient, RTVIEvent } from "@pipecat-ai/client-js";
import { SmallWebRTCTransport } from "@pipecat-ai/small-webrtc-transport";

const LOCAL_BOT_URL = "http://localhost:7860/api/offer";
const CLOUD_API_URL = import.meta.env.VITE_PCC_API_URL || "https://api.pipecat.daily.co/v1/public";
const CLOUD_AGENT_NAME = import.meta.env.VITE_PCC_AGENT_NAME || "pipecat-quickstart";
const CLOUD_PUBLIC_KEY = import.meta.env.VITE_PCC_PUBLIC_KEY;
const connectButton = document.getElementById("connect");
const status = document.getElementById("status");
const botAudio = document.getElementById("bot-audio");
const orbLabel = document.getElementById("orb-label");
const sessionLabel = document.getElementById("session-label");
const themeToggle = document.getElementById("theme-toggle");
const themeIcon = themeToggle.querySelector(".theme-icon");
const insightGrid = document.getElementById("insight-grid");
const leadCaptureDialog = document.getElementById("lead-capture-dialog");
const schedulingDialog = document.getElementById("scheduling-dialog");
const leadCaptureForm = document.getElementById("lead-capture-form");
const leadCaptureStatus = document.getElementById("lead-capture-status");
const calendlyFrame = document.getElementById("calendly-frame");
const calendlyFallback = document.getElementById("calendly-fallback");
const openLeadCaptureButton = document.getElementById("open-lead-capture");

const approvedBriefs = [
  { label: "Current intent", snippets: ["Ready to turn a question into a clear next move.", "Listening for the outcome that matters most right now."] },
  { label: "Relevant capability", snippets: ["I can help shape ideas, decisions, and action plans in real time.", "Bring the rough version. We can make it useful together."] },
  { label: "Recommended next step", snippets: ["Start with the part that feels most stuck.", "Name the decision, deadline, or detail you want to move."] },
  { label: "Commercial lens", snippets: ["Keep the signal high: clarity, speed, and a practical result.", "Good momentum is a business advantage. Let us protect it."] },
];

let client;
let orbState = "idle";
let briefIndex = 0;
let dialogTrigger;

function openDialog(dialog, trigger) {
  dialogTrigger = trigger || document.activeElement;
  if (!dialog.open) dialog.showModal();
}

function closeDialog(dialog) {
  if (dialog.open) dialog.close();
  dialogTrigger?.focus();
}

function openScheduling(payload) {
  const calendlyUrl = payload?.url;
  if (typeof calendlyUrl !== "string" || !/^https:\/\/(?:[^/]+\.)?calendly\.com\//.test(calendlyUrl)) return;
  calendlyFrame.src = calendlyUrl;
  calendlyFallback.href = calendlyUrl;
  openDialog(schedulingDialog);
}

function renderBrief() {
  insightGrid.replaceChildren(...approvedBriefs.map((brief) => {
    const card = document.createElement("article");
    card.className = "insight-card";
    card.innerHTML = `<span class="card-label">${brief.label}</span><p>${brief.snippets[briefIndex % brief.snippets.length]}</p>`;
    return card;
  }));
}

function setStatus(message, state = orbState) {
  orbState = state;
  status.textContent = message;
  connectButton.className = `orb orb-${state}`;
  orbLabel.textContent = state === "idle" || state === "error" ? "Start assist" : "End session";
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
      if (command === "open-lead-capture") openDialog(leadCaptureDialog);
      if (command === "open-scheduling") openScheduling(payload);
    });

    client.on(RTVIEvent.Disconnected, () => {
      setStatus("Tap to start a private voice session", "idle");
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
    setStatus("Tap to start a private voice session", "idle");
  }
}

connectButton.addEventListener("click", async () => {
  if (client) {
    await disconnect();
    return;
  }

  await connect();
});

themeToggle.addEventListener("click", () => {
  setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
});

openLeadCaptureButton.addEventListener("click", () => openDialog(leadCaptureDialog, openLeadCaptureButton));
document.querySelectorAll("[data-close-dialog]").forEach((button) => {
  button.addEventListener("click", () => closeDialog(document.getElementById(button.dataset.closeDialog)));
});

[leadCaptureDialog, schedulingDialog].forEach((dialog) => {
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) closeDialog(dialog);
  });
  dialog.addEventListener("close", () => {
    if (dialog === schedulingDialog) calendlyFrame.removeAttribute("src");
  });
});

leadCaptureForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const formData = new FormData(leadCaptureForm);
  const recapConsent = formData.has("recap");
  const transcriptConsent = formData.has("transcript");
  if (!recapConsent && !transcriptConsent) {
    leadCaptureStatus.textContent = "Choose at least one sharing option.";
    return;
  }
  if (!client) {
    leadCaptureStatus.textContent = "Start a voice session before sharing your enquiry.";
    return;
  }
  client.sendUIEvent("lead.capture", {
    name: formData.get("name"),
    email: formData.get("email"),
    recapConsent,
    transcriptConsent,
  });
  leadCaptureStatus.textContent = "Details shared. Opening scheduling.";
  leadCaptureForm.reset();
});

renderBrief();
setTheme(localStorage.getItem("motion-falcon-theme") || "dark");
setInterval(() => {
  briefIndex += 1;
  renderBrief();
}, 9000);
