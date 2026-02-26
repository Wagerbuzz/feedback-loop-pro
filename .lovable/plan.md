

# Settings Page with Onboarding & Integrations Management

## Inspiration & Design Philosophy

**From Linear:** Settings as a left-nav sidebar layout with grouped sections (Account, Workspace, Integrations). Clean, minimal, keyboard-navigable. Settings accessed via a gear icon in the sidebar footer or via Cmd+K.

**From Unwrap:** Integrations page as a visual card grid showing available data sources (Zendesk, Intercom, Slack, CSV upload) with clear connect/disconnect states. Onboarding guided by a "connect your first source" prompt.

**Combined approach:** A Settings page that doubles as the integration hub and subtly guides new users through setup via a progress checklist.

---

## What We'll Build

### 1. Settings Page (`/settings`) with Tabbed Sections

A full-page settings view using a left sidebar nav (like Linear) with these sections:

- **Profile** -- Edit name, avatar initials. Uses existing `profiles` table.
- **Workspace** -- Workspace name, team info (read-only for now, placeholder for future).
- **Integrations** -- Card grid of available data sources (Zendesk, Intercom, Slack, CSV, API) with connect/disconnect toggle. Stores integration configs in a new `integrations` table.
- **Notifications** -- Toggle preferences for email digests, anomaly alerts, weekly summaries. Stores in a new `notification_preferences` table.

### 2. Onboarding Checklist Banner

A dismissible progress bar shown on the Dashboard for new users, with steps like:
1. Complete your profile
2. Connect your first data source
3. Review your first cluster
4. Create your first action

Each step links to the relevant page. Progress is tracked via a new `onboarding_progress` table.

### 3. Navigation Updates

- Add a Settings gear icon to the sidebar footer (next to user avatar), following Linear's pattern.
- Add Settings to the Cmd+K command palette.
- Clicking the user avatar area also navigates to Settings.

---

## Technical Details

### New Database Tables

**`integrations`**
| Column | Type | Default |
|---|---|---|
| id | uuid | gen_random_uuid() |
| user_id | uuid | NOT NULL |
| provider | text | NOT NULL (e.g. 'zendesk', 'intercom', 'slack', 'csv', 'api') |
| display_name | text | NOT NULL |
| config | jsonb | '{}' |
| status | text | 'disconnected' |
| connected_at | timestamptz | NULL |
| created_at | timestamptz | now() |

RLS: Users can CRUD their own integrations (`auth.uid() = user_id`).

**`notification_preferences`**
| Column | Type | Default |
|---|---|---|
| id | uuid | gen_random_uuid() |
| user_id | uuid | NOT NULL (unique) |
| email_digest | boolean | true |
| anomaly_alerts | boolean | true |
| weekly_summary | boolean | false |
| created_at | timestamptz | now() |

RLS: Users can CRUD their own preferences.

**`onboarding_progress`**
| Column | Type | Default |
|---|---|---|
| id | uuid | gen_random_uuid() |
| user_id | uuid | NOT NULL (unique) |
| profile_completed | boolean | false |
| source_connected | boolean | false |
| cluster_reviewed | boolean | false |
| action_created | boolean | false |
| dismissed | boolean | false |
| created_at | timestamptz | now() |

RLS: Users can CRUD their own progress.

### New Files

- **`src/pages/SettingsView.tsx`** -- Main settings page with left-nav tabs for Profile, Workspace, Integrations, Notifications.
- **`src/components/settings/ProfileSettings.tsx`** -- Edit name/initials form, updates `profiles` table.
- **`src/components/settings/WorkspaceSettings.tsx`** -- Placeholder workspace info.
- **`src/components/settings/IntegrationsSettings.tsx`** -- Card grid of integration providers with connect/configure/disconnect actions.
- **`src/components/settings/NotificationSettings.tsx`** -- Toggle switches for notification preferences.
- **`src/components/OnboardingChecklist.tsx`** -- Progress banner for Dashboard with step links.

### Modified Files

- **`src/App.tsx`** -- Add `/settings` route.
- **`src/components/AppSidebar.tsx`** -- Add Settings gear icon in footer area, link to `/settings`.
- **`src/components/CommandPalette.tsx`** -- Add "Settings" command.
- **`src/pages/DashboardView.tsx`** -- Include `OnboardingChecklist` at top.

### Integrations Card Grid Design

Each integration card shows:
- Provider icon/logo placeholder
- Provider name and short description
- Status badge (Connected / Disconnected)
- Connect or Configure button

Available providers (initially as UI stubs with the `integrations` table ready for real connections later):
- Zendesk (Support tickets)
- Intercom (Chat conversations)
- Slack (Team messages)
- CSV Upload (Manual import)
- REST API (Programmatic access)

### Onboarding Flow

When a new user signs up, the `handle_new_user` trigger will also seed an `onboarding_progress` row. The Dashboard shows a checklist banner until all steps are completed or the user dismisses it. Each step has a direct link:
- "Complete your profile" links to `/settings` (Profile tab)
- "Connect a data source" links to `/settings?tab=integrations`
- "Review a cluster" links to `/clusters`
- "Create an action" links to `/actions`

