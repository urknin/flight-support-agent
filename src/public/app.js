// ============================================================================
// AeroCare AI Client Dashboard & WebSocket Driver
// Connects to Cloudflare SupportAgent Durable Object Actor
// ============================================================================

const BOOKING_REF = "SKY-8842";
let ws = null;
let reconnectTimer = null;

// DOM Elements
const messagesContainer = document.getElementById("messages-container");
const chatForm = document.getElementById("chat-form");
const chatInput = document.getElementById("chat-input");
const btnSend = document.getElementById("btn-send");
const notifModal = document.getElementById("notif-modal");
const btnOpenNotif = document.getElementById("btn-open-notifications");
const btnCloseNotif = document.getElementById("btn-close-modal");
const notifCountBadge = document.getElementById("notif-count");
const notifList = document.getElementById("notif-list");

// Flight Card Elements
const cardFlightNum = document.getElementById("card-flight-number");
const cardAirline = document.getElementById("card-airline");
const cardStatusBadge = document.getElementById("card-status-badge");
const cardSchedDep = document.getElementById("card-sched-dep");
const cardEstDep = document.getElementById("card-est-dep");
const cardSeat = document.getElementById("card-seat");

// Weather Elements
const weatherTemp = document.getElementById("weather-temp");
const weatherDesc = document.getElementById("weather-desc");
const weatherWind = document.getElementById("weather-wind");
const weatherHumidity = document.getElementById("weather-humidity");
const faaBanner = document.getElementById("faa-banner");
const faaDetails = document.getElementById("faa-details");

// Simulator Buttons
const btnSimulate = document.getElementById("btn-simulate-disruption");
const btnQuickDfw = document.getElementById("btn-quick-dfw");
const btnQuickRestore = document.getElementById("btn-quick-restore");

// ============================================================================
// 1. Initial Data Hydration
// ============================================================================

async function fetchBookingDetails() {
  try {
    const res = await fetch(`/api/booking/${BOOKING_REF}`);
    if (!res.ok) return;
    const data = await res.json();

    cardFlightNum.textContent = data.flight_number;
    cardAirline.textContent = data.airline;
    cardSeat.textContent = data.seat;

    const sched = new Date(data.scheduled_departure);
    const est = new Date(data.actual_departure);
    cardSchedDep.textContent = `${sched.getUTCHours().toString().padStart(2, "0")}:${sched.getUTCMinutes().toString().padStart(2, "0")} UTC`;
    cardEstDep.textContent = `${est.getUTCHours().toString().padStart(2, "0")}:${est.getUTCMinutes().toString().padStart(2, "0")} UTC`;

    cardStatusBadge.textContent = data.flight_status;
    cardStatusBadge.className = "status-badge " + (
      data.flight_status === "DELAYED" ? "status-delayed" :
      data.flight_status === "ON_TIME" ? "status-ontime" : "status-delayed"
    );
  } catch (err) {
    console.error("Failed to load booking details:", err);
  }
}

async function fetchAirportWeather(code = "DFW") {
  try {
    const res = await fetch(`/api/weather/${code}`);
    if (!res.ok) return;
    const { weather, faa } = await res.json();

    weatherTemp.textContent = `${weather.temperatureC}°C`;
    weatherDesc.textContent = weather.weatherDescription;
    weatherWind.textContent = `${weather.windGustsKmh} km/h`;
    weatherHumidity.textContent = `${weather.relativeHumidity}%`;

    if (faa.hasGroundStop || faa.hasGroundDelayProgram) {
      faaBanner.style.display = "flex";
      faaDetails.textContent = faa.groundStopReason || faa.gdpReason || "Traffic Management Flow Program active.";
    } else {
      faaBanner.style.display = "none";
    }
  } catch (err) {
    console.error("Failed to load weather:", err);
  }
}

