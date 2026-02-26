

# Brand Switcher and Company-Scoped Data

## Problem

All views (Inbox, Dashboard, Clusters, Actions, Roadmap) currently fetch data without filtering by company. Feedback collected for MongoDB shows alongside unrelated data. There's no way to switch between brands.

## Solution

Add a global "active company" context and a brand switcher in the sidebar. All data queries will be scoped to the selected company.

## Changes

### 1. New Context: `src/contexts/CompanyContext.tsx`

A React context that:
- Loads all companies for the current user from the `companies` table
- Stores the `activeCompany` (defaults to the first one, persisted in localStorage)
- Provides `setActiveCompany(id)` to switch brands
- Exposes `companies`, `activeCompany`, and `loading` state

### 2. Brand Switcher in Sidebar (`src/components/AppSidebar.tsx`)

- Add a dropdown in the sidebar header (replacing or below the "FeedbackFlow" logo area)
- Shows the active company name with a chevron
- Dropdown lists all companies the user has added
- Selecting one updates the context immediately
- When collapsed, shows the first letter/icon of the active company
- Include a "+ Add Company" link at the bottom that navigates to Settings > Integrations

### 3. Scope All Data Views

Every page that queries `feedback`, `clusters`, `actions`, or `roadmap` will filter by the active company's ID:

**InboxView** (`src/pages/InboxView.tsx`):
- Import `useCompany()` context
- Add `.eq('company_id', activeCompany.id)` to the feedback query
- Re-fetch when `activeCompany` changes

**DashboardView** (`src/pages/DashboardView.tsx`):
- Filter feedback, clusters, and actions by `company_id`
- Re-fetch on company switch

**ClustersView** (`src/pages/ClustersView.tsx`):
- Filter clusters by `company_id`
- Filter feedback-for-cluster query by `company_id`

**ActionsView** (`src/pages/ActionsView.tsx`):
- Filter actions by joining through clusters with matching `company_id`, or add `company_id` to the actions table

**RoadmapView** (`src/pages/RoadmapView.tsx`):
- Same approach as Actions

### 4. Database: Add `company_id` to `actions` and `roadmap` tables

These tables don't have a `company_id` column yet. Add it so they can be scoped:

```sql
ALTER TABLE public.actions ADD COLUMN company_id uuid REFERENCES public.companies(id);
ALTER TABLE public.roadmap ADD COLUMN company_id uuid REFERENCES public.companies(id);
```

### 5. Wire Context into App (`src/components/AppLayout.tsx`)

Wrap the layout children with `<CompanyProvider>` so all pages have access. Show an empty state if no companies exist yet, prompting the user to add one in Settings.

### 6. TopBar Update (`src/components/TopBar.tsx`)

Optionally show the active company name in the top bar subtitle for additional context.

## Files Summary

| File | Change |
|---|---|
| `src/contexts/CompanyContext.tsx` | New -- active company context |
| `src/components/AppSidebar.tsx` | Add brand switcher dropdown |
| `src/components/AppLayout.tsx` | Wrap with CompanyProvider |
| `src/pages/InboxView.tsx` | Filter by active company_id |
| `src/pages/DashboardView.tsx` | Filter by active company_id |
| `src/pages/ClustersView.tsx` | Filter by active company_id |
| `src/pages/ActionsView.tsx` | Filter by active company_id |
| `src/pages/RoadmapView.tsx` | Filter by active company_id |
| Database migration | Add company_id to actions and roadmap tables |

## Behavior

- On first login with no companies: all views show an empty state with "Add your first company in Settings"
- On first login with companies: auto-selects the first company
- Switching companies instantly re-fetches all visible data
- The selected company persists across page refreshes (localStorage)
- Adding a new company in Settings auto-selects it

