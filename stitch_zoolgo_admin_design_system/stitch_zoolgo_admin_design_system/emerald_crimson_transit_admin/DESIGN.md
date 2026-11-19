---
name: Emerald & Crimson Transit Admin
colors:
  surface: '#e7fff1'
  surface-dim: '#c7e0d2'
  surface-bright: '#e7fff1'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#e1faeb'
  surface-container: '#dbf4e5'
  surface-container-high: '#d5eee0'
  surface-container-highest: '#d0e8da'
  on-surface: '#0a1f17'
  on-surface-variant: '#574142'
  inverse-surface: '#20352b'
  inverse-on-surface: '#def7e8'
  outline: '#8b7172'
  outline-variant: '#debfc0'
  surface-tint: '#aa3145'
  primary: '#6d001e'
  on-primary: '#ffffff'
  primary-container: '#8e1b32'
  on-primary-container: '#ff9ea6'
  inverse-primary: '#ffb2b7'
  secondary: '#226a4b'
  on-secondary: '#ffffff'
  secondary-container: '#a7efc7'
  on-secondary-container: '#286f4f'
  tertiary: '#003b27'
  on-tertiary: '#ffffff'
  tertiary-container: '#1a533c'
  on-tertiary-container: '#8cc5a7'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#ffdadb'
  primary-fixed-dim: '#ffb2b7'
  on-primary-fixed: '#40000e'
  on-primary-fixed-variant: '#8a182f'
  secondary-fixed: '#aaf2ca'
  secondary-fixed-dim: '#8ed5af'
  on-secondary-fixed: '#002113'
  on-secondary-fixed-variant: '#005235'
  tertiary-fixed: '#b5efd0'
  tertiary-fixed-dim: '#99d3b4'
  on-tertiary-fixed: '#002114'
  on-tertiary-fixed-variant: '#165039'
  background: '#e7fff1'
  on-background: '#0a1f17'
  surface-variant: '#d0e8da'
typography:
  display-lg:
    fontFamily: IBM Plex Sans
    fontSize: 2.25rem
    fontWeight: '700'
    lineHeight: 2.75rem
    letterSpacing: '0'
  display-md:
    fontFamily: IBM Plex Sans
    fontSize: 1.75rem
    fontWeight: '700'
    lineHeight: 2.25rem
    letterSpacing: '0'
  headline-lg:
    fontFamily: IBM Plex Sans
    fontSize: 1.5rem
    fontWeight: '600'
    lineHeight: 2rem
    letterSpacing: '0'
  headline-md:
    fontFamily: IBM Plex Sans
    fontSize: 1.25rem
    fontWeight: '600'
    lineHeight: 1.75rem
    letterSpacing: '0'
  headline-sm:
    fontFamily: IBM Plex Sans
    fontSize: 1.125rem
    fontWeight: '600'
    lineHeight: 1.5rem
    letterSpacing: '0'
  body-lg:
    fontFamily: IBM Plex Sans
    fontSize: 1rem
    fontWeight: '400'
    lineHeight: 1.625rem
    letterSpacing: '0'
  body-md:
    fontFamily: IBM Plex Sans
    fontSize: 0.875rem
    fontWeight: '400'
    lineHeight: 1.375rem
    letterSpacing: '0'
  body-sm:
    fontFamily: IBM Plex Sans
    fontSize: 0.75rem
    fontWeight: '400'
    lineHeight: 1.125rem
    letterSpacing: '0'
  label-lg:
    fontFamily: IBM Plex Sans
    fontSize: 0.875rem
    fontWeight: '600'
    lineHeight: 1.25rem
    letterSpacing: '0'
  label-md:
    fontFamily: IBM Plex Sans
    fontSize: 0.75rem
    fontWeight: '600'
    lineHeight: 1rem
    letterSpacing: 0.025em
  tabular-stat:
    fontFamily: IBM Plex Sans
    fontSize: 1.5rem
    fontWeight: '700'
    lineHeight: 1.75rem
    letterSpacing: -0.01em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  gutter: 1.25rem
  gutter-desktop: 1.5rem
  margin: 1.5rem
  margin-desktop: 2rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 1rem
  space-lg: 1.5rem
  space-xl: 2rem
---

## Brand & Style

The design system establishes a high-density, professional desktop management environment for intercity bus ticketing, fleet operations, agency balances, and real-time transit dispatch. The platform balances institutional authority with the refreshing, welcoming tone established in consumer touchpoints.

### Personality & Demeanor
- **Operational Clarity:** High-efficiency data tables, clear information hierarchies, and scannable statuses minimize friction during intensive booking and dispatch workflows.
- **Trustworthy & Grounded:** Rooted in deep institutional emerald greens and crisp white surfaces, evoking financial stability and dependable fleet governance.
- **Decisive & Directed:** Ruby burgundy call-to-actions channel the operator’s focus toward decisive actions: ticketing, confirmation, issuing refunds, and dispatching routes.
- **Native Right-to-Left (RTL):** Architected deliberately from right to left, prioritizing natural Arabic visual cadence, mirrored directional affordances, and proper contextual alignments.