async function fetchNotifications() {
  try {
    const res = await fetch(`/api/notifications/${BOOKING_REF}`);
    if (!res.ok) return;
    const logs = await res.json();
    notifCountBadge.textContent = logs.length;

    if (logs.length === 0) {
      notifList.innerHTML = `<p style="color: var(--text-muted); font-size: 0.85rem;">No alerts dispatched yet.</p>`;
      return;
    }

    notifList.innerHTML = logs
      .map(
        (log) => `
        <div class="notif-card">
          <div class="notif-card-header">
            <span><strong>${log.channel.toUpperCase()}</strong> ➔ ${log.recipient}</span>
            <span>${new Date(log.sent_at).toLocaleTimeString()}</span>
          </div>
          <div class="notif-card-title">${log.title}</div>
          <div class="notif-card-body">${log.body}</div>
          <div style="font-size: 0.7rem; color: #10b981; margin-top: 0.35rem;">Status: ${log.delivery_status}</div>
        </div>
      `
      )
      .join("");
  } catch (err) {
    console.error("Failed to load notifications:", err);
  }
}

// ============================================================================
// 2. WebSocket Connection to Durable Object Agent
// ============================================================================

let currentThinkingBubble = null;
let currentResponseBubble = null;
let currentAccumulatedText = "";

function connectAgentWebSocket() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${protocol}//${window.location.host}/agents/support-agent/${BOOKING_REF}`;

  console.log(`[Agent Client] Connecting to ${wsUrl}...`);
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log("[Agent Client] Connected to SupportAgent Durable Object.");
    clearTimeout(reconnectTimer);
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);

      // 1. Proactive Workflow alert broadcast
      if (data.type === "proactive_alert") {
        appendAlertMessage(data.title, data.body);
        fetchBookingDetails();
        fetchNotifications();
        return;
      }

      // 2. Chat messages sync from AIChatAgent
      if ((data.type === "cf_agent_chat_messages" || data.type === "CF_AGENT_CHAT_MESSAGES") && Array.isArray(data.messages)) {
        renderFullHistory(data.messages);
        return;
      }

      // 3. Streaming response chunks from AIChatAgent
      if (data.type === "cf_agent_use_chat_response" || data.type === "CF_AGENT_USE_CHAT_RESPONSE") {
        if (currentThinkingBubble) {
          if (!currentResponseBubble) {
            currentThinkingBubble.innerHTML = "";
            currentResponseBubble = currentThinkingBubble;
          }
          if (data.body) {
            currentAccumulatedText += data.body;
            currentResponseBubble.innerHTML = formatMarkdown(currentAccumulatedText);
            scrollToBottom();
          }
          if (data.done) {
            currentThinkingBubble = null;
            currentResponseBubble = null;
            currentAccumulatedText = "";
            fetchBookingDetails();
            fetchNotifications();
          }
        }
      }
    } catch (e) {
      // Non-JSON frame (e.g. raw streaming text chunk)
      if (typeof event.data === "string" && currentThinkingBubble) {
        if (!currentResponseBubble) {
          currentThinkingBubble.innerHTML = "";
          currentResponseBubble = currentThinkingBubble;
        }
        currentAccumulatedText += event.data;
        currentResponseBubble.innerHTML = formatMarkdown(currentAccumulatedText);
        scrollToBottom();
      }
    }
  };

  ws.onclose = () => {
    console.warn("[Agent Client] WebSocket closed, retrying in 3s...");
    reconnectTimer = setTimeout(connectAgentWebSocket, 3000);
  };

  ws.onerror = (err) => {
    console.error("[Agent Client] WebSocket error:", err);
  };
}

// ============================================================================
// 3. UI Message Rendering
// ============================================================================

function appendUserMessage(text) {
  const row = document.createElement("div");
  row.className = "message-row user";
  row.innerHTML = `
    <div class="message-avatar avatar-user">You</div>
    <div class="message-bubble">${escapeHtml(text)}</div>
  `;
  messagesContainer.appendChild(row);
  scrollToBottom();
}

function appendAgentMessage(text) {
  const row = document.createElement("div");
  row.className = "message-row agent";
  row.innerHTML = `
    <div class="message-avatar avatar-agent">AI</div>
    <div class="message-bubble">${formatMarkdown(text)}</div>
  `;
  messagesContainer.appendChild(row);
  scrollToBottom();
  return row.querySelector(".message-bubble");
}

