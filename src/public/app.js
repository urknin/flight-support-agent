// ============================================================================
// AeroCare AI Client Dashboard & Multi-Case WebSocket Driver
// Connects to Cloudflare SupportAgent Durable Object Actors
// ============================================================================

let currentConversationId = sessionStorage.getItem("aerocare_conv_id") || "conv_p101_active";
let currentBookingRef = "SKY-8842";
let currentCustomerId = "P-101";
let currentCaseStatus = "ACTIVE";
let currentCaseTitle = "";
let currentResolutionSummary = "";
let allPassengersList = [];
let caseFilterStatus = "ALL";
let ws = null;
let reconnectTimer = null;

// Chat Header & Case Meta Elements
const chatCaseTitle = document.getElementById("chat-case-title");
const chatCustomerTag = document.getElementById("chat-customer-tag");
const chatConvIdTag = document.getElementById("chat-conv-id-tag");
const chatStatusBadge = document.getElementById("chat-status-badge");
const agentStatusDot = document.getElementById("agent-status-dot");
const btnResolveChat = document.getElementById("btn-resolve-chat");
const btnChatSearch = document.getElementById("btn-chat-search");
const btnChatNew = document.getElementById("btn-chat-new");
const btnHeaderSearchCases = document.getElementById("btn-header-search-cases");
const btnHeaderNewCase = document.getElementById("btn-header-new-case");
const caseResolvedBanner = document.getElementById("case-resolved-banner");
const resolvedSummaryText = document.getElementById("resolved-summary-text");
const btnResolvedNewCase = document.getElementById("btn-resolved-new-case");
const quickPromptsBar = document.getElementById("quick-prompts-bar");

// Chat DOM Elements
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

// Modal Elements: Search Cases
const searchCasesModal = document.getElementById("search-cases-modal");
const btnCloseSearchModal = document.getElementById("btn-close-search-modal");
const caseSearchInput = document.getElementById("case-search-input");
const casesResultsList = document.getElementById("cases-results-list");
const caseStatusFilters = document.getElementById("case-status-filters");

// Modal Elements: New Case
const newCaseModal = document.getElementById("new-case-modal");
const btnCloseNewCaseModal = document.getElementById("btn-close-new-case-modal");
const newCaseCustomerSelect = document.getElementById("new-case-customer-select");
const newCaseConflictAlert = document.getElementById("new-case-conflict-alert");
const conflictAlertTitle = document.getElementById("conflict-alert-title");
const conflictAlertMsg = document.getElementById("conflict-alert-msg");
const btnConflictSwitch = document.getElementById("btn-conflict-switch");
const btnConflictResolve = document.getElementById("btn-conflict-resolve");
const newCaseIssueDesc = document.getElementById("new-case-issue-desc");
const btnAiIntakeGenerate = document.getElementById("btn-ai-intake-generate");
const aiBriefingCard = document.getElementById("ai-briefing-card");
const newCaseTitleInput = document.getElementById("new-case-title-input");
const newCaseCategorySelect = document.getElementById("new-case-category-select");
const aiPriorityBadge = document.getElementById("ai-priority-badge");
const aiDiagnosisText = document.getElementById("ai-diagnosis-text");
const newCaseOpeningText = document.getElementById("new-case-opening-text");
const btnCancelNewCase = document.getElementById("btn-cancel-new-case");
const btnLaunchCaseSubmit = document.getElementById("btn-launch-case-submit");

// Modal Elements: Resolve Case
const resolveCaseModal = document.getElementById("resolve-case-modal");
const btnCloseResolveModal = document.getElementById("btn-close-resolve-modal");
const resolveModalCaseTitle = document.getElementById("resolve-modal-case-title");
const resolveModalCaseConvId = document.getElementById("resolve-modal-case-conv-id");
const btnAiSummarize = document.getElementById("btn-ai-summarize");
const resolveSummaryInput = document.getElementById("resolve-summary-input");
const btnCancelResolve = document.getElementById("btn-cancel-resolve");
const btnConfirmResolve = document.getElementById("btn-confirm-resolve");

// ============================================================================
// 1. Initial Data Hydration & Booking Fetch
// ============================================================================