### Style Movement
The aesthetic synthesizes modern **Corporate Precision** with subtle **Soft Layering**. It avoids brutalism or heavy drop shadows in favor of a clean mint workspace canvas (`#EBF4F0`), crisp pure-white surface cards (`#FFFFFF`), subtle emerald-tinted borders, and rich saturated emerald highlight surfaces for core analytical metrics and balance oversight.

## Colors

The color palette is calibrated specifically for extended desktop viewing against a calm, pale mint backdrop. It cleanly delineates primary actionable workflows from corporate balance monitoring and operational states.

### Core Swatches
- **Primary Action (Ruby Burgundy - `#8E1B32` / `#981D37`):** Reserved for high-value user triggers: primary submission buttons, confirmation triggers, active stepper states, and conversion actions.
- **Secondary Identity (Deep Emerald - `#0E5C3E` / Dark Variant `#124D36`):** Carries the institutional brand weight. Used for hero balance displays, metric overview cards, navigation active indicator highlights, and route timeline connections.
- **Workspace Background (Pale Mint - `#EBF4F0` / Ambient Wash `#F0F7F4`):** Eliminates harsh white glare during long shifts, giving cards defined spatial separation.
- **Surfaces (`#FFFFFF`):** Base canvas for data tables, modal dialogs, configuration panels, and filter toolbars.
- **Text & Neutral Hierarchy:**
  - `text-primary` (`#162B22`): Deep emerald-black providing high-contrast readability.
  - `text-muted` (`#5B7065`): Balanced sage gray-green for secondary captions, metadata, and column headers.
  - `border-subtle` (`#D5E2DC`): Low-contrast divider maintaining separation without visual noise.

### Functional & Semantic Colors
Semantic indicators are explicitly differentiated from brand greens and burgundies to maintain unambiguous administrative safety:
- **Success (`#16A34A`):** Confirmed departures, settled payments, active routes.
- **Warning (`#D97706`):** Delayed buses, pending escrow clearance, low seat thresholds.
- **Error / Destructive (`#DC2626`):** Cancelled departures, refunded bookings, route outages.
- **Info (`#2563EB`):** System notifications, scheduled maintenance notes, driver shifts.

## Typography

Typography prioritizes Arabic legibility and numerical precision across multi-column operational tables, booking receipts, and ledger balances. The typography relies on **IBM Plex Sans** (with Arabic script coverage enabled), taking advantage of its crisp geometry, open counters, and native tabular figure support (`tnum`).

### Design Rules
- **Bidirectional Balance:** Numerals, currency identifiers (e.g., `ر.س` or `ج.م`), and booking reference IDs (e.g., `ZL-854921`) use monospace or tabular proportional widths to ensure strict vertical column alignment in audit logs.
- **RTL Baseline Rhythm:** Arabic letterforms demand slightly higher relative line-heights compared to Latin scripts. Body copy maintains a minimum `1.5` to `1.6` line-height ratio to preserve diacritic and ascender/descender clearances.
- **Hierarchical Restraint:** Restrict page titles to `headline-lg` (24px) for admin workspaces, reserving `display-lg` exclusively for hero metric balances (e.g., revenue counters and agency float totals).

## Layout & Spacing

The layout is built around a responsive, fluid desktop shell featuring a fixed right-hand sidebar navigation (width: `260px` expanded, `72px` collapsed) and a persistent top operational bar.

### Grid & Canvas Structure
- **Sidebar (Right in RTL):** Houses primary domain routes (Bookings, Schedules, Fleet, Agency Accounts, Pricing, Reports).
- **Primary Content Area:** Fluid layout bounded between `1140px` and `1600px` max-width, maintaining comfortable eye-tracking across wide screens.
- **Data Densities:**
  - *Standard Spacing (`space-lg` / `1.5rem`):* Used for high-level dashboards, analytics panels, and configuration forms.
  - *Compact Spacing (`space-sm` / `0.5rem`):* Used inside high-density trip manifest tables, passenger allocation rows, and bus seat-map inspectors.
- **Breakpoints:**
  - `Desktop Wide` (≥ 1440px): 12-column grid, 24px gutters, full analytical widgets.
  - `Desktop Standard` (1024px – 1439px): 12-column grid, 20px gutters, secondary data folded into expandable side-drawers.
  - `Tablet / Laptop Compact` (768px – 1023px): Sidebar collapses into an icon-rail; multi-column forms collapse to 2-column or 1-column layouts.

## Elevation & Depth

To match the pristine, ambient feel of the light mint foundation (`#EBF4F0`), elevation relies on subtle tinted shadows mixed with crisp boundary outlines rather than murky grays.

### Shadow Styles
- **Surface Border (Base):** `border: 1px solid #D5E2DC` on all floating white surfaces.
- **Elevation Level 1 (Resting Cards & Table Containers):**
  `box-shadow: 0 1px 3px 0 rgba(14, 92, 62, 0.04), 0 1px 2px -1px rgba(14, 92, 62, 0.04);`
