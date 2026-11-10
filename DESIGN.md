# Design System: Dotty
**Project ID:** None. Dotty has no Stitch project. This system was taken from the local mockup [`_design/dotty-home.jpg`](_design/dotty-home.jpg) (reference canvas 1365×768). Hex values were sampled from that image, then rounded to clean values. [`_design/old-home.jpg`](_design/old-home.jpg) is superseded and is used for layout reference only.

Product context and screen inventory come from [docs/plans/2026-11-09-dotty-v1.md](docs/plans/2026-11-09-dotty-v1.md).

---

## 1. Visual Theme & Atmosphere

Dotty looks like a **sunny toy diorama**. A small isometric office building stands on a bright lawn, and its floors are pulled apart like a dollhouse so you can see every desk. The interface around it is made of **chunky, tactile stickers**: cream panels with crisp dark-ink outlines and a thicker tan "lip" along the bottom edge, as if each panel were a card resting on the grass. The mood is **cheerful, cozy and calm**, closer to a gentle management game than an enterprise dashboard. That matters here: the user is handing work to AI bots, and the warmth makes that feel friendly rather than intimidating.

**Mood words:** playful, warm, tactile, legible, orderly, optimistic.

**Density.** The interface around the building is **medium-dense**: lots of status, timestamps and activity, but always grouped into clearly framed panels. The 3D scene in the middle is the **airy hero**, and the panels float at the edges so the building is never covered.

**Living, not busy.** Bots bob gently at their desks, status rings glow, and small speech-bubble icons show what each bot is doing. Motion is soft and slow. Nothing flashes except the one thing that needs you: **Waiting on me**.

**Principles behind the style:**

- **Spatial first.** The building *is* the navigation. Floors equal departments, desks equal bots. Panels mirror the building; they don't replace it.
- **Status is colour, colour is status.** A small, strict set of status colours is reused across rings, dots, pills and the activity feed, so meaning can be read at a glance.
- **Approval is a physical gesture.** Approve, Edit and Reject are large, distinct, tinted buttons. Human sign-off should never feel like a hidden checkbox.

---

## 2. Color Palette & Roles

### Ground & surfaces

| Name | Hex | Role |
|---|---|---|
| **Meadow Lawn Green** | `#8CC15D` | The full-bleed background that the building sits on. It is the page background of the office view. |
| **Shaded Moss Green** | `#669F4D` | Lawn shading, tree canopies and the contact shadows under the building. |
| **Sandy Footpath Tan** | `#EFD5A4` | The winding paths on the lawn. A decorative ground accent only. |
| **Parchment Cream** | `#FBEEDB` | The main fill of every floating panel, card, top-bar pill and drawer. |
| **Toasted Cream** | `#F7E8CB` | Panel headers, sunken sections, and hover fills on list rows. |
| **Milk Cream** | `#FDF5E8` | Text inputs and the message composer: a slightly brighter well inside a panel. |
| **Warm Biscuit Lip** | `#C0A48E` | The thick bottom edge under cream panels and cards that gives them their stacked 3D feel. |
| **Hairline Sand** | `#E6D6BC` | Dividers inside panels and the separator between the drawer's tabs and its body. |

### Ink & text

| Name | Hex | Role |
|---|---|---|
| **Warm Ink** | `#1F1A12` | Every panel outline (2px), the workspace title, bot names and main body text. A brown-black, never pure black, so it sits softly on cream. |
| **Driftwood Grey** | `#7A7268` | Secondary text: timestamps (`12m`, `4m`), bot counts, subtitles such as "Waiting on you" and metadata lines. |
| **Midnight Ink Navy** | `#20263D` | The **Live Activity** panel's fill: the one dark panel, where real-time events scroll past like a ticker. |
| **Snow White** | `#FFFFFF` | Text on Midnight Ink Navy and on Cobalt buttons. |

### Brand & actions

| Name | Hex | Role |
|---|---|---|
| **Cobalt Action Blue** | `#1D6FF4` | Primary buttons (**+ Bot**, Send), the active tab's text and underline, links, focus rings. |
| **Deep Cobalt Lip** | `#0B43B0` | The bottom lip and pressed state of Cobalt buttons. |
| **Sunflower Alert** | `#FACF73` | The **Waiting on me** button fill. The most attention-grabbing surface in the top bar. |
| **Butter Yellow** | `#FEDE8C` | The Settings button fill. A softer cousin of Sunflower for utility actions. |
| **Signal Coral** | `#DD6D62` | Notification count badges (white numerals). It also doubles as the **Error** status colour. |
| **Ice Blue Select** | `#B3D8FF` | The selected state of segmented toggles (e.g. a view switch). |