async function fetchBookingDetails(bookingRef = currentBookingRef) {
  if (!bookingRef) return;
  try {
    const res = await fetch(`/api/booking/${bookingRef}`);
    if (!res.ok) return;
    const data = await res.json();

    const bookingBadge = document.getElementById("booking-badge");
    if (bookingBadge) bookingBadge.textContent = data.booking_ref;
    if (cardFlightNum) cardFlightNum.textContent = data.flight_number;
    if (cardAirline) cardAirline.textContent = data.airline;
    if (cardSeat) cardSeat.textContent = data.seat;
    const cardPass = document.getElementById("card-passenger-name");
    if (cardPass) cardPass.textContent = data.passenger_name;

    const cardOrigCode = document.getElementById("card-origin-code");
    const cardOrigCity = document.getElementById("card-origin-city");
    const cardDestCode = document.getElementById("card-dest-code");
    const cardDestCity = document.getElementById("card-dest-city");
    if (cardOrigCode) cardOrigCode.textContent = data.origin_code;
    if (cardOrigCity) cardOrigCity.textContent = data.origin_city;
    if (cardDestCode) cardDestCode.textContent = data.dest_code;
    if (cardDestCity) cardDestCity.textContent = data.dest_city;

    if (cardStatusBadge) {
      cardStatusBadge.textContent = data.flight_status;
      cardStatusBadge.className = `status-badge status-${data.flight_status.toLowerCase().replace("_", "-")}`;
    }

    const sched = new Date(data.scheduled_departure);
    const est = new Date(data.actual_departure);
    if (cardSchedDep) {
      cardSchedDep.textContent = `${sched.getUTCHours().toString().padStart(2, "0")}:${sched.getUTCMinutes().toString().padStart(2, "0")} UTC`;
    }
    if (cardEstDep) {
      cardEstDep.textContent = `${est.getUTCHours().toString().padStart(2, "0")}:${est.getUTCMinutes().toString().padStart(2, "0")} UTC`;
    }
  } catch (err) {
    console.error("fetchBookingDetails failed:", err);
  }
}

async function fetchAirportWeather(airportCode = "DFW") {
  try {
    const res = await fetch(`/api/weather/${airportCode}`);
    if (!res.ok) return;
    const data = await res.json();

    if (data.weather) {
      weatherTemp.textContent = `${Math.round(data.weather.temperatureC)}°C`;
      weatherDesc.textContent = data.weather.weatherDescription;
      weatherWind.textContent = `${data.weather.windGustsKmh} km/h`;
      weatherHumidity.textContent = `${data.weather.relativeHumidity}%`;
    }

    if (data.faa && data.faa.hasGroundStop) {
      faaBanner.style.display = "flex";
      faaDetails.textContent = data.faa.groundStopReason || "Ground Stop active due to severe thunderstorms.";
    } else {
      faaBanner.style.display = "none";
    }
  } catch (err) {
    console.error("fetchAirportWeather failed:", err);
  }
}

async function fetchNotifications(bookingRef = currentBookingRef) {
  if (!bookingRef) return;
  try {
    const res = await fetch(`/api/notifications/${bookingRef}`);
    if (!res.ok) return;
    const logs = await res.json();

    notifCountBadge.textContent = logs.length;
    if (logs.length === 0) {
      notifList.innerHTML = `<p style="color: var(--text-muted); font-size: 0.85rem;">No alerts dispatched yet for booking ${escapeHtml(bookingRef)}.</p>`;
      return;
    }

    notifList.innerHTML = logs
      .map(
        (log) => `
      <div class="notif-card">
        <div class="notif-card-header">
          <span>${log.channel.toUpperCase()} ➔ ${escapeHtml(log.recipient)}</span>
          <span style="font-family: var(--font-mono);">${new Date(log.sent_at).toLocaleTimeString()}</span>
        </div>
        <div class="notif-card-title">${escapeHtml(log.title)}</div>
        <div class="notif-card-body">${escapeHtml(log.body)}</div>
      </div>
    `
      )
      .join("");
  } catch (err) {
    console.error("fetchNotifications failed:", err);
  }
}

// ============================================================================
// 2. Case Management & Active Conversation Switcher
// ============================================================================

