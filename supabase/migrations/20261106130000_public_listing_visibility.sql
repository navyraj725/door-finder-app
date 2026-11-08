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
