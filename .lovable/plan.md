
# Reorganize Settings and Improve Company Management

## Changes

### 1. Make "Tracked Companies" its own settings tab
Move CompanySetup out of Integrations and into a dedicated "Companies" tab in the settings sidebar. This gives it proper visibility as a core feature rather than being buried under integrations.

### 2. Remove the Profile tab
The Profile tab only has name/initials editing which isn't valuable enough to warrant its own section. Merge the profile fields (name, initials, email) into the top of the new default tab (Workspace or Companies).

### 3. Remove Twitter "requires API keys" label
The Twitter source checkbox currently shows "requires API keys" which is an internal concern, not something the user needs to see. Remove that warning -- Twitter should just appear as another source option like Web and Reddit.

### 4. Add delete company functionality
Add a delete button to each company card with a confirmation dialog. Deleting a company should also clean up associated feedback, clusters, actions, and roadmap items.

## Technical Details

### File: `src/pages/SettingsView.tsx`
- Remove the `profile` tab from the TABS array
- Add a new `companies` tab with a `Building2` icon
- Change default tab from `profile` to `companies`
- Import and render a new `CompaniesSettings` component (which is the existing `CompanySetup` with additions)
- Move profile fields (name, initials, email, save button) into the Workspace tab

### File: `src/components/settings/WorkspaceSettings.tsx`
- Merge in the profile editing form (name, initials, email) from ProfileSettings
- Keep existing workspace fields below

### File: `src/components/settings/ProfileSettings.tsx`
- Delete this file (merged into WorkspaceSettings)

### File: `src/components/settings/CompanySetup.tsx`
- Remove Twitter "requires API keys" warning from `SOURCE_OPTIONS` display
- Add a delete button (Trash2 icon) to each company card header
- Add an AlertDialog confirmation before deleting
- On delete: remove the company from `companies` table (cascade will handle feedback, clusters, etc. if foreign keys exist; otherwise manually delete associated data by `company_id`)
- After deletion, call `refetchCompanies()` from CompanyContext to update the sidebar brand switcher

### File: `src/components/settings/IntegrationsSettings.tsx`
- Remove the `<CompanySetup />` import and rendering -- it now lives under its own tab

### Database
- No schema changes needed. The `companies` table already has a DELETE RLS policy for the owner.
- Feedback, clusters, actions, and roadmap tables use `company_id` but without foreign keys, so we need to manually delete associated records when a company is deleted.

## Updated Settings Tabs

```text
Before:                After:
- Profile              - Companies (new, default)
- Workspace            - Workspace (now includes profile fields)
- Integrations         - Integrations (without CompanySetup)
- Notifications        - Notifications
```

## Files Changed

| File | Change |
|---|---|
| `src/pages/SettingsView.tsx` | Replace Profile tab with Companies tab, update default |
| `src/components/settings/WorkspaceSettings.tsx` | Merge profile editing from ProfileSettings |
| `src/components/settings/ProfileSettings.tsx` | Delete file |
| `src/components/settings/IntegrationsSettings.tsx` | Remove CompanySetup import/render |
| `src/components/settings/CompanySetup.tsx` | Add delete company with confirmation, remove Twitter API key warning, cascade-delete associated data |