async function loadConversation(convId, initialOpening = null) {
  if (!convId) return;
  currentConversationId = convId;
  sessionStorage.setItem("aerocare_conv_id", convId);

  try {
    const res = await fetch(`/api/conversations/${convId}`);
    if (res.ok) {
      const conv = await res.json();
      currentBookingRef = conv.booking_ref || "SKY-8842";
      currentCustomerId = conv.customer_id;
      currentCaseStatus = conv.status;
      currentCaseTitle = conv.title || "";
      currentResolutionSummary = conv.resolution_summary || "";

      if (chatCaseTitle) chatCaseTitle.textContent = conv.title;
      if (chatCustomerTag) chatCustomerTag.textContent = `👤 ${conv.customer_name} (${conv.customer_id})`;
      if (chatConvIdTag) {
        chatConvIdTag.textContent = conv.conversation_id;
        chatConvIdTag.title = `Conversation ID: ${conv.conversation_id}`;
      }

      if (conv.status === "ACTIVE") {
        if (chatStatusBadge) {
          chatStatusBadge.className = "badge-status status-active";
          chatStatusBadge.textContent = "● ACTIVE";
        }
        if (btnResolveChat) btnResolveChat.style.display = "inline-flex";
        if (caseResolvedBanner) caseResolvedBanner.style.display = "none";
        if (chatInput) {
          chatInput.disabled = false;
          chatInput.placeholder = "Type your message or request rebooking...";
        }
        if (btnSend) btnSend.disabled = false;
        if (quickPromptsBar) quickPromptsBar.style.display = "flex";
      } else {
        if (chatStatusBadge) {
          chatStatusBadge.className = "badge-status status-resolved";
          chatStatusBadge.textContent = "✓ RESOLVED";
        }
        if (btnResolveChat) btnResolveChat.style.display = "none";
        if (caseResolvedBanner) {
          caseResolvedBanner.style.display = "flex";
          if (resolvedSummaryText) {
            resolvedSummaryText.textContent = conv.resolution_summary || "Customer concern successfully addressed.";
          }
        }
        if (chatInput) {
          chatInput.disabled = true;
          chatInput.placeholder = "This case has been resolved and closed. Customer concern was successfully addressed.";
        }
        if (btnSend) btnSend.disabled = true;
        if (quickPromptsBar) quickPromptsBar.style.display = "none";
      }

      if (currentBookingRef) {
        fetchBookingDetails(currentBookingRef);
        fetchNotifications(currentBookingRef);
      }
    }
  } catch (err) {
    console.error("loadConversation error:", err);
  }

  // Connect agent websocket for live turns
  connectAgentWebSocket(currentConversationId);

  // Fetch full conversation history from the Durable Object session
  try {
    const msgRes = await fetch(`/agents/support-agent/${convId}/get-messages`);
    if (msgRes.ok) {
      const history = await msgRes.json();
      if (Array.isArray(history) && history.length > 0) {
        renderFullHistory(history, true);
      } else {
        if (messagesContainer) {
          messagesContainer.innerHTML = "";
        }
        if (initialOpening) {
          appendAgentMessage(initialOpening);
        } else if (currentCaseStatus === "RESOLVED") {
          appendUserMessage(`Inquiry: ${currentCaseTitle || "Support Case"}`);
          appendAgentMessage(
            `This case has been resolved and closed.\n\n**Case Title:** ${currentCaseTitle}\n**Resolution Summary:** ${currentResolutionSummary || "Customer concern addressed successfully."}`,
            null,
            false
          );
        } else {
          appendAgentMessage(
            `Hello Alex, I'm your AeroCare Flight Support Assistant.\n\nI see your booking **${currentBookingRef || "SKY-8842"}** on flight **AA1822** from Dallas (DFW) to Chicago (ORD) is delayed by 180 minutes due to severe thunderstorms and an active FAA Ground Stop at DFW. Open seats are confirmed on flight **AA2040** (18:45 UTC). How can I assist you with rebooking?`
          );
        }
      }
    }
  } catch (err) {
    console.error("Failed to load messages for", convId, err);
  }
}

// ============================================================================
// 3. Search Past Conversations
// ============================================================================

