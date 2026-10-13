import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("Conversation & Case Management Rules", () => {
  interface MockConversation {
    conversation_id: string;
    customer_id: string;
    customer_name: string;
    booking_ref: string | null;
    title: string;
    status: "ACTIVE" | "RESOLVED";
    resolution_summary: string | null;
    created_at: string;
    resolved_at: string | null;
  }

  // In-memory test store simulating D1 database state and constraints
  const conversations: MockConversation[] = [
    {
      conversation_id: "conv_p101_active",
      customer_id: "P-101",
      customer_name: "Alex Mercer",
      booking_ref: "SKY-8842",
      title: "Flight AA1822 Weather Disruption Rebooking",
      status: "ACTIVE",
      resolution_summary: null,
      created_at: "2026-10-13T13:00:00Z",
      resolved_at: null,
    },
    {
      conversation_id: "conv_p101_past_01",
      customer_id: "P-101",
      customer_name: "Alex Mercer",
      booking_ref: "SKY-8842",
      title: "Checked Baggage Allowance & Sports Equipment Inquiry",
      status: "RESOLVED",
      resolution_summary: "Fee waiver confirmed for ski equipment.",
      created_at: "2026-09-12T08:30:00Z",
      resolved_at: "2026-09-12T08:45:00Z",
    },
    {
      conversation_id: "conv_p102_past_01",
      customer_id: "P-102",
      customer_name: "Elena Rostova",
      booking_ref: "SKY-1904",
      title: "Flight UA450 Preferred Seat Selection",
      status: "RESOLVED",
      resolution_summary: "Passenger assigned to seat 03A.",
      created_at: "2026-10-10T14:15:00Z",
      resolved_at: "2026-10-10T14:28:00Z",
    },
    {
      conversation_id: "conv_p103_past_01",
      customer_id: "P-103",
      customer_name: "Marcus Vance",
      booking_ref: "SKY-3301",
      title: "Special Inflight Meal Dietary Request",
      status: "RESOLVED",
      resolution_summary: "Gluten-free meal requested.",
      created_at: "2026-10-11T09:00:00Z",
      resolved_at: "2026-10-11T09:12:00Z",
    },
  ];

  function searchConversations(query?: string, status?: string) {
    return conversations.filter((c) => {
      if (status && status !== "ALL" && c.status !== status) return false;
      if (!query || !query.trim()) return true;
      const q = query.trim().toLowerCase();
      return (
        c.customer_name.toLowerCase().includes(q) ||
        c.customer_id.toLowerCase().includes(q) ||
        c.conversation_id.toLowerCase().includes(q) ||
        (c.booking_ref && c.booking_ref.toLowerCase().includes(q)) ||
        c.title.toLowerCase().includes(q)
      );
    });
  }

  function createConversation(data: {
    conversationId: string;
    customerId: string;
    customerName: string;
    bookingRef?: string;
    title: string;
  }) {
    // Constraint: A customer can only have 1 active conversation at a time
    const existingActive = conversations.find(
      (c) => c.customer_id === data.customerId && c.status === "ACTIVE"
    );
    if (existingActive) {
      return {
        success: false,
        error: `Customer ${data.customerName} already has an active conversation: "${existingActive.title}" (${existingActive.conversation_id}). A customer can only have 1 active conversation at a time.`,
        activeConversation: existingActive,
      };
    }

    const created: MockConversation = {
      conversation_id: data.conversationId,
      customer_id: data.customerId,
      customer_name: data.customerName,
      booking_ref: data.bookingRef || null,
      title: data.title,
      status: "ACTIVE",
      resolution_summary: null,
      created_at: new Date().toISOString(),
      resolved_at: null,
    };
    conversations.push(created);
    return { success: true, conversation: created };
  }

  function resolveConversation(conversationId: string, summary: string) {
    const target = conversations.find((c) => c.conversation_id === conversationId);
    if (!target) return { success: false, error: "Not found" };
    target.status = "RESOLVED";
    target.resolved_at = new Date().toISOString();
    target.resolution_summary = summary;
    return { success: true, conversation: target };
  }

  it("searches conversations by customer name", () => {
    const results = searchConversations("Alex Mercer");
    assert.equal(results.length, 2);
    assert.ok(results.every((r) => r.customer_name === "Alex Mercer"));
  });

  it("searches conversations by customer ID", () => {
    const results = searchConversations("P-102");
    assert.equal(results.length, 1);
    assert.equal(results[0].customer_name, "Elena Rostova");
    assert.equal(results[0].conversation_id, "conv_p102_past_01");
  });

  it("filters search results by status (ACTIVE vs RESOLVED)", () => {
    const activeResults = searchConversations("Alex", "ACTIVE");
    assert.equal(activeResults.length, 1);
    assert.equal(activeResults[0].conversation_id, "conv_p101_active");

    const resolvedResults = searchConversations("Alex", "RESOLVED");
    assert.equal(resolvedResults.length, 1);
    assert.equal(resolvedResults[0].conversation_id, "conv_p101_past_01");
  });

  it("strictly prevents opening a new case when customer already has an active conversation", () => {
    // P-101 (Alex Mercer) already has conv_p101_active with status = 'ACTIVE'
    const attempt = createConversation({
      conversationId: `conv_p101_${Date.now()}`,
      customerId: "P-101",
      customerName: "Alex Mercer",
      bookingRef: "SKY-8842",
      title: "Another flight change request",
    });

    assert.equal(attempt.success, false);
    assert.match(attempt.error!, /already has an active conversation/);
    assert.match(attempt.error!, /A customer can only have 1 active conversation at a time/);
  });

  it("allows opening a new case for a customer with only resolved conversations", () => {
    // P-102 (Elena Rostova) has 1 resolved case, 0 active cases
    const attempt = createConversation({
      conversationId: "conv_p102_new_active",
      customerId: "P-102",
      customerName: "Elena Rostova",
      bookingRef: "SKY-1904",
      title: "UA450 Gate Change Inquiry",
    });

    assert.equal(attempt.success, true);
    assert.equal(attempt.conversation?.status, "ACTIVE");
    assert.equal(attempt.conversation?.conversation_id, "conv_p102_new_active");
  });

  it("resolves and ends an active chat, permitting subsequent case creation", () => {
    // Resolve Alex Mercer's active case
    const resolveResult = resolveConversation(
      "conv_p101_active",
      "Customer successfully rebooked onto AA2040 (18:45 UTC). SMS alerts enabled."
    );

    assert.equal(resolveResult.success, true);
    assert.equal(resolveResult.conversation?.status, "RESOLVED");
    assert.ok(resolveResult.conversation?.resolved_at != null);
    assert.match(resolveResult.conversation?.resolution_summary!, /AA2040/);

    // Now that Alex Mercer has 0 active cases, opening a new case succeeds!
    const newCase = createConversation({
      conversationId: "conv_p101_brand_new",
      customerId: "P-101",
      customerName: "Alex Mercer",
      bookingRef: "SKY-8842",
      title: "Followup on Rebooked Seat Preference",
    });

    assert.equal(newCase.success, true);
    assert.equal(newCase.conversation?.status, "ACTIVE");
  });
});
