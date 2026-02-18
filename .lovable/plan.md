
## FeedbackFlow — Full MVP Plan

A dense, table-first SaaS app inspired by Clay Labs, with multi-user auth and AI-driven feedback-to-roadmap workflow. All data will be pre-seeded with realistic sample feedback from multiple channels.

---

### 1. Authentication & User Roles
- Email/password sign up and login screens
- Three roles: **PM** (Product Manager), **CS** (Customer Success), **Exec** (Executive/Stakeholder)
- Role-based views: PMs see the full workflow, CS sees feedback + actions, Execs see roadmap + impact summary
- Profiles table with name, role, and avatar initial display

---

### 2. App Shell & Navigation
- Collapsible left sidebar with mini-mode (icon-only when collapsed)
- Navigation sections:
  - **Inbox** — raw feedback table
  - **Clusters** — AI-grouped feedback
  - **Actions** — agentic action queue
  - **Roadmap** — initiatives linked to clusters
  - **Customer Portal** — transparency dashboard
- Top bar with user avatar, role badge, and workspace name ("FeedbackFlow")

---

### 3. Feedback Inbox (Ingestion Layer)
- Dense sortable/filterable table with columns: Feedback ID, Source (with channel icon), Text (truncated), Customer, Timestamp, Sentiment badge, Status
- Source filter chips: Intercom, Slack, Email, Zendesk, In-App, Social
- Row click opens a side panel with full feedback details and linked cluster
- Seeded with ~30 realistic feedback entries across all channels
- Manual "Add Feedback" button to enter feedback items by hand

---

### 4. Clusters View (AI Processing Layer)
- Table with: Cluster ID, Category badge (Feature Request / Bug / UX Improvement), Feedback Count, Sentiment, Priority, Tags, Linked Actions count
- Expandable row or side panel showing all raw feedback items in that cluster
- Color-coded priority (High = red, Medium = yellow, Low = green)
- Seeded with ~8 clusters derived from the sample feedback
- Filter by category, sentiment, priority

---

### 5. Actions View (Agentic Workflow Layer)
- Table with: Action ID, Cluster link, AI Suggested Action, Owner (avatar + name), Status chip (Pending / In Progress / Done), Deadline
- Status can be updated inline via dropdown
- "AI Suggested" label clearly marks agentic recommendations
- Owner assignment dropdown (from team members)
- Seeded with ~10 actions across clusters
- Filter by owner, status, cluster

---

### 6. Roadmap View (Strategic Layer)
- Table with: Initiative ID, Cluster Linked, Predicted Impact (with count), Status (Proposal / In Progress / Shipped), Owner
- Row expand shows: linked cluster summary, raw feedback count, impact rationale
- Kanban-style status chips with color coding
- Seeded with ~5 roadmap initiatives
- "Trace back" link from initiative → cluster → raw feedback items

---

### 7. Customer Transparency Portal
- Simplified, read-only table showing:
  - Feedback submitted (anonymized or user's own)
  - Current status badge (Received / Clustered / Under Review / In Progress / Shipped)
  - Action taken description
- Accessible as a separate view in the sidebar
- Seeded with customer-facing status updates matching the sample data

---

### 8. Design & UX Details
- Dark-friendly color palette (deep gray background, subtle borders, high-contrast text)
- Dense table rows with compact padding — power-user optimized
- Monospace font for IDs (FB-001, CL-002, etc.)
- Sentiment badges: green (Positive), red (Negative), gray (Neutral)
- Channel source icons (Slack logo style, email icon, etc.) in the Inbox table
- Responsive sidebar collapses to mini-mode on smaller screens
- Toast notifications for status changes and assignments
