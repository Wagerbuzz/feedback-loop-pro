
## Fix: AuthContext Deadlock Causing Infinite Loading Spinner

### Root Cause (Confirmed)

The `AuthContext.tsx` has a **deadlock** in the auth initialization logic. The Supabase SDK's `onAuthStateChange` callback must not `await` Supabase database calls directly inside it — doing so creates a deadlock where the SDK waits for the callback to finish before proceeding, but the callback is waiting on the SDK. The result: `setLoading(false)` is never called, so the spinner spins forever.

This is confirmed by the network tab — **zero Supabase API calls** are being made after page load, meaning the auth listener is hanging.

### The Fix

Rewrite `AuthContext.tsx` following the correct pattern:

1. **Separate initial load from ongoing changes:**
   - Use `getSession()` to handle the initial auth check — this controls `loading` state
   - Use `onAuthStateChange` only for subsequent changes (sign in, sign out) — this does NOT control `loading`

2. **Avoid awaiting Supabase inside `onAuthStateChange`:**
   - Inside the listener, use `setTimeout(() => fetchUserData(...), 0)` to defer the DB call outside the callback's execution context, breaking the deadlock

3. **Always call `setLoading(false)` in a `finally` block** during initial load so it resolves regardless of success or failure

### Technical Implementation

**`src/contexts/AuthContext.tsx` — rewrite the `useEffect`:**

```
useEffect(() => {
  let isMounted = true;

  // Ongoing auth state changes (sign in/out after initial load)
  const { data: { subscription } } = supabase.auth.onAuthStateChange(
    (event, session) => {
      if (!isMounted) return;
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        // Use setTimeout to avoid deadlock — defers DB call outside the callback
        setTimeout(() => fetchUserData(session.user.id), 0);
      } else {
        setProfile(null);
        setRole(null);
      }
    }
  );

  // Initial load — controls the loading spinner
  const initializeAuth = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!isMounted) return;
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        await fetchUserData(session.user.id);
      }
    } finally {
      if (isMounted) setLoading(false);
    }
  };

  initializeAuth();

  return () => {
    isMounted = false;
    subscription.unsubscribe();
  };
}, []);
```

### What This Fixes

- Loading spinner resolves correctly whether user is logged in or not
- Sign-in redirects to `/inbox` immediately after auth
- Sign-out returns to `/auth` page
- All 5 nav items (Inbox, Clusters, Actions, Roadmap, Portal) are visible without any role filtering
- No role selector on the signup page — just name, email, and password

### Files Changed

- **`src/contexts/AuthContext.tsx`** — fix the `useEffect` initialization pattern (the only change needed)