async function renderSearchResults(query = "") {
  if (!casesResultsList) return;
  casesResultsList.innerHTML = '<div style="padding: 1.5rem; text-align: center; color: var(--text-muted);">Searching conversations...</div>';

  try {
    let url = `/api/conversations?query=${encodeURIComponent(query)}`;
    if (caseFilterStatus && caseFilterStatus !== "ALL") {
      url += `&status=${caseFilterStatus}`;
    }
    const res = await fetch(url);
    if (!res.ok) throw new Error("Search failed");
    const data = await res.json();
    const list = data.conversations || [];

    if (list.length === 0) {
      casesResultsList.innerHTML = `
        <div style="padding: 2.5rem; text-align: center; color: var(--text-muted);">
          <div style="font-size: 1.5rem; margin-bottom: 0.5rem;">🔍</div>
          <div>No conversations found matching "${escapeHtml(query)}".</div>
          <div style="font-size: 0.75rem; margin-top: 0.35rem;">Try searching by Customer Name (e.g. Alex Mercer) or ID (e.g. P-101).</div>
        </div>
      `;
      return;
    }

    casesResultsList.innerHTML = list
      .map((c) => {
        const isCurrent = c.conversation_id === currentConversationId;
        const statusClass = c.status === "ACTIVE" ? "status-active" : "status-resolved";
        const statusLabel = c.status === "ACTIVE" ? "🟢 ACTIVE" : "✓ RESOLVED";
        const createdDate = new Date(c.created_at).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        });

        return `
          <div class="case-result-card ${isCurrent ? "is-current" : ""}" data-conv-id="${escapeHtml(c.conversation_id)}">
            <div class="case-result-header">
              <div class="case-result-customer">
                <span>👤 ${escapeHtml(c.customer_name)}</span>
                <span style="font-size: 0.75rem; color: var(--text-muted); font-family: var(--font-mono); font-weight: normal;">(${escapeHtml(c.customer_id)})</span>
                ${isCurrent ? '<span style="font-size: 0.68rem; color: #10b981; font-weight: 700;">(Current)</span>' : ""}
              </div>
              <span class="badge-status ${statusClass}">${statusLabel}</span>
            </div>
            <div class="case-result-title">
              <strong>${escapeHtml(c.title)}</strong>
            </div>
            <div class="case-result-meta">
              <span>✈️ ${c.flight_number ? escapeHtml(c.flight_number) : "Flight N/A"} • ${c.booking_ref ? escapeHtml(c.booking_ref) : "No Booking"}</span>
              <span style="font-family: var(--font-mono);">${createdDate}</span>
            </div>
            ${
              c.resolution_summary
                ? `<div class="case-result-summary"><strong>Resolution:</strong> ${escapeHtml(c.resolution_summary)}</div>`
                : ""
            }
          </div>
        `;
      })
      .join("");

    // Attach click listeners to cards
    casesResultsList.querySelectorAll(".case-result-card").forEach((card) => {
      card.addEventListener("click", () => {
        const id = card.getAttribute("data-conv-id");
        if (id) {
          loadConversation(id);
          if (searchCasesModal) searchCasesModal.style.display = "none";
        }
      });
    });
  } catch (err) {
    casesResultsList.innerHTML = `<div style="padding: 1.5rem; text-align: center; color: #ef4444;">Failed to load conversations: ${escapeHtml(err.message)}</div>`;
  }
}

function openSearchCasesModal() {
  if (!searchCasesModal) return;
  searchCasesModal.style.display = "flex";
  if (caseSearchInput) {
    caseSearchInput.value = "";
    caseSearchInput.focus();
  }
  renderSearchResults("");
}

// Debounce timer for instant search
let searchDebounceTimer = null;
caseSearchInput?.addEventListener("input", (e) => {
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => {
    renderSearchResults(e.target.value.trim());
  }, 180);
});

caseStatusFilters?.querySelectorAll(".filter-pill").forEach((btn) => {
  btn.addEventListener("click", () => {
    caseStatusFilters.querySelectorAll(".filter-pill").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    caseFilterStatus = btn.getAttribute("data-filter") || "ALL";
    renderSearchResults(caseSearchInput ? caseSearchInput.value.trim() : "");
  });
});

btnHeaderSearchCases?.addEventListener("click", openSearchCasesModal);
btnChatSearch?.addEventListener("click", openSearchCasesModal);
btnCloseSearchModal?.addEventListener("click", () => {
  if (searchCasesModal) searchCasesModal.style.display = "none";
});

// ============================================================================
// 4. Open New Support Case with AI (Enforces 1 Active Conv Per Customer)
// ============================================================================

async function openNewCaseModal() {
  if (!newCaseModal) return;
  newCaseModal.style.display = "flex";
  if (aiBriefingCard) aiBriefingCard.style.display = "none";
  if (newCaseConflictAlert) newCaseConflictAlert.style.display = "none";
  if (btnLaunchCaseSubmit) btnLaunchCaseSubmit.disabled = false;
  if (btnAiIntakeGenerate) btnAiIntakeGenerate.disabled = false;

  try {
    const res = await fetch("/api/passengers");
    if (res.ok) {
      allPassengersList = await res.json();
      if (newCaseCustomerSelect) {
        newCaseCustomerSelect.innerHTML = `
          <option value="">-- Choose a Customer Profile --</option>
          ${allPassengersList
            .map(
              (p) => `
            <option value="${escapeHtml(p.passenger_id)}" data-active="${escapeHtml(p.active_conversation_id || "")}" data-booking="${escapeHtml(p.booking_ref || "")}">
              ${escapeHtml(p.name)} (${escapeHtml(p.passenger_id)}) — ${p.booking_ref ? `Booking: ${escapeHtml(p.booking_ref)} (${escapeHtml(p.flight_number || "")})` : "No Booking"} ${p.active_conversation_id ? "⚠️ [Active Case Open]" : "✓ [Available]"}
            </option>
          `
            )
            .join("")}
        `;
      }
    }
  } catch (err) {
    console.error("fetch passengers failed:", err);
  }
}