### Bot status (one source of truth: use these everywhere)

The mockup isn't consistent here; it shows "Working" as both blue and green. Dotty standardises on the mapping below. A status colour appears as a **dot** in top-bar counts and the activity feed, as a **pill** in team-panel rows (tinted fill plus dot), and as a **glowing ring** under the bot in 3D.

| Status | Dot / ring | Pill fill | Meaning |
|---|---|---|---|
| **Working**: Cobalt Pulse | `#1868E6` | Frost Blue `#DCE6F5` | The bot is running a task |
| **Waiting on you**: Marigold Glow | `#F9A40E` | Honey Wash `#FCD384` | The bot is paused on an approval or question. The ring pulses slowly |
| **Resting**: Pebble Grey | `#9A9087` | Oat `#ECE0D2` | Idle, between tasks, or paused by the spend cap |
| **Error**: Signal Coral | `#DD6D62` | Blush `#FBDCD6` | The last run failed. A Retry action is available |
| **Done** (feed and timeline only) | Leaf Green `#1CAD5C` | n/a | A task completed or something was found. Used for timeline dots and "found" events |

The Live Activity feed may colour its dots by **bot accent colour** (see Robot palette), so events can be traced to a bot at a glance. Status dots stay reserved for status.

### Approval actions

| Button | Fill | Icon & label | Role |
|---|---|---|---|
| **Approve** | Sage Mist `#E3EDD2` | Fern Green `#2E8B3E` | Carry out the gated action |
| **Edit** | Pale Steel `#E6E9EC` | Cobalt `#1868E6` | Open the payload for editing before approving |
| **Reject** | Peach Blush `#FFDACB` | Brick Red `#D9443A` | Refuse. The bot is told it was rejected |

All three have a 2px tinted border one step darker than their fill. They sit side by side at equal width. Approve is always on the left.

### Floor palette (departments, top floor first)

Each floor has a pastel **slab** (the floor surface) and a lighter **wall** tint (the glass partitions). Floors take colours in `floor_index` order, top to bottom, and the list repeats for extra floors.

| Floor | Slab | Wall / glass | Name |
|---|---|---|---|
| 1st (Head office) | `#A1CCE8` | `#C6DDEE` | **Sky Glass Blue** |
| 2nd | `#F5DBB5` | `#FEE6C8` | **Apricot Cream** |
| 3rd | `#B3DFC4` | `#DFF1CD` | **Mint Sprout** |
| 4th | `#C6C9ED` | `#E3D6F5` | **Lavender Haze** |
| 5th | `#F6D98E` | `#FCEBC0` | **Butter Loft** (extension) |
| 6th | `#F4C4C9` | `#FADDE0` | **Rose Quartz** (extension) |

Each floor's **department sign** (the angled label, e.g. "4F – Research") uses the floor's wall tint as its fill, with a Warm Ink outline and Warm Ink text.

### Robot palette (bot accent colours)

Robots are glossy, toy-like low-poly figures. Each bot gets one accent colour for its body. The visor face is always **Visor Black** `#14161C` with **Snow White** dot eyes.

| Name | Hex |
|---|---|
| **Cobalt Bot** | `#2F7BF0` |
| **Marigold Bot** | `#EBA323` |
| **Grape Bot** | `#8A5CD6` |
| **Jade Bot** | `#49C285` |
| **Coral Bot** | `#F07B6B` |
| **Teal Bot** | `#2BB3B8` |

Robot accent colours are identity, not status. A bot's status shows only through its ring and its pill.

### 3D props

| Prop | Hex |
|---|---|
| Plant leaves | `#6CA445` |
| Terracotta pots | `#C9825A` |
| Desk tops | `#E9E2D6` |
| Monitors | `#62666F` |
| Server racks and safes | `#838B94` |
| Desk legs and chairs | `#3A3F48` |

Props are matte, softly lit, and never more saturated than the robots.

### Implementation tokens

These map onto the shadcn variables already in `app/globals.css`:

| Variable | Value |
|---|---|
| `--background` | Parchment Cream `#FBEEDB`. The office route instead paints Meadow Lawn behind the canvas |
| `--foreground` | Warm Ink `#1F1A12` |
| `--card` | `#FBEEDB` |
| `--muted` | Toasted Cream `#F7E8CB` |
| `--muted-foreground` | Driftwood Grey `#7A7268` |
| `--primary` | Cobalt `#1D6FF4` |
| `--primary-foreground` | `#FFFFFF` |
| `--accent` | Toasted Cream `#F7E8CB` |
| `--border` | Warm Ink `#1F1A12`, for sticker outlines |
| `--input` | Hairline Sand `#E6D6BC`, for soft dividers |
| `--ring` | Cobalt `#1D6FF4` |
| `--destructive` | Brick Red `#D9443A` |

Add custom tokens for the status, floor and robot palettes:

- `--status-working`, `--status-waiting`, `--status-resting`, `--status-error`, `--status-done`
- `--floor-1` to `--floor-6`
- `--bot-cobalt`, `--bot-marigold`, and so on

**Dark mode:** not in v1. The office is a daylight scene, and the light theme is the product.

---

## 3. Typography Rules

**Typeface.** One **friendly, rounded-geometric sans** carries the whole interface. **Nunito** for display and headings and **Inter** for body and UI text is the recommended pairing. Nunito's rounded terminals match the toy-like robots, and Inter (already loaded in `app/layout.tsx`) keeps dense lists crisp. Use **Geist Mono** (already loaded) only for code snippets in Engineering pull-request previews, never for interface chrome.

**Hierarchy** (sizes taken from the 1365px reference):

| Role | Size | Weight | Example |
|---|---|---|---|
| Workspace title | 26px | Extra-bold 800, tight tracking (−0.01em) | "David's Office" |
| Drawer bot name | 26px | Extra-bold 800 | "Grok Bot" |
| Panel title | 20px | Bold 700 | "Your Team", "Live Activity" |
| Floor group header | 19px | Bold 700 | "4F – Head Office" |
| Bot name in list | 18px | Semi-bold 600 | "Inbox Zero" |
| Body / timeline text | 16px | Regular 400 to Medium 500 | "Drafted a reply to waiting…" |
| Pills, buttons, tabs | 15–16px | Medium 500 to Semi-bold 600 | "Working", "Approve", "Activity" |
| Meta / timestamps | 14–15px | Regular 400, Driftwood Grey, tabular numerals | "12m", "12:14" |

**Character:**

- Headings are **heavy and friendly**, never thin or condensed.
- Body copy is relaxed: a line height of about **1.45**.
- Letter spacing stays natural, with no all-caps tracking. The interface speaks in **sentence case** ("Waiting on me", "See all →").
- Timestamps always use **tabular numerals**, so activity columns line up.
- Long bot activity lines truncate with an ellipsis on one line in lists, and wrap fully in the drawer timeline.

---

## 4. Component Stylings

### The sticker frame (shared by every panel, card and button)

Every interface surface uses the same physical treatment:

1. **Fill:** Parchment Cream, or the component's own colour.
2. **Outline:** a crisp **2px Warm Ink outline**.
3. **Highlight:** a faint 1px lighter inner highlight just inside the top edge.
4. **Lip:** a **solid bottom lip**, 3–4px of a darker shade of the fill (Warm Biscuit Lip for cream, Deep Cobalt Lip for blue), offset straight down with no blur.

The result looks like a thick card or a chunky game button. **Depth comes from that hard-edged lip, not from soft blurred shadows.**

### Buttons

- **Shape:** generously rounded corners (10px) on rectangular buttons; pill-shaped for status pills and count badges.
- **Primary (`+ Bot`, Send):** Cobalt fill, white label and icon, Deep Cobalt lip.
- **Attention (`Waiting on me`):** Sunflower fill, Warm Ink label, bell icon, and a Signal Coral count badge (white numeral, pill-shaped) at the end.
- **Utility (`Boards`, `Routines`):** Parchment Cream fill, Warm Ink label, and a line icon on the left.
- **Icon-only (Settings):** square with 10px corners, Butter Yellow fill.
- **Behaviour:**
  - **Hover** lifts 1px and the lip grows by 1px.
  - **Press** sinks: the lip collapses to 0 and the button moves down 3px, like a physical key.
  - **Focus** shows a 3px Cobalt ring offset 2px outside the outline.
  - **Disabled** buttons drop to 50% opacity and lose their lip.
