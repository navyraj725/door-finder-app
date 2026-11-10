-- ============================================================
-- LIVE FIX (2026-11-10): paste this whole file into Supabase SQL Editor and Run.
-- Combines the two Nov 6 migrations that were never applied to the live project.
-- Safe to run more than once (idempotent).
-- ============================================================

/*
# Admin moderation, payment verification, and RLS hardening

## Problems fixed
1. Admins could not update or delete other users' listings: `properties`
   only had owner-scoped UPDATE/DELETE policies, so the admin dashboard
   actions silently failed.
2. Verifying a payment in the admin dashboard only changed its status; the
   subscription or featured listing was never activated.
3. `insert_scam_reports` allowed a user to submit a report as somebody else.
4. `reactivate_user_listings` / `refresh_subscription_state` accepted any
   user id, so any signed-in user could deactivate or reactivate another
   user's listings.
5. `insert_own_featured` did not check that the property belonged to the
   caller.

## Changes
- Admin UPDATE/DELETE policies on `properties`.
- `verify_payment(uuid)` — idempotent, admin/service-role-only function
  that marks the payment verified, activates the subscription, extends the
  user's listing expiry, re-activates hidden listings, and activates
  featured listings.
- Scam report INSERT restricted to `reporter_id = auth.uid()`.
- Ownership checks added to the subscription helper functions.
- Featured listing INSERT restricted to the caller's own properties.
*/

-- ============================================================
-- 1. Admin moderation policies for properties
-- ============================================================
DROP POLICY IF EXISTS "admin_update_properties" ON public.properties;
CREATE POLICY "admin_update_properties" ON public.properties FOR UPDATE
  TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "admin_delete_properties" ON public.properties;
CREATE POLICY "admin_delete_properties" ON public.properties FOR DELETE
  TO authenticated USING (public.is_admin());