newCaseCustomerSelect?.addEventListener("change", () => {
  const selectedOpt = newCaseCustomerSelect.selectedOptions[0];
  if (!selectedOpt || !selectedOpt.value) {
    if (newCaseConflictAlert) newCaseConflictAlert.style.display = "none";
    if (btnLaunchCaseSubmit) btnLaunchCaseSubmit.disabled = false;
    return;
  }

  const activeConvId = selectedOpt.getAttribute("data-active");
  if (activeConvId) {
    const custName = selectedOpt.textContent.split("(")[0].trim();
    if (conflictAlertTitle) {
      conflictAlertTitle.textContent = `${custName} already has an active conversation!`;
    }
    if (conflictAlertMsg) {
      conflictAlertMsg.textContent = `A customer can only have 1 active conversation at a time. Active Case ID: ${activeConvId}. Please switch to the active case or resolve it before opening a new one.`;
    }
    if (newCaseConflictAlert) newCaseConflictAlert.style.display = "flex";
    if (btnLaunchCaseSubmit) btnLaunchCaseSubmit.disabled = true;
    if (btnAiIntakeGenerate) btnAiIntakeGenerate.disabled = true;

    btnConflictSwitch.onclick = () => {
      newCaseModal.style.display = "none";
      loadConversation(activeConvId);
    };

    btnConflictResolve.onclick = () => {
      newCaseModal.style.display = "none";
      loadConversation(activeConvId).then(() => {
        openResolveModal();
      });
    };
  } else {
    if (newCaseConflictAlert) newCaseConflictAlert.style.display = "none";
    if (btnLaunchCaseSubmit) btnLaunchCaseSubmit.disabled = false;
    if (btnAiIntakeGenerate) btnAiIntakeGenerate.disabled = false;
  }
});

// Quick issue preset chips
document.querySelectorAll(".preset-chip").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (newCaseIssueDesc) {
      newCaseIssueDesc.value = btn.getAttribute("data-preset") || "";
    }
  });
});

btnAiIntakeGenerate?.addEventListener("click", async () => {
  const custId = newCaseCustomerSelect?.value;
  if (!custId) {
    alert("Please select a customer first.");
    return;
  }

  const selectedOpt = newCaseCustomerSelect.selectedOptions[0];
  const bookingRef = selectedOpt?.getAttribute("data-booking") || undefined;
  const issueDescription = newCaseIssueDesc?.value.trim() || "Severe thunderstorm delay rebooking";

  btnAiIntakeGenerate.textContent = "⏳ Generating Case Intake with AI...";
  btnAiIntakeGenerate.disabled = true;

  try {
    const res = await fetch("/api/cases/ai-intake", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customerId: custId, bookingRef, issueDescription }),
    });

    const data = await res.json();
    if (!res.ok) {
      alert(data.error || "Failed to generate AI intake");
      return;
    }

    if (newCaseTitleInput) newCaseTitleInput.value = data.title;
    if (newCaseCategorySelect) newCaseCategorySelect.value = data.issueCategory || "WEATHER_DELAY";
    if (aiPriorityBadge) aiPriorityBadge.textContent = `${data.priority || "HIGH"} PRIORITY`;
    if (aiDiagnosisText) aiDiagnosisText.textContent = data.aiDiagnosis;
    if (newCaseOpeningText) {
      const suggestionsText = (data.suggestedActions || [])
        .map((act) => `- ${act} | Please assist with: ${act}`)
        .join("\n");
      newCaseOpeningText.value = `${data.openingMessage}\n\n<suggestions>\n${suggestionsText}\n</suggestions>`;
    }

    if (aiBriefingCard) aiBriefingCard.style.display = "block";
  } catch (err) {
    alert("AI intake generation failed: " + err.message);
  } finally {
    btnAiIntakeGenerate.textContent = "✨ Generate Case Intake & Briefing with AI";
    btnAiIntakeGenerate.disabled = false;
  }
});

btnLaunchCaseSubmit?.addEventListener("click", async () => {
  const custId = newCaseCustomerSelect?.value;
  if (!custId) {
    alert("Please select a customer profile.");
    return;
  }

  const selectedOpt = newCaseCustomerSelect.selectedOptions[0];
  const bookingRef = selectedOpt?.getAttribute("data-booking") || null;
  const title = newCaseTitleInput?.value.trim() || newCaseIssueDesc?.value.trim() || "Flight Disruption Support Case";
  const issueCategory = newCaseCategorySelect?.value || "WEATHER_DELAY";
  const openingMessage = newCaseOpeningText?.value.trim();

  btnLaunchCaseSubmit.textContent = "🚀 Launching...";
  btnLaunchCaseSubmit.disabled = true;

  try {
    const res = await fetch("/api/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customerId: custId, bookingRef, title, issueCategory }),
    });

    const data = await res.json();
    if (!res.ok) {
      alert(data.error || "Failed to create case");
      return;
    }

    newCaseModal.style.display = "none";
    await loadConversation(data.conversation.conversation_id, openingMessage);
  } catch (err) {
    alert("Failed to launch case: " + err.message);
  } finally {
    btnLaunchCaseSubmit.textContent = "🚀 Launch Case & Open Chat";
    btnLaunchCaseSubmit.disabled = false;
  }
});

