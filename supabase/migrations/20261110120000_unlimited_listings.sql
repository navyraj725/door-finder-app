/*
# Door Finder — Unlimited listings for every account

## Summary
Removes the free-plan cap of 1 active listing. Every authenticated user
(free or paid) may now create unlimited listings and upload unlimited
photos/videos per listing. The INSERT policy on properties still calls
user_can_create_listing(), so the gate stays in place — it now only checks
that the caller is signed in.

No data is deleted. Existing subscriptions, payments and listings are
untouched. Paid plans keep their priority placement / premium badge perks.
*/

CREATE OR REPLACE FUNCTION user_can_create_listing()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL;
$$;

REVOKE EXECUTE ON FUNCTION user_can_create_listing() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION user_can_create_listing() TO authenticated;