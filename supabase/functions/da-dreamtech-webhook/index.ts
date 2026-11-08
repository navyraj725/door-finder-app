import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const rawBody = await req.text();

    // When DA_DREAMTECH_WEBHOOK_SECRET is configured, only accept signed calls.
    const webhookSecret = Deno.env.get("DA_DREAMTECH_WEBHOOK_SECRET") || "";
    if (webhookSecret) {
      const provided = (req.headers.get("x-webhook-signature") || req.headers.get("x-signature") || "")
        .replace(/^sha256=/i, "")
        .toLowerCase();
      const key = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(webhookSecret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
      );
      const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
      const expected = Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
      if (!provided || !constantTimeEqual(provided, expected)) {
        return json({ error: "Invalid webhook signature" }, 401);
      }
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const payload = JSON.parse(rawBody);
    const data = payload?.data ?? payload;
    const status = payload?.status ?? data?.status;

    if (!data || !data.ref_trx) {
      return json({ error: "Invalid webhook payload" }, 400);
    }

    const refTrx = data.ref_trx;
    const paymentStatus = String(status || "").toLowerCase(); // "completed", "pending", "failed"

    // Find the payment record by reference
    const { data: payment, error: findErr } = await supabase
      .from("payments")
      .select("*")
      .eq("reference", refTrx)
      .maybeSingle();

    if (findErr || !payment) {
      return json({ error: "Payment not found" }, 404);
    }

    // Webhooks can be retried — do not activate twice
    if (payment.status === "verified") {
      return json({ received: true, status: paymentStatus, already_processed: true });
    }

    if (paymentStatus === "completed" || paymentStatus === "success" || paymentStatus === "successful") {
      // Marks the payment verified and activates the subscription /
      // featured listing plus listing visibility in one transaction.
      const { error: verifyError } = await supabase.rpc("verify_payment", {
        p_payment_id: payment.id,
      });
      if (verifyError) {
        return json({ error: verifyError.message }, 500);
      }
    } else if (paymentStatus === "failed" || paymentStatus === "cancelled" || paymentStatus === "declined") {
      const { error: declineError } = await supabase
        .from("payments")
        .update({ status: "declined" })
        .eq("id", payment.id);
      if (declineError) {
        return json({ error: declineError.message }, 500);
      }
    }

    return json({ received: true, status: paymentStatus });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "Internal server error" }, 500);
  }
});