- **Approval buttons** follow the Approval actions table: tinted fills, a 2px tinted border instead of the ink outline (a softer register inside the drawer), and an icon before the label (✓, pencil, ✕).

### Top bar

The top bar is **not a continuous strip**. It is a row of **separate floating sticker pills** over the lawn:

- **Left:** a workspace pill (building icon, workspace name, chevron).
- **Next to it:** a status-count pill ("● 3 Working ● 1 Waiting ● 0 Resting").
- **Right:** the action buttons.

The pills share one baseline and leave about 12px of lawn between them.

### Cards & containers

- **Panels** (Your Team, the drawer): 12–14px rounded corners, Parchment Cream fill, the sticker frame, and inner padding of 16px. The title row has an icon, a bold title, and a right-aligned meta control (e.g. "4 bots ⌄").
- **Bot rows in Your Team:**
  - Each row is its own small card: 10px corners, Milk Cream fill, 1.5px Hairline Sand border, 12px padding.
  - Layout:
    - **Left:** a circular 56px avatar on a pale tint of the bot's accent colour, with a 2px white ring.
    - **Middle:** the name, with the status pill underneath.
    - **Right:** the time since last activity, in Driftwood Grey.
  - The **selected / attention row** turns Honey Wash (`#FBE5BE`) with a 2px **Marigold** border and a soft outer glow.
- **Floor groups:** a bold "4F – Head Office ⌄" header that collapses its rows. The order matches the building, top floor first.
- **Live Activity panel:**
  - The single **dark** sticker: Midnight Ink Navy fill, the same 12px corners, and a darker lip.
  - Header: a green pulse icon, the white bold title "Live Activity", and a "See all →" link.
  - Rows: a coloured dot, a tabular time in muted white (70% opacity), and white text with the bot name in bold.
- **Approval card (inline in the drawer timeline):**
  - 12px corners, a Milk Cream fill slightly greyed toward `#F3EEE6`, and a 1.5px Hairline Sand border, so it sits *inside* the panel and isn't another sticker.
  - Content: an icon tile (e.g. a blue envelope) on the left, the bold subject line, and a 2–3 line preview in Driftwood Grey.
  - Below that, the Approve / Edit / Reject row.
- **Drawer:**
  - Right-docked and tall (about 410px wide at the reference size).
  - **Header:** a 72px avatar, the bot name, a subtitle, and a status pill.
  - **Tabs:** Chat · Activity · Routines · Setup. The active tab gets Cobalt text and a 3px Cobalt underline. Inactive tabs use Warm Ink at 80%.
  - **Activity timeline:** a 2px Hairline Sand vertical rule with 10px status-coloured dots, a tabular time column, then the event text. A bold first line can carry a muted second line ("Accessed Gmail" / "Reading 23 unread emails").
- **Board cards (kanban):** the same as bot-row cards. Each carries a small avatar of its assigned bot, a status pill, and a subtask count.

### Inputs & forms

- **Composer** ("Message Inbox Zero…"): 12px corners, Milk Cream fill, 2px Warm Ink outline, 14px padding, and a Driftwood Grey placeholder. The Cobalt send button sits beside it as a square sticker button with a white paper-plane icon.
- **Text fields and selects** in forms (+ Bot, Setup): the same style as the composer. Focus turns the outline Cobalt and adds a 3px soft Cobalt ring at 25% opacity.
- **Segmented toggle:** a cream track with a 2px ink outline. The selected segment is Ice Blue Select with a 1.5px Cobalt border and Cobalt text. Unselected segments are Warm Ink at 70%.
- **Checkbox lists** (the tool picker): rounded 6px boxes with a 2px ink outline, Cobalt fill and a white check when checked. A gated tool shows a small Marigold "needs approval" pill beside its name.

### Status pills & badges

- Pill-shaped, 26–28px tall, with 10px horizontal padding.
- Contents: an 8px status dot, then the label in Medium weight.
- The fill is the status pill fill from §2. There is no outline, so pills read as softer than buttons.
- Count badges are pill-shaped Signal Coral with bold white numerals, at a minimum width of 22px.

### 3D office elements

- **Building:**
  - A true isometric orthographic view, with floors stacked and pulled apart by about one floor height so every desk is visible.
  - Slabs use the floor palette, with a darker side face (about 15% darker) that matches the panels' sticker lip.
  - Glass partition walls are translucent tints of the floor's wall colour (roughly 55% opacity).
  - Soft ambient light plus one warm key light from the upper left, and a soft contact shadow under the building on the lawn.
