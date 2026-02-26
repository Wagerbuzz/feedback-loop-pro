

# Bulk Select and Actions for Feedback Inbox (Clay-style)

Inspired by Clay's spreadsheet-like bulk operations, this adds multi-row selection with a floating action bar for batch updates.

## What You'll Get

- **Checkbox column** on every row with a "select all" checkbox in the header
- **Shift+click** to select a range of rows
- **Floating bulk action bar** that slides up when rows are selected, showing:
  - Count of selected items (e.g. "12 selected")
  - **Change Status** dropdown (New, Clustered, Under Review)
  - **Change Sentiment** dropdown (Positive, Negative, Neutral)
  - **Deselect All** button
- All bulk changes persist to the database immediately
- Selection is visually highlighted with a subtle row background

## Technical Details

### File Modified: `src/pages/InboxView.tsx`

**New state:**
- `selectedIds: Set<string>` -- tracks selected row IDs
- `lastClickedId: string | null` -- for shift+click range selection

**Header checkbox:**
- Toggles all currently filtered rows on/off
- Shows indeterminate state when some (not all) are selected

**Row checkbox:**
- Click to toggle individual row
- Shift+click selects the range between last clicked and current row (using filtered list order)
- Clicking the checkbox stops propagation so it doesn't open the side panel

**Floating bulk action bar:**
- Rendered as a fixed bar at the bottom center of the inbox area
- Appears with a slide-up animation when `selectedIds.size > 0`
- Contains:
  - "{n} selected" label
  - "Update Status" button with a dropdown (New / Clustered / Under Review)
  - "Update Sentiment" button with a dropdown (Positive / Negative / Neutral)
  - "Deselect All" (X) button
- On action: calls `supabase.from('feedback').update({ status }).in('id', [...selectedIds])`, then refreshes data and clears selection
- Shows a success toast with count of updated items

**No database changes needed** -- the existing `feedback` table already supports UPDATE via RLS for authenticated users.

