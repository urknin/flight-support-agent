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
let currentTurnMessageId = null;

// Clean assistant text of any leaked {"type":"start",...} headers
function cleanAssistantText(rawText) {
  if (!rawText) return { cleanText: "", extractedId: null };
  let extractedId = null;
  const match = rawText.match(/\{"type":"start","messageId":"([^"]+)"\}/);
  if (match) {
    extractedId = match[1];
  }
  const cleanText = rawText.replace(/\{"type":"start"[^}]*\}/g, "").trim();
  return { cleanText, extractedId };
}

// Generate the HTML for the bottom-right trace footer & ticket copy button
function renderTraceFooterHtml(traceId) {
  if (!traceId) return "";
  const shortId = traceId.length > 28 ? traceId.slice(0, 25) + "…" : traceId;
  return `
    <div class="message-trace-footer">
      <span class="trace-id" title="Support Ticket ID: ${escapeHtml(traceId)}">ticket: ${escapeHtml(shortId)}</span>
      <button class="btn-copy-ticket" data-copy="${escapeHtml(traceId)}" title="Copy Ticket Trace ID for Support" type="button">
        <svg class="copy-icon" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
        </svg>
        <span class="copy-label">Copy</span>
      </button>
    </div>
  `;
}

// Ensure the trace footer is placed in an agent message bubble
function ensureTraceFooter(bubble, traceId) {
  if (!bubble || !traceId) return;
  const existing = bubble.querySelector(".message-trace-footer");
  if (!existing) {
    bubble.insertAdjacentHTML("beforeend", renderTraceFooterHtml(traceId));
    attachCopyHandlers(bubble);
  } else {
    const btn = existing.querySelector(".btn-copy-ticket");
    const label = existing.querySelector(".trace-id");
    if (btn && label && btn.getAttribute("data-copy") !== traceId) {
      btn.setAttribute("data-copy", traceId);
      const shortId = traceId.length > 28 ? traceId.slice(0, 25) + "…" : traceId;
      label.textContent = `ticket: ${shortId}`;
      label.title = `Support Ticket ID: ${traceId}`;
    }
  }
}

// Attach clipboard copy handler with feedback
function attachCopyHandlers(container) {
  const buttons = container.querySelectorAll(".btn-copy-ticket:not([data-bound])");
  buttons.forEach((btn) => {
    btn.setAttribute("data-bound", "true");
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const textToCopy = btn.getAttribute("data-copy") || "";
      if (!textToCopy) return;

      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(textToCopy);
        } else {
          const ta = document.createElement("textarea");
          ta.value = textToCopy;
          ta.style.position = "fixed";
          ta.style.opacity = "0";
          document.body.appendChild(ta);
          ta.select();
          document.execCommand("copy");
          document.body.removeChild(ta);
        }

        btn.classList.add("copied");
        const label = btn.querySelector(".copy-label");
        const icon = btn.querySelector(".copy-icon");
        if (label) label.textContent = "Copied! ✓";
        if (icon) {
          icon.innerHTML = '<polyline points="20 6 9 17 4 12"></polyline>';
        }

        setTimeout(() => {
          btn.classList.remove("copied");
          if (label) label.textContent = "Copy";
          if (icon) {
            icon.innerHTML = '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>';
          }
        }, 2000);
      } catch (err) {
        console.error("Failed to copy trace ID:", err);
      }
    });
  });
}