function appendAlertMessage(title, body) {
  const row = document.createElement("div");
  row.className = "message-row alert";
  row.innerHTML = `
    <div class="message-avatar" style="background: #f59e0b; color: #000;">⚠️</div>
    <div class="message-bubble">
      <strong>🚨 ${escapeHtml(title)}</strong>
      <div style="margin-top: 0.35rem; font-size: 0.85rem;">${formatMarkdown(body)}</div>
    </div>
  `;
  messagesContainer.appendChild(row);
  scrollToBottom();
}

function renderFullHistory(messages) {
  // If there are already messages, don't overwrite if user is actively chatting
  if (messagesContainer.children.length > 2) return;

  messagesContainer.innerHTML = "";
  messages.forEach((msg) => {
    if (msg.role === "user") {
      const text = msg.parts?.find((p) => p.type === "text")?.text || "";
      if (text) appendUserMessage(text);
    } else if (msg.role === "assistant") {
      const text = msg.parts?.find((p) => p.type === "text")?.text || "";
      if (text) appendAgentMessage(text);
    }
  });
}

function scrollToBottom() {
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function formatMarkdown(text) {
  return escapeHtml(text)
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.*?)\*/g, "<em>$1</em>")
    .replace(/\n/g, "<br>");
}

// ============================================================================
// 4. Chat Submission & Event Handlers
// ============================================================================

chatForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (!text) return;

  chatInput.value = "";
  appendUserMessage(text);

  // Send message over WebSocket using cf_agent_use_chat_request wire protocol
  if (ws && ws.readyState === WebSocket.OPEN) {
    const requestId = `req_${Date.now()}`;
    const payload = {
      type: "cf_agent_use_chat_request",
      id: requestId,
      init: {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [
            {
              id: `msg_${Date.now()}`,
              role: "user",
              parts: [{ type: "text", text: text }],
            },
          ],
        }),
      },
    };

    // Show temporary typing indicator
    currentThinkingBubble = appendAgentMessage("Thinking and checking flight systems...");
    currentResponseBubble = null;
    currentAccumulatedText = "";

    ws.send(JSON.stringify(payload));
  } else {
    appendAgentMessage("Reconnecting to flight operations server... Please try again in a moment.");
    connectAgentWebSocket();
  }
});

// Quick action prompt chips
document.querySelectorAll(".prompt-chip").forEach((btn) => {
  btn.addEventListener("click", () => {
    chatInput.value = btn.getAttribute("data-prompt") || "";
    chatForm.dispatchEvent(new Event("submit"));
  });
});

// Modal Toggles
btnOpenNotif.addEventListener("click", () => {
  fetchNotifications();
  notifModal.style.display = "flex";
});

btnCloseNotif.addEventListener("click", () => {
  notifModal.style.display = "none";
});

notifModal.addEventListener("click", (e) => {
  if (e.target === notifModal) notifModal.style.display = "none";
});

// ============================================================================
// 5. Simulation Action Handlers
// ============================================================================

async function triggerSimulation(flightNumber, status, reason) {
  try {
    const res = await fetch("/api/simulate-disruption", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ flightNumber, status, reason }),
    });

    if (res.ok) {
      await Promise.all([
        fetchBookingDetails(),
        fetchAirportWeather(),
        fetchNotifications(),
      ]);
    }
  } catch (err) {
    console.error("Simulation trigger failed:", err);
  }
}

btnSimulate.addEventListener("click", () => {
  triggerSimulation(
    "AA1822",
    "DELAYED",
    "Convective storm front and active FAA Ground Stop at DFW"
  );
});

btnQuickDfw.addEventListener("click", () => {
  triggerSimulation(
    "AA1822",
    "DELAYED",
    "Severe Thunderstorms with Hail & FAA Ground Stop"
  );
});

btnQuickRestore.addEventListener("click", () => {
  triggerSimulation("AA1822", "ON_TIME", null);
});

// ============================================================================
// 6. Bootstrap
// ============================================================================

fetchBookingDetails();
fetchAirportWeather("DFW");
fetchNotifications();
connectAgentWebSocket();