- **Department sign:** an angled flat sign attached to each floor's left corner, with the floor's wall tint, a Warm Ink outline and bold text ("4F – Research").
- **Robot:**
  - A rounded-box head with a glossy accent-colour shell, a black visor with white dot eyes, a small antenna, and a compact body seated at a desk.
  - Accessories (headset, glasses, cap) vary by bot.
  - **Idle:** a slow 2s bob. **Working:** a subtle typing sway.
- **Status ring:** a flat glowing disc under the chair in the status colour.
  - **Waiting:** a 1.6s slow pulse.
  - **Error:** steady red, not flashing.
  - **Selected bot:** the ring thickens and a soft Marigold halo sits under the desk, as on Inbox Zero in the mockup.
- **Activity bubble:** a white rounded speech bubble with a 2px ink outline floating above the bot, holding one colourful icon for the current activity (envelope, chart, laptop). It shows only while the bot is working or waiting.
- **Lawn dressing:** rounded low-poly trees in Shaded Moss Green with Sandy Footpath paths. Decoration only, never clickable.

### Iconography

- Rounded line icons with a 2px stroke from `lucide-react`, in Warm Ink on cream and white on Cobalt or Navy.
- Colourful filled icons appear **only** in 3D activity bubbles and approval-card icon tiles, where they help identify what the bot is doing.

---

## 5. Layout Principles

**Full-bleed scene, floating chrome.** The office route paints Meadow Lawn edge to edge, with the 3D canvas filling the viewport. All interface elements are **floating sticker panels** above the scene. There are no full-height sidebars and no app frame.

**Three-zone composition** (desktop, 1280px and wider):

- **Top bar:** a single row of floating pills, 16px from the top and the sides.
- **Left rail:** about 315px wide, 16px from the left edge. **Your Team** sits on top and grows with its content; **Live Activity** is pinned beneath it, and the two are separated by 12px of lawn.
- **Right drawer:** about 410px wide, 16px from the right edge, running from under the top bar to the bottom margin. It slides in when a bot is selected and can be dismissed. While it is closed, the building recentres.
- **Centre stage:** the building is centred in the space left between the rails, with breathing room on every side. A view control (e.g. a segmented toggle) can float at the top centre of the stage.

**Spacing scale:**

| Use | Space |
|---|---|
| Between floating panels and screen edges | 16px |
| Between stacked panels or pills | 12px |
| Panel padding | 16px |
| Gap between rows inside a panel | 10px |
| Row padding | 12px |
| Gap between pill contents | 8px |
| Fine detail spacing | 4px |

Spacing follows a 4px base grid.

**Alignment:**

- Panel titles, floor headers and row content share a left edge inside each panel.
- Timestamps right-align to the panel's inner edge.
- Bot names line up from row to row.
- Every top-bar pill shares one vertical centre line.

**Hierarchy through placement:**

- The left side answers *who is on my team and what just happened*.
- The right side answers *what does this bot need from me*.
- The centre answers *where is everyone*.
- The **Waiting on me** button and Marigold-highlighted rows are the only surfaces that compete for attention, by design.

**Responsive behaviour:**

| Width | Behaviour |
|---|---|
| 1024–1279px | The left rail narrows to 280px. The drawer overlays the scene instead of sharing space. |
| Under 1024px | The left rail collapses to a toggleable sheet. |
| Under 768px, or when WebGL is unavailable | The 3D scene is replaced by a **floor-by-floor list view**: each floor is a sticker card tinted with its floor colour, holding its bot rows. The drawer becomes a full-screen sheet and the top bar condenses to icons plus the Waiting on me badge. |

**Motion:**

- **Durations:** panels and the drawer slide in at 200–250ms with an ease-out curve; buttons respond in 80–120ms.
- **Selecting a bot:** the camera glides to frame its floor (about 600ms, eased).
- **Reduced motion:** `prefers-reduced-motion` turns off the bobbing, ring pulses and camera glides. Status stays readable from colour alone.

**Accessibility:**

- Warm Ink on Parchment Cream and white on Cobalt or Navy meet WCAG AA.
- Status is **never shown by colour alone**: dots always come with a text label in pills and the feed, and 3D rings also have a hover tooltip and a matching row in the panel.
- Click targets are at least 40px tall.
- Focus rings are always visible on every sticker control.