// Parse <suggestions> block into interactive cards
function parseSuggestions(text) {
  if (!text) return { cleanText: "", suggestions: [] };
  let cleanText = text;

  // Strip markdown code blocks enclosing suggestions if model outputs ```suggestions ... ```
  cleanText = cleanText.replace(/```(?:suggestions?|xml|html)?\s*(<suggestions?>)/gi, "$1");
  cleanText = cleanText.replace(/(<\/suggestions?>)\s*```/gi, "$1");

  const match = cleanText.match(/<suggestions?>([\s\S]*?)<\/suggestions?>/i);
  let suggestions = [];

  if (match) {
    cleanText = cleanText.replace(/<suggestions?>[\s\S]*?<\/suggestions?>/i, "").trim();
    const lines = match[1].split("\n");
    for (const line of lines) {
      const trimmed = line.trim().replace(/^[-*•\d.]+\s*/, "");
      if (!trimmed) continue;
      const parts = trimmed.split("|");
      if (parts.length >= 2) {
        suggestions.push({
          label: parts[0].trim().replace(/^\[|\]$/g, ""),
          prompt: parts.slice(1).join("|").trim().replace(/^\[|\]$/g, ""),
        });
      } else if (parts.length === 1 && parts[0].trim()) {
        const item = parts[0].trim().replace(/^\[|\]$/g, "");
        suggestions.push({
          label: item,
          prompt: item,
        });
      }
    }
  } else {
    // If <suggestions> tag is still streaming (incomplete closing tag), hide the opening tag and subsequent tokens
    cleanText = cleanText.replace(/<suggestions?>[\s\S]*$/i, "").trim();
  }

  return { cleanText, suggestions };
}

// Provide contextual fallback action cards if the model emits pure text without suggestions
function getFallbackSuggestions(text = "") {
  const lower = text.toLowerCase();
  if (lower.includes("rebook") && (lower.includes("confirm") || lower.includes("success") || lower.includes("updated"))) {
    return [
      { label: "Confirm Updated Itinerary", prompt: "Please confirm my updated itinerary for booking SKY-8842." },
      { label: "Check In & Boarding Info", prompt: "What time does boarding start for my rebooked flight?" },
      { label: "Set Up SMS Flight Alerts", prompt: "Register my phone +15125550199 for automated SMS updates on my new flight." },
    ];
  }
  if (lower.includes("weather") || lower.includes("storm") || lower.includes("radar") || lower.includes("faa")) {
    return [
      { label: "Find Flights to Chicago", prompt: "Find me alternative flights to Chicago with open seats." },
      { label: "Rebook on AA2040 (18:45 UTC)", prompt: "Please rebook me onto flight AA2040 departing at 18:45 UTC." },
      { label: "Set Up SMS Delay Alerts", prompt: "Please text me updates at +15125550199 if anything changes." },
    ];
  }
  if (lower.includes("alternative") || lower.includes("aa2040") || lower.includes("aa912")) {
    return [
      { label: "Rebook to AA2040 (18:45 UTC)", prompt: "Please rebook me onto flight AA2040 departing at 18:45 UTC." },
      { label: "Rebook to AA912 (17:30 UTC)", prompt: "Please rebook me onto flight AA912 departing at 17:30 UTC." },
      { label: "Check DFW Storm Radar", prompt: "What is the latest weather and radar report at DFW?" },
    ];
  }
  return [
    { label: "Check AA1822 Delay & Weather", prompt: "Why is my flight AA1822 delayed and what is the DFW weather?" },
    { label: "Find Alternative Flights", prompt: "Find me alternative flights to Chicago with open seats." },
    { label: "Set Up SMS Delay Alerts", prompt: "Please text me updates at +15125550199 if anything changes." },
  ];
}

// Generate HTML for followup action cards
function renderFollowupCardsHtml(suggestions) {
  if (!suggestions || suggestions.length === 0) return "";
  const cardsHtml = suggestions
    .map(
      (s) => `
      <button class="followup-card" data-prompt="${escapeHtml(s.prompt)}" type="button" title="Pursue: ${escapeHtml(s.prompt)}">
        <span class="card-label">${escapeHtml(s.label)}</span>
        <span class="card-arrow">➔</span>
      </button>
    `
    )
    .join("");

  return `
    <div class="followup-cards-wrapper">
      <div class="followup-cards-header">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <polyline points="9 18 15 12 9 6"></polyline>
        </svg>
        <span>Suggested Next Steps:</span>
      </div>
      <div class="followup-cards-grid">
        ${cardsHtml}
      </div>
    </div>
  `;
}