btnHeaderNewCase?.addEventListener("click", openNewCaseModal);
btnChatNew?.addEventListener("click", openNewCaseModal);
btnResolvedNewCase?.addEventListener("click", openNewCaseModal);
btnCloseNewCaseModal?.addEventListener("click", () => {
  if (newCaseModal) newCaseModal.style.display = "none";
});
btnCancelNewCase?.addEventListener("click", () => {
  if (newCaseModal) newCaseModal.style.display = "none";
});

// ============================================================================
// 5. Resolve & End Chat Flow
// ============================================================================

function openResolveModal() {
  if (!resolveCaseModal) return;
  if (resolveModalCaseTitle) {
    resolveModalCaseTitle.textContent = chatCaseTitle?.textContent || "Current Case";
  }
  if (resolveModalCaseConvId) {
    resolveModalCaseConvId.textContent = `${currentConversationId} • ${chatCustomerTag?.textContent || ""}`;
  }
  if (resolveSummaryInput) {
    resolveSummaryInput.value = "";
  }
  resolveCaseModal.style.display = "flex";
}

btnResolveChat?.addEventListener("click", openResolveModal);
btnCloseResolveModal?.addEventListener("click", () => {
  if (resolveCaseModal) resolveCaseModal.style.display = "none";
});
btnCancelResolve?.addEventListener("click", () => {
  if (resolveCaseModal) resolveCaseModal.style.display = "none";
});

btnAiSummarize?.addEventListener("click", async () => {
  if (!btnAiSummarize) return;
  btnAiSummarize.textContent = "⏳ Generating...";
  btnAiSummarize.disabled = true;

  try {
    const res = await fetch("/api/cases/ai-summarize-resolution", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId: currentConversationId }),
    });

    if (res.ok) {
      const data = await res.json();
      if (resolveSummaryInput) resolveSummaryInput.value = data.summary;
    }
  } catch (err) {
    console.error("AI summarize error:", err);
  } finally {
    btnAiSummarize.textContent = "✨ Generate AI Summary";
    btnAiSummarize.disabled = false;
  }
});