-- ============================================================
-- 2. Verify a payment and activate what it paid for
-- ============================================================
CREATE OR REPLACE FUNCTION public.verify_payment(p_payment_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pay public.payments%ROWTYPE;
  plan_days integer;
  sub_expiry timestamptz;
  feature_days integer;
  feature_expiry timestamptz;
BEGIN
  IF NOT (public.is_admin() OR auth.role() = 'service_role') THEN
    RAISE EXCEPTION 'Only admins can verify payments';
  END IF;

  SELECT * INTO pay
  FROM public.payments
  WHERE id = p_payment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment not found';
  END IF;

  -- Webhooks can retry; never activate twice
  IF pay.status = 'verified' THEN
    RETURN;
  END IF;

  UPDATE public.payments SET status = 'verified' WHERE id = pay.id;

  IF pay.type = 'subscription' AND pay.plan_type IS NOT NULL AND pay.plan_type <> 'free' THEN
    plan_days := CASE pay.plan_type
      WHEN 'monthly' THEN 30
      WHEN 'six_month' THEN 180
      WHEN 'premium_6mo' THEN 180
      WHEN 'annual' THEN 365
      WHEN 'premium_1yr' THEN 365
      ELSE 30
    END;
    sub_expiry := now() + make_interval(days => plan_days);

    UPDATE public.subscriptions
      SET status = 'expired'
      WHERE user_id = pay.user_id AND status = 'active';

    INSERT INTO public.subscriptions
      (user_id, plan_type, price_paid, start_date, expiry_date, status, payment_reference)
    VALUES
      (pay.user_id, pay.plan_type, pay.amount, now(), sub_expiry, 'active', pay.reference);

    -- Listings follow the subscription window and become visible again
    UPDATE public.properties
      SET is_active = true, expires_at = sub_expiry
      WHERE user_id = pay.user_id;
  END IF;

  IF pay.type = 'featured' AND pay.property_id IS NOT NULL THEN
    feature_days := COALESCE(NULLIF(pay.duration_days, 0), 7);
    feature_expiry := now() + make_interval(days => feature_days);

    INSERT INTO public.featured_listings
      (property_id, user_id, duration_days, price_paid, start_date, expiry_date, status, payment_reference)
    VALUES
      (pay.property_id, pay.user_id, feature_days, pay.amount, now(), feature_expiry, 'active', pay.reference);
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.verify_payment(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verify_payment(uuid) TO authenticated, service_role;

-- ============================================================
-- 3. Only the reporter may create their own report
-- ============================================================
DROP POLICY IF EXISTS "insert_scam_reports" ON public.scam_reports;
CREATE POLICY "insert_scam_reports" ON public.scam_reports FOR INSERT
  TO authenticated WITH CHECK (reporter_id = auth.uid());

-- ============================================================
-- 4. Subscription helpers only act on the caller (or an admin)
-- ============================================================
CREATE OR REPLACE FUNCTION public.refresh_subscription_state(p_user_id uuid)
RETURNS TABLE(plan_type text, status text, expiry_date timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  expired_count int;
BEGIN
  IF NOT (auth.uid() = p_user_id OR public.is_admin() OR auth.role() = 'service_role') THEN
    RAISE EXCEPTION 'Not allowed to refresh this subscription';
  END IF;

  UPDATE subscriptions
    SET status = 'expired'
    WHERE user_id = p_user_id
      AND status = 'active'
      AND expiry_date IS NOT NULL
      AND expiry_date < now();

  GET DIAGNOSTICS expired_count = ROW_COUNT;

  IF expired_count > 0 THEN
    UPDATE properties
      SET is_active = false
      WHERE user_id = p_user_id
        AND is_active = true;
  END IF;

  RETURN QUERY
    SELECT s.plan_type, s.status, s.expiry_date
    FROM subscriptions s
    WHERE s.user_id = p_user_id
    ORDER BY
      CASE WHEN s.status = 'active' THEN 0 ELSE 1 END,
      s.created_at DESC
    LIMIT 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.reactivate_user_listings(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (auth.uid() = p_user_id OR public.is_admin() OR auth.role() = 'service_role') THEN
    RAISE EXCEPTION 'Not allowed to reactivate these listings';
  END IF;

  UPDATE properties
    SET is_active = true
    WHERE user_id = p_user_id;
END;
$$;

-- ============================================================
-- 5. Featured listings must belong to the caller
-- ============================================================
DROP POLICY IF EXISTS "insert_own_featured" ON public.featured_listings;
CREATE POLICY "insert_own_featured" ON public.featured_listings FOR INSERT
  TO authenticated WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.properties p
      WHERE p.id = property_id AND p.user_id = auth.uid()
    )
  );


/*
# Restrict public reads to listings that are actually visible

## Problem
`public_select_properties`, `public_select_featured` and `public_read_admin_ads`
used `USING (true)`, so anyone holding the anon key could read unlisted,
suspended, expired listings, hidden ads, and every featured-listing payment
record (including reference and price paid).

## Changes
1. properties: public may read only rows that are active, available and not
   expired. Owners still read all their own rows; admins read everything.
2. featured_listings: public may read only active, non-expired rows. Owners
   keep access to their own rows; admins read everything.
3. admin_ads: public may read only active ads; admins read everything.

## Security
- No table structure changes.
- Permissive policies are replaced, not stacked (the old policies are dropped).
- `public.is_admin()` is SECURITY DEFINER and stable for anon (auth.uid() null).
*/

-- ============================================================
-- 1. Properties
-- ============================================================
DROP POLICY IF EXISTS "public_select_properties" ON public.properties;
CREATE POLICY "public_select_properties" ON public.properties FOR SELECT
  TO anon, authenticated
  USING (
    public.is_admin()
    OR auth.uid() = user_id
    OR (
      is_active = true
      AND status = 'available'
      AND (expires_at IS NULL OR expires_at > now())
    )
  );

-- ============================================================
-- 2. Featured listings
-- ============================================================
DROP POLICY IF EXISTS "public_select_featured" ON public.featured_listings;
CREATE POLICY "public_select_featured" ON public.featured_listings FOR SELECT
  TO anon, authenticated
  USING (
    public.is_admin()
    OR auth.uid() = user_id
    OR (
      status = 'active'
      AND (expiry_date IS NULL OR expiry_date > now())
    )
  );

-- ============================================================
-- 3. Admin ads
-- ============================================================
DROP POLICY IF EXISTS "public_read_admin_ads" ON public.admin_ads;
CREATE POLICY "public_read_admin_ads" ON public.admin_ads FOR SELECT
  TO anon, authenticated
  USING (public.is_admin() OR is_active = true);