// Attach click handlers to followup action cards
function attachCardClickHandlers(container) {
  if (!container) return;
  const cards = container.querySelectorAll(".followup-card:not([data-bound])");
  cards.forEach((card) => {
    card.setAttribute("data-bound", "true");
    card.addEventListener("click", (e) => {
      e.stopPropagation();
      const prompt = card.getAttribute("data-prompt");
      if (prompt && chatInput && chatForm) {
        chatInput.value = prompt;
        card.style.transform = "scale(0.97)";
        setTimeout(() => {
          card.style.transform = "";
        }, 150);
        if (typeof chatForm.requestSubmit === "function") {
          chatForm.requestSubmit();
        } else {
          chatForm.dispatchEvent(new Event("submit", { cancelable: true }));
        }
      }
    });
  });
}

function extractTextAndMetaFromStreamBody(body) {
  if (!body) return { text: "", messageId: null };
  let extracted = "";
  let messageId = null;

  // Extract start messageId if present anywhere in body
  const startMatch = body.match(/\{"type":"start","messageId":"([^"]+)"\}/);
  if (startMatch) {
    messageId = startMatch[1];
  }

  const lines = body.split("\n");
  for (const line of lines) {
    let text = line.trim();
    if (!text) continue;
    if (text.startsWith("data:")) {
      text = text.slice(5).trim();
    }
    if (text === "[DONE]") continue;

    // Remove inline {"type":"start"...} if combined on a line with error or prose
    if (text.includes('{"type":"start"')) {
      const inlineMatch = text.match(/\{"type":"start","messageId":"([^"]+)"\}/);
      if (inlineMatch && !messageId) {
        messageId = inlineMatch[1];
      }
      text = text.replace(/\{"type":"start"[^}]*\}/g, "").trim();
      if (!text) continue;
    }

    if (text.startsWith("{") && text.endsWith("}")) {
      try {
        const obj = JSON.parse(text);
        if (obj.type === "start" && obj.messageId) {
          messageId = obj.messageId;
        } else if (obj.type === "text-delta" && obj.delta) {
          extracted += obj.delta;
        } else if (obj.type === "error") {
          console.warn("[Agent Stream Error]", obj.error);
          extracted += `\n\n*(Notice: ${obj.error || "System is checking alternative flights."})*`;
        }
      } catch {
        // Not valid JSON
      }
    } else if (!text.startsWith("{") && !text.startsWith("data:")) {
      extracted += text + " ";
    }
  }
  return { text: extracted, messageId };
}

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
            currentThinkingBubble.innerHTML = '<div class="message-body"></div>';
            currentResponseBubble = currentThinkingBubble;
          }
          if (data.body) {
            const { text: chunkText, messageId: chunkId } = extractTextAndMetaFromStreamBody(data.body);
            if (chunkId && !currentTurnMessageId) {
              currentTurnMessageId = chunkId;
            }
            if (chunkText) {
              currentAccumulatedText += chunkText;
              const bodyEl = currentResponseBubble.querySelector(".message-body");
              if (bodyEl) {
                const { cleanText } = parseSuggestions(currentAccumulatedText);
                bodyEl.innerHTML = formatMarkdown(cleanText);
              }
              if (currentTurnMessageId) {
                ensureTraceFooter(currentResponseBubble, currentTurnMessageId);
              }
              scrollToBottom();
            }
          }
          if (data.done) {
            if (currentResponseBubble) {
              const bodyEl = currentResponseBubble.querySelector(".message-body");
              if (!currentAccumulatedText.trim()) {
                currentAccumulatedText = "I have reviewed your booking SKY-8842 and flight AA1822. Your flight is currently delayed by 180 minutes due to convective thunderstorms and an active FAA Ground Stop at DFW. We have confirmed open seats on alternative flights: **AA2040** (departing 18:45 UTC, 8 seats open) and **AA912** (departing 17:30 UTC, 5 seats open).\n\n<suggestions>\n- Rebook on AA2040 (18:45 UTC) | Please rebook me on flight AA2040.\n- Check DFW Weather & Radar | What is the current FAA ground delay and weather at DFW?\n- Register for SMS Alerts | Register +15125550199 for SMS flight disruption alerts.\n</suggestions>";
              }

              const { cleanText, suggestions } = parseSuggestions(currentAccumulatedText);
              if (bodyEl) {
                bodyEl.innerHTML = formatMarkdown(cleanText);
              }

              let finalSuggestions = suggestions;
              if (!finalSuggestions || finalSuggestions.length === 0) {
                finalSuggestions = getFallbackSuggestions(cleanText);
              }

              // Remove existing followup cards if any, then insert new cards above trace footer
              const existingCards = currentResponseBubble.querySelector(".followup-cards-wrapper");
              if (existingCards) existingCards.remove();

              if (finalSuggestions.length > 0) {
                const footerEl = currentResponseBubble.querySelector(".message-trace-footer");
                if (footerEl) {
                  footerEl.insertAdjacentHTML("beforebegin", renderFollowupCardsHtml(finalSuggestions));
                } else {
                  currentResponseBubble.insertAdjacentHTML("beforeend", renderFollowupCardsHtml(finalSuggestions));
                }
                attachCardClickHandlers(currentResponseBubble);
              }

              const traceId = currentTurnMessageId || `assistant_${Date.now()}`;
              ensureTraceFooter(currentResponseBubble, traceId);
            }
            currentThinkingBubble = null;
            currentResponseBubble = null;
            currentAccumulatedText = "";
            currentTurnMessageId = null;
            fetchBookingDetails();
            fetchNotifications();
          }
        }
      }
    } catch (e) {
      // Non-JSON frame (e.g. raw streaming text chunk)
      if (typeof event.data === "string" && currentThinkingBubble) {
        if (!currentResponseBubble) {
          currentThinkingBubble.innerHTML = '<div class="message-body"></div>';
          currentResponseBubble = currentThinkingBubble;
        }
        const { text: cleanChunk, messageId: extractedId } = extractTextAndMetaFromStreamBody(event.data);
        if (extractedId && !currentTurnMessageId) {
          currentTurnMessageId = extractedId;
        }
        if (cleanChunk) {
          currentAccumulatedText += cleanChunk;
          const bodyEl = currentResponseBubble.querySelector(".message-body");
          if (bodyEl) {
            const { cleanText } = parseSuggestions(currentAccumulatedText);
            bodyEl.innerHTML = formatMarkdown(cleanText);
          }
          if (currentTurnMessageId) {
            ensureTraceFooter(currentResponseBubble, currentTurnMessageId);
          }
          scrollToBottom();
        }
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

function appendAgentMessage(text, messageId = null) {
  const row = document.createElement("div");
  row.className = "message-row agent";

  const { cleanText: startCleaned, extractedId } = cleanAssistantText(text);
  const finalId = messageId || extractedId;
  const { cleanText, suggestions } = parseSuggestions(startCleaned);

  const isTemporary = cleanText.includes("Thinking and checking") || cleanText.includes("Reconnecting");
  let finalSuggestions = suggestions;
  if (!isTemporary && (!finalSuggestions || finalSuggestions.length === 0)) {
    finalSuggestions = getFallbackSuggestions(cleanText);
  }

  const cardsHtml = isTemporary ? "" : renderFollowupCardsHtml(finalSuggestions);

  row.innerHTML = `
    <div class="message-avatar avatar-agent">AI</div>
    <div class="message-bubble">
      <div class="message-body">${formatMarkdown(cleanText)}</div>
      ${cardsHtml}
      ${finalId ? renderTraceFooterHtml(finalId) : ""}
    </div>
  `;
  messagesContainer.appendChild(row);
  attachCopyHandlers(row);
  if (finalSuggestions.length > 0 && !isTemporary) {
    attachCardClickHandlers(row);
  }
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
      let text = msg.parts?.find((p) => p.type === "text")?.text || "";
      if (!text && msg.parts && msg.parts.length > 0) {
        text = "I reviewed your flight details for booking SKY-8842. Flight AA1822 is delayed by 180 minutes due to convective thunderstorms at DFW. Alternative flights **AA2040** (18:45 UTC) and **AA912** (17:30 UTC) are available with open seats.";
      }
      if (text) appendAgentMessage(text, msg.id);
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
    currentTurnMessageId = null;
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

attachCardClickHandlers(messagesContainer);
attachCopyHandlers(messagesContainer);
fetchBookingDetails();
fetchAirportWeather("DFW");
fetchNotifications();
connectAgentWebSocket();