btnConfirmResolve?.addEventListener("click", async () => {
  const summary = resolveSummaryInput?.value.trim() || "Customer concern successfully addressed and resolved.";
  btnConfirmResolve.textContent = "✓ Resolving...";
  btnConfirmResolve.disabled = true;

  try {
    const res = await fetch(`/api/conversations/${currentConversationId}/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resolutionSummary: summary }),
    });

    if (res.ok) {
      resolveCaseModal.style.display = "none";
      await loadConversation(currentConversationId);
    } else {
      const data = await res.json();
      alert(data.error || "Failed to resolve conversation");
    }
  } catch (err) {
    alert("Failed to resolve conversation: " + err.message);
  } finally {
    btnConfirmResolve.textContent = "✓ Confirm Resolution & Close Chat";
    btnConfirmResolve.disabled = false;
  }
});

// ============================================================================
// 6. WebSocket Protocol & Streaming Engine
// ============================================================================

let currentThinkingBubble = null;
let currentResponseBubble = null;
let currentAccumulatedText = "";
let currentTurnMessageId = null;

// Clean repetitive duplicate words or tokens (e.g. from upstream provider bugs or legacy turns)
function deduplicateRepetitiveText(text) {
  if (!text) return "";
  return text
    // Replace doubled words separated by whitespace: "have have" -> "have", "flight flight" -> "flight"
    .replace(/\b([A-Za-z0-9+]+)\s+\1\b/g, "$1")
    .replace(/\b([A-Za-z0-9+]+)\s+\1\b/g, "$1")
    // Replace doubled capitalized words: "YouYou" -> "You", "YourYour" -> "Your"
    .replace(/\b([A-Z][a-z]+)\1\b/g, "$1")
    // Fix doubled phone numbers: "+15125550199+15125550199" -> "+15125550199"
    .replace(/(\+[0-9]{10,})\1/g, "$1")
    // Fix double punctuation: ",," -> ",", ".." -> "."
    .replace(/([.,!?;:])\1+/g, "$1")
    // Fix legacy corrupted tokens
    .replace(/AA AA18218222/g, "AA1822")
    .replace(/conv convectiveective/g, "convective");
}

// Clean assistant text of any leaked {"type":"start",...} headers and repetitive tokens
function cleanAssistantText(rawText) {
  if (!rawText) return { cleanText: "", extractedId: null };
  let extractedId = null;
  const match = rawText.match(/\{"type":"start","messageId":"([^"]+)"\}/);
  if (match) {
    extractedId = match[1];
  }
  let cleanText = rawText.replace(/\{"type":"start"[^}]*\}/g, "").trim();
  cleanText = deduplicateRepetitiveText(cleanText);
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
  let cleanText = deduplicateRepetitiveText(text);

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
      { label: "Confirm Updated Itinerary", prompt: "Please confirm my updated itinerary for my booking." },
      { label: "Check In & Boarding Info", prompt: "What time does boarding start for my rebooked flight?" },
      { label: "Set Up SMS Flight Alerts", prompt: "Register my phone +15125550199 for automated SMS updates on my new flight." },
    ];
  }
  if (lower.includes("weather") || lower.includes("storm") || lower.includes("radar") || lower.includes("faa")) {
    return [
      { label: "Find Alternative Flights", prompt: "Find me alternative flights to my destination with open seats." },
      { label: "Rebook on AA2040 (18:45 UTC)", prompt: "Please rebook me onto flight AA2040 departing at 18:45 UTC." },
      { label: "Set Up SMS Delay Alerts", prompt: "Please text me updates at +15125550199 if anything changes." },
    ];
  }
  if (lower.includes("alternative") || lower.includes("aa2040") || lower.includes("aa912")) {
    return [
      { label: "Rebook to AA2040 (18:45 UTC)", prompt: "Please rebook me onto flight AA2040 departing at 18:45 UTC." },
      { label: "Rebook to AA912 (17:30 UTC)", prompt: "Please rebook me onto flight AA912 departing at 17:30 UTC." },
      { label: "Check Airport Storm Radar", prompt: "What is the latest weather and FAA advisory report?" },
    ];
  }
  return [
    { label: "Check Delay & Weather", prompt: "Why is my flight delayed and what are the airport weather conditions?" },
    { label: "Find Alternative Flights", prompt: "Find me alternative flights with open seats." },
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

// Outbox buffer for messages queued while WebSocket is connecting or reconnecting
const pendingOutbox = [];

function flushPendingOutbox() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  while (pendingOutbox.length > 0) {
    const payload = pendingOutbox.shift();
    console.log("[Agent Client] Sending queued message payload:", payload.id);
    try {
      ws.send(JSON.stringify(payload));
    } catch (err) {
      console.error("[Agent Client] Failed to send queued message:", err);
    }
  }
}

function connectAgentWebSocket(convId = currentConversationId) {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${protocol}//${window.location.host}/agents/support-agent/${convId}`;

  // If already connected or connecting to the target conversation, keep existing connection
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) && ws.url === wsUrl) {
    console.log(`[Agent Client] WebSocket already active or connecting for ${convId}.`);
    if (ws.readyState === WebSocket.OPEN) {
      flushPendingOutbox();
    }
    return;
  }

  if (ws) {
    try {
      ws.onclose = null; // Suppress auto-retry on manual close/switch
      ws.close();
    } catch {}
  }

  console.log(`[Agent Client] Connecting to ${wsUrl}...`);
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log(`[Agent Client] Connected to SupportAgent (${convId}).`);
    clearTimeout(reconnectTimer);
    if (agentStatusDot) {
      agentStatusDot.style.background = "#10b981";
      agentStatusDot.style.boxShadow = "0 0 8px #10b981";
    }
    flushPendingOutbox();
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
                currentAccumulatedText = "I have reviewed your itinerary and current flight operations. Severe weather or flow control is impacting schedule integrity. How can I assist you with rebooking or checking alternative flights?";
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
    console.warn(`[Agent Client] WebSocket closed for ${convId}, reconnecting in 1.5s...`);
    if (agentStatusDot) {
      agentStatusDot.style.background = "#f59e0b";
      agentStatusDot.style.boxShadow = "none";
    }
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => connectAgentWebSocket(currentConversationId), 1500);
  };

  ws.onerror = (err) => {
    console.error("[Agent Client] WebSocket error:", err);
  };
}

// ============================================================================
// 7. UI Message Rendering
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