- **Elevation Level 2 (Hovered Rows, Interactive Stat Cards):**
  `box-shadow: 0 4px 6px -1px rgba(14, 92, 62, 0.07), 0 2px 4px -2px rgba(14, 92, 62, 0.05);`
- **Elevation Level 3 (Dropdowns, Popovers, Date Pickers):**
  `box-shadow: 0 10px 15px -3px rgba(14, 92, 62, 0.08), 0 4px 6px -4px rgba(14, 92, 62, 0.04);`
- **Elevation Level 4 (Modals, Passenger Detail Drawers):**
  `box-shadow: 0 20px 25px -5px rgba(22, 43, 34, 0.12), 0 8px 10px -6px rgba(22, 43, 34, 0.06);`

### Backdrop & Layering
Overlays behind modals or drawer panels use a soft emerald-tinted wash: `rgba(22, 43, 34, 0.4)` with an optional `backdrop-filter: blur(4px)` to maintain context while focusing user attention.

## Shapes

The interface balances functional efficiency with comfortable geometric softening. 

- **Small Controls (Buttons, Inputs, Selectors):** `8px` (`rounded-md`).
- **Cards & Data Tables:** `12px` to `16px` (`rounded-lg` to `rounded-xl`).
- **Featured Balances & Hero Operational Banners:** `16px` to `20px` (`rounded-xl` / `rounded-2xl`).
- **Pills & Badges:** Fully rounded `9999px` for seat badges, payment status indicators, and trip tags.

## Components

### 1. Primary Action Buttons
- **Primary:** Background `#8E1B32`, text `#FFFFFF`, border none, border-radius `8px`. Hover: `#741528`. Focus: outline `2px solid #8E1B32` with `2px` offset.
- **Secondary (Brand Outline):** Background `#FFFFFF`, text `#0E5C3E`, border `1.5px solid #0E5C3E`, border-radius `8px`. Hover: background `#F0F7F4`.
- **Tertiary (Ghost):** Background transparent, text `#162B22`. Hover: background `#E2EFE9`.
- **Icon Placement:** Trailing icons sit to the left of the label in RTL; leading icons sit to the right.

### 2. Status Chips & Badges
- **Structure:** Height `24px` to `28px`, padding `2px 10px`, border-radius `9999px`, font `label-md`.
- **Variants:**
  - *Confirmed / Active:* Background `#DCFCE7`, text `#15803D`, border `1px solid #BBF7D0`.
  - *Pending / Delayed:* Background `#FEF3C7`, text `#B45309`, border `1px solid #FDE68A`.
  - *Cancelled:* Background `#FEE2E2`, text `#B91C1C`, border `1px solid #FECACA`.
  - *Scheduled:* Background `#EBF4F0`, text `#0E5C3E`, border `1px solid #D5E2DC`.

### 3. Metric & Balance Cards
- **Balance Hero Card:** Background `#0E5C3E`, text `#FFFFFF`, border-radius `16px`. Secondary sub-stats use `#D5E2DC`. Emphasized figure uses `display-md` or `tabular-stat`.
- **Standard Metric Cards:** Background `#FFFFFF`, border `1px solid #D5E2DC`, border-radius `12px`. Header shows muted label (`#5B7065`), value in `tabular-stat` (`#162B22`), with subtle trending badge.

### 4. Form Inputs & Selectors
- **Fields:** Height `42px`, background `#FFFFFF`, border `1px solid #D5E2DC`, border-radius `8px`, text `#162B22`, placeholder `#8DA097`.
- **Focus State:** Border `#0E5C3E`, subtle green focus ring `0 0 0 3px rgba(14, 92, 62, 0.12)`.
- **Labels:** Positioned above inputs, right-aligned, font `label-lg`, color `#162B22`.

### 5. Data Tables
- **Header:** Background `#F0F7F4`, text `#5B7065`, font `label-md`, uppercase / tracking-wider, text aligned right for text and left for monetary values.
- **Rows:** Height `52px`, background `#FFFFFF`, border-bottom `1px solid #EBF4F0`. Hover state `#F7FAF8`.
- **Numeric Columns:** Applied `font-variant-numeric: tabular-nums` for ticket numbers, departure times, and currency amounts.

### 6. Interactive Bus Seat Map
- **Grid Layout:** Mirrored RTL layout showing bus front at the top or right. Driver icon positioned on the left side of bus cab.
- **Seat Nodes:** `36px × 36px` rounded rects (`6px` radius).
  - *Available:* Border `1px solid #D5E2DC`, background `#FFFFFF`, text `#162B22`.
  - *Occupied:* Background `#E2EFE9`, text `#8DA097`, cursor not-allowed.
  - *Selected:* Background `#8E1B32`, text `#FFFFFF`.
  - *VIP / Premium:* Border `1.5px solid #0E5C3E`, background `#F0F7F4`, text `#0E5C3E`.