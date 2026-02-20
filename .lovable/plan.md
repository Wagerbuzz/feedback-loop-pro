

## Remove Role-Based Differentiation

Strip out the role selection from signup and show all navigation items to every user. The role system stays in the database for future use, but the UI treats everyone equally.

### Changes

**1. Auth page (`src/pages/Auth.tsx`)**
- Remove the role selector UI (the 3-button grid for PM/CS/Exec)
- Remove the `role` state variable and `Role` type
- Remove `selected_role` from the signup metadata — just send `full_name`

**2. Sidebar (`src/components/AppSidebar.tsx`)**
- Remove the `roles` property from NAV_ITEMS — show all 5 nav items to every user
- Remove the role-based filtering logic (`visibleItems` filter)
- Remove the role badge from the sidebar footer

**3. Top bar (`src/components/TopBar.tsx`)**
- Remove the role badge display

**4. Auth context (`src/contexts/AuthContext.tsx`)**
- Keep `role` in the context type (for future use) but stop blocking on it
- Remove the role-insertion logic from `fetchUserData` that writes to `user_roles` on first login

### What stays unchanged
- The `user_roles` table and RLS policies remain in the database (no migration needed)
- The `AuthContext` still exposes `role` so it can be re-enabled later
- Profile creation trigger still works as before

