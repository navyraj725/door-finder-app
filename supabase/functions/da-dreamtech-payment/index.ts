import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const DA_DREAMTECH_BASE_URL = "https://www.dadreamtech.com";

const SUBSCRIPTION_PLAN_DAYS: Record<string, number> = {
  monthly: 30,
  six_month: 180,
  premium_6mo: 180,
  annual: 365,
  premium_1yr: 365,
};

const FEATURED_DURATIONS = [7, 30];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const merchantKey = Deno.env.get("DA_DREAMTECH_MERCHANT_KEY") || "";
    const apiKey = Deno.env.get("DA_DREAMTECH_API_KEY") || "";
    const clientSecret = Deno.env.get("DA_DREAMTECH_CLIENT_SECRET") || "";
    const environment = Deno.env.get("DA_DREAMTECH_ENVIRONMENT") || "sandbox";

    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const body = await req.json();
    const {
      amount, plan_type, property_id, duration_days, type, payment_method,
      phone, account, card_last4,
    } = body;

    // Identify the caller from the JWT instead of trusting the request body
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const { data: authData, error: authError } = await supabase.auth.getUser(token);
    if (authError || !authData.user) {
      return new Response(
        JSON.stringify({ error: "You must be signed in to make a payment." }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const user_id = authData.user.id;
    const user_email = authData.user.email || "";
    const user_name = (authData.user.user_metadata?.full_name as string) || "";

    if (type != null && type !== "subscription" && type !== "featured") {
      return json({ error: "Invalid payment type." }, 400);
    }
    const paymentType = type === "featured" ? "featured" : "subscription";

    // Prices are stored server-side; reject tampered amounts
    const { data: settings, error: settingsError } = await supabase
      .from("admin_settings")
      .select("*")
      .limit(1)
      .maybeSingle();

    if (settingsError || !settings) {
      return json({ error: "Pricing is not configured. Please try again later." }, 503);
    }

    let expectedAmount: number;
    let durationDays: number | null = null;

    if (paymentType === "featured") {
      const days = Number(duration_days);
      if (!FEATURED_DURATIONS.includes(days)) {
        return json({ error: "Featured listings are only available for 7 or 30 days." }, 400);
      }
      if (!property_id) {
        return json({ error: "A listing is required to feature it." }, 400);
      }

      const { data: property } = await supabase
        .from("properties")
        .select("id")
        .eq("id", property_id)
        .eq("user_id", user_id)
        .maybeSingle();

      if (!property) {
        return json({ error: "You can only feature your own listings." }, 403);
      }

      expectedAmount = days === 7
        ? Number(settings.featured_7d_price)
        : Number(settings.featured_30d_price);
      durationDays = days;
    } else {
      if (!plan_type || plan_type === "free" || !SUBSCRIPTION_PLAN_DAYS[plan_type]) {
        return json({ error: "Invalid subscription plan." }, 400);
      }

      const priceByPlan: Record<string, number> = {
        monthly: Number(settings.monthly_price),
        six_month: Number(settings.six_month_price),
        annual: Number(settings.annual_price),
        premium_6mo: Number(settings.premium_6mo_price),
        premium_1yr: Number(settings.premium_1yr_price),
      };
      expectedAmount = priceByPlan[plan_type];
    }

    if (!Number.isFinite(expectedAmount) || expectedAmount <= 0) {
      return json({ error: "This plan is not available right now. Please refresh and try again." }, 400);
    }
    if (!Number.isFinite(Number(amount)) || Number(amount) !== expectedAmount) {
      return json(
        { error: "Amount does not match the configured price. Please refresh and try again." },
        400,
      );
    }

    const refTrx = `DF_${paymentType}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    const description = paymentType === "featured"
      ? `Featured listing ${durationDays} days`
      : plan_type === "premium_6mo"
      ? "Premium Subscription 6 Months"
      : plan_type === "premium_1yr"
      ? "Premium Subscription 1 Year"
      : plan_type === "six_month"
      ? "Subscription Payment 6 Months"
      : plan_type === "annual"
      ? "Subscription Payment 1 Year"
      : "Subscription Payment 1 Month";

    const paymentRecord = {
      user_id,
      amount: expectedAmount,
      type: paymentType,
      reference: refTrx,
      network: payment_method || "da-dreamtech",
      status: "pending",
      plan_type: paymentType === "subscription" ? plan_type : (plan_type || "free"),
      property_id: paymentType === "featured" ? property_id : null,
      duration_days: durationDays,
    };

    async function recordPayment(status: string): Promise<string> {
      const { data, error } = await supabase
        .from("payments")
        .insert({ ...paymentRecord, status })
        .select("id")
        .single();
      if (error || !data) {
        throw new Error(error?.message || "Could not record the payment.");
      }
      return data.id as string;
    }

    // Build request body for DA DREAM-TECH — on-site payment (no redirect)
    const paymentBody: Record<string, unknown> = {
      payment_amount: expectedAmount,
      currency_code: "UGX",
      ref_trx: refTrx,
      description,
      customer_name: user_name || "",
      customer_email: user_email || "",
      customer_phone: phone || "",
      payment_method: payment_method || "",
      account_number: account || "",
      card_last4: card_last4 || "",
      // On-site mode — no redirects, process directly
      payment_mode: "onsite",
      ipn_url: `${supabaseUrl}/functions/v1/da-dreamtech-webhook`,
    };

    const methodMap: Record<string, string> = {
      mtn_momo: "mtn-momo",
      airtel_money: "airtel-money",
      stanbic_bank: "stanbic-bank",
      centenary_bank: "centenary-bank",
      dfcu_bank: "dfcu-bank",
      equity_bank: "equity-bank",
      postbank_uganda: "postbank-uganda",
      visa_card: "visa",
    };
    if (payment_method && methodMap[payment_method]) {
      paymentBody.allow_payment_methods = [methodMap[payment_method]];
    }

    const rawBody = JSON.stringify(paymentBody);

    // Generate signature
    const timestamp = Math.floor(Date.now() / 1000);
    const method = "POST";
    const pathWithQuery = "/api/v1/initiate-payment";
    const signaturePayload = `${timestamp}.${method}.${pathWithQuery}.${rawBody}`;

    let signature = "";
    if (clientSecret) {
      const encoder = new TextEncoder();
      const key = await crypto.subtle.importKey(
        "raw",
        encoder.encode(clientSecret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
      );
      const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(signaturePayload));
      signature = "sha256=" + Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Accept": "application/json",
      "X-Environment": environment,
      "X-Merchant-Key": merchantKey,
      "X-API-Key": apiKey,
      "X-Timestamp": timestamp.toString(),
    };
    if (signature) headers["X-Signature"] = signature;

    try {
      const response = await fetch(`${DA_DREAMTECH_BASE_URL}/api/v1/initiate-payment`, {
        method: "POST",
        headers,
        body: rawBody,
      });
      await response.json();

      if (!response.ok) {
        // DA DREAM-TECH API not available or credentials missing —
        // Record payment as pending for manual verification by DA DREAM-TECH
        await recordPayment("pending");
        return json({
          status: "pending",
          ref_trx: refTrx,
          message: "Payment submitted for verification by DA DREAM-TECH. Account will activate automatically after confirmation.",
        });
      }
    } catch {
      // Network error calling DA DREAM-TECH — record as pending
      await recordPayment("pending");
      return json({
        status: "pending",
        ref_trx: refTrx,
        message: "Payment submitted for verification. Account will activate automatically after confirmation.",
      });
    }

    // DA DREAM-TECH responded. The synchronous initiate-payment response is
    // NOT authoritative proof of funds (sandbox returns "success" immediately
    // without any phone prompt), so the account must never be activated here.
    // The signed webhook (da-dreamtech-webhook) is the only automatic
    // activation path; admins can also verify manually in the dashboard.
    await recordPayment("pending");
    return json({
      status: "pending",
      ref_trx: refTrx,
      message: "Payment submitted. Approve the prompt on your phone; your account activates once DA DREAM-TECH confirms.",
    });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "Internal server error" }, 500);
  }
});