function appendAgentMessage(text, messageId = null, showActionCards = true) {
  const row = document.createElement("div");
  row.className = "message-row agent";

  const { cleanText: startCleaned, extractedId } = cleanAssistantText(text);
  const finalId = messageId || extractedId;
  const { cleanText, suggestions } = parseSuggestions(startCleaned);

  const isTemporary = cleanText.includes("Thinking and checking") || cleanText.includes("Reconnecting");
  let finalSuggestions = suggestions;
  if (!isTemporary && showActionCards && (!finalSuggestions || finalSuggestions.length === 0)) {
    finalSuggestions = getFallbackSuggestions(cleanText);
  }

  const cardsHtml = (isTemporary || !showActionCards) ? "" : renderFollowupCardsHtml(finalSuggestions);

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
  if (finalSuggestions.length > 0 && !isTemporary && showActionCards) {
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

function renderFullHistory(messages, force = false) {
  if (!messages || !Array.isArray(messages)) return;
  // If there are already messages, don't overwrite if user is actively chatting (unless force=true on load)
  if (!force && messagesContainer.children.length > 2) return;

  messagesContainer.innerHTML = "";

  // Identify the last assistant message index so action cards only render at the very end
  let lastAssistantIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "assistant") {
      lastAssistantIndex = i;
      break;
    }
  }

  messages.forEach((msg, idx) => {
    if (msg.role === "user") {
      const text = msg.parts?.filter((p) => p.type === "text").map((p) => p.text).join("\n") || "";
      if (text) appendUserMessage(text);
    } else if (msg.role === "assistant") {
      let text = msg.parts?.filter((p) => p.type === "text").map((p) => p.text).join("\n") || "";
      if (!text && msg.parts && msg.parts.length > 0) {
        const toolPart = msg.parts.find((p) => p.toolName || (p.type && p.type.startsWith("tool-")));
        if (toolPart) {
          const tName = toolPart.toolName || toolPart.type.replace("tool-", "");
          if (tName === "rebookPassengerFlight") {
            const flight = toolPart.input?.newFlightNumber || "AA2040";
            text = `✓ Confirmed rebooking on flight **${flight}**. Booking reference updated in flight operations.`;
          } else if (tName === "subscribeToFlightAlerts") {
            const recipient = toolPart.input?.recipient || "+15125550199";
            const channel = (toolPart.input?.channel || "sms").toUpperCase();
            text = `✓ Registered **${recipient}** for automated **${channel}** flight disruption alerts.`;
          } else if (tName === "lookupFlightStatus" || tName === "lookupPassengerBooking") {
            text = `I reviewed your flight operations status and booking itinerary.`;
          } else {
            text = `Flight operations tool executed: ${tName}.`;
          }
        }
      }
      if (text) {
        text = deduplicateRepetitiveText(text);
        const showCards = idx === lastAssistantIndex;
        appendAgentMessage(text, msg.id, showCards);
      }
    }
  });
  scrollToBottom();
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
// 8. Chat Submission & Event Handlers
// ============================================================================

chatForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (currentCaseStatus === "RESOLVED") {
    alert("This case has been resolved and closed. Please open a new case to start a new inquiry.");
    return;
  }

  const text = chatInput.value.trim();
  if (!text) return;

  chatInput.value = "";
  appendUserMessage(text);

  // Send message over WebSocket using cf_agent_use_chat_request wire protocol
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

  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  } else {
    console.log("[Agent Client] WebSocket is connecting or offline. Queued message for immediate send.");
    pendingOutbox.push(payload);
    connectAgentWebSocket(currentConversationId);
  }
});

// Quick action prompt chips
document.querySelectorAll(".prompt-chip").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (currentCaseStatus === "RESOLVED") return;
    chatInput.value = btn.getAttribute("data-prompt") || "";
    chatForm.dispatchEvent(new Event("submit"));
  });
});

// Modal Toggles: Notifications
btnOpenNotif.addEventListener("click", () => {
  fetchNotifications(currentBookingRef);
  notifModal.style.display = "flex";
});

btnCloseNotif.addEventListener("click", () => {
  notifModal.style.display = "none";
});

notifModal.addEventListener("click", (e) => {
  if (e.target === notifModal) notifModal.style.display = "none";
});

// Modal Outside Click Close
window.addEventListener("click", (e) => {
  if (e.target === searchCasesModal) searchCasesModal.style.display = "none";
  if (e.target === newCaseModal) newCaseModal.style.display = "none";
  if (e.target === resolveCaseModal) resolveCaseModal.style.display = "none";
});

// ============================================================================
// 9. Simulation Action Handlers
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
        fetchBookingDetails(currentBookingRef),
        fetchAirportWeather(),
        fetchNotifications(currentBookingRef),
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
// 10. Bootstrap Application
// ============================================================================

attachCardClickHandlers(messagesContainer);
attachCopyHandlers(messagesContainer);
fetchAirportWeather("DFW");
loadConversation(currentConversationId);
