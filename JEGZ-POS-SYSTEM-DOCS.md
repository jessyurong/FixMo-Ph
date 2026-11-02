# JEGZ Mobile Repair — POS System
## Complete Feature & Function Reference

---

## OVERVIEW

**System Name:** JEGZ Mobile Repair POS  
**Type:** Point of Sale system for a phone repair shop  
**Purpose:** Manage repairs, parts inventory, technicians, cash flow, and business analytics  
**Currency:** Philippine Peso (₱)  
**Time Zone Display:** Asia/Manila (PH)

---

## TECH STACK (for reference)

| Layer | Technology |
|---|---|
| Frontend | React + Vite + TypeScript |
| Routing | Wouter |
| State / API calls | TanStack Query (React Query) |
| Styling | Tailwind CSS + shadcn/ui components |
| Charts | Recharts |
| Backend | Express.js (Node.js) |
| Database | PostgreSQL |
| ORM | Drizzle ORM |
| Auth | Session-based (express-session + bcrypt) |
| Session Storage | PostgreSQL (sessions table) |

---

## DATABASE SCHEMA

### Table: `users`
| Column | Type | Notes |
|---|---|---|
| id | serial (PK) | Auto-increment |
| username | text | Unique, stored lowercase |
| password_hash | text | bcrypt hashed |
| role | enum | `admin` or `staff` |
| permissions | text[] | Array of permission keys |
| is_active | boolean | Default true |
| created_at | timestamp | With timezone |

### Table: `products`
| Column | Type | Notes |
|---|---|---|
| id | serial (PK) | Auto-increment |
| name | text | Part/product name |
| category | text | e.g. "Battery", "Screen" |
| device_type | enum | `android`, `iphone`, or `both` |
| cost | numeric(10,2) | Purchase/cost price |
| selling_price | numeric(10,2) | Price charged to customer |
| stock | integer | Current quantity in stock |
| created_at | timestamp | With timezone |

### Table: `services`
| Column | Type | Notes |
|---|---|---|
| id | serial (PK) | Auto-increment |
| name | text | Labor service name |
| type | enum | `android` or `iphone` |
| price | numeric(10,2) | Labor charge |

### Table: `technicians`
| Column | Type | Notes |
|---|---|---|
| id | serial (PK) | Auto-increment |
| name | text | Technician full name |
| role | text | Default "Technician" |
| created_at | timestamp | With timezone |

### Table: `transactions`
| Column | Type | Notes |
|---|---|---|
| id | serial (PK) | Auto-increment |
| customer | text | Customer name |
| unit | text | Device model (e.g. "iPhone 13 Pro") |
| technician_id | integer | FK → technicians |
| payment_method | enum | `cash` or `gcash` |
| cash_received | numeric(10,2) | Amount paid by customer |
| labor_discount | boolean | Whether 20% labor discount applied |
| subtotal | numeric(10,2) | Sum before discount |
| discount_amount | numeric(10,2) | Labor discount value |
| shipping_fee | numeric(10,2) | Default 0 |
| total | numeric(10,2) | subtotal − discount_amount |
| profit | numeric(10,2) | total − total_cost |
| status | enum | `pending`, `ready`, or `complete` |
| created_at | timestamp | With timezone |

### Table: `transaction_items`
| Column | Type | Notes |
|---|---|---|
| id | serial (PK) | Auto-increment |
| transaction_id | integer | FK → transactions |
| type | enum | `product` or `service` |
| ref_id | integer | FK → products or services (nullable for custom items) |
| name | text | Item name (snapshot at time of sale) |
| qty | integer | Quantity |
| price | numeric(10,2) | Unit price at time of sale |
| cost | numeric(10,2) | Unit cost at time of sale |
| is_pre_order | boolean | Whether this is a pre-ordered part |

### Table: `cash_drawer_entries`
| Column | Type | Notes |
|---|---|---|
| id | serial (PK) | Auto-increment |
| type | enum | `sale`, `deposit`, or `withdraw` |
| amount | numeric(10,2) | Amount of the entry |
| note | text | Optional description |
| running_balance | numeric(10,2) | Cumulative balance after this entry |
| created_at | timestamp | With timezone |

### Table: `gcash_drawer_entries`
| Column | Type | Notes |
|---|---|---|
| id | serial (PK) | Auto-increment |
| type | enum | `sale`, `deposit`, or `withdraw` |
| amount | numeric(10,2) | Amount of the entry |
| note | text | Optional description |
| running_balance | numeric(10,2) | Cumulative balance after this entry |
| created_at | timestamp | With timezone |

### Table: `defective_items`
| Column | Type | Notes |
|---|---|---|
| id | serial (PK) | Auto-increment |
| product_id | integer | FK → products |
| quantity | integer | Number of defective units |
| reason | text | Why it was marked defective |
| created_at | timestamp | With timezone |

### Table: `backjobs`
| Column | Type | Notes |
|---|---|---|
| id | serial (PK) | Auto-increment |
| customer | text | Customer name |
| unit | text | Device model |
| technician_id | integer | FK → technicians |
| issue | text | Description of the recurring problem |
| original_repair_date | text | Date of the original repair (stored as date string) |
| cause | enum | `warranty` or `human_error` |
| status | enum | `pending`, `in_progress`, or `done` |
| created_at | timestamp | With timezone |

### Table: `sessions` (managed by express-session)
| Column | Type | Notes |
|---|---|---|
| sid | varchar (PK) | Session ID |
| sess | json | Session data payload |
| expire | timestamp | Session expiry time |

---

## MODULE 1 — AUTHENTICATION

### Login Page
- Displayed before anything else if not logged in
- Full-page centered card with JEGZ branding (wrench icon + name)
- Fields: Username, Password
- On submit: POST /api/auth/login
- On success: user is set in context, app loads
- On error: red error message shown below form
- Footer note: "Contact admin if you forgot your password"

### Session Rules
- Sessions last 7 days (stored in PostgreSQL sessions table)
- Sessions survive server restarts (not in-memory)
- Cookie: httpOnly, sameSite=lax
- On page load: GET /api/auth/me checked to restore session
- If session invalid: logout, redirect to login

### API Endpoints — Auth
| Method | Path | Description |
|---|---|---|
| POST | /api/auth/login | Login with username + password |
| POST | /api/auth/logout | Destroy session, redirect to login |
| GET | /api/auth/me | Returns current logged-in user info |

### Response: /api/auth/me and /api/auth/login
```json
{
  "id": 1,
  "username": "admin",
  "role": "admin",
  "permissions": ["*"]
}
```
- Admin always gets `permissions: ["*"]` (full access)
- Staff gets their specific permission array

### Default Admin Account
- Username: `admin`
- Password: `jegz2024`
- Created automatically on first boot if no users exist

---

## MODULE 2 — USER MANAGEMENT (Admin Only)

### Access
- Only visible to users with `role = "admin"`
- Page accessible at `/users` route
- Nav item: "User Management" with UserCog icon

### User Roles
| Role | Description |
|---|---|
| admin | Full access to everything. Cannot be restricted. |
| staff | Access limited to permissions granted by admin |

### Staff Permission Keys
| Key | Page / Feature |
|---|---|
| pos | Point of Sale |
| inventory | Inventory |
| services | Labor Services |
| technicians | Technicians |
| transactions | Transactions |
| cash_drawer | Cash Drawer |
| gcash_drawer | GCash Drawer |
| defective_items | Defective Items |
| backjobs | Backjobs |

Note: Dashboard is always visible to all logged-in users (no permission required).

### User Management Features
- **View all users** — Table with: username, role badge, access list, active/inactive toggle, edit/delete buttons
- **Create user** — Username (stored lowercase), password (min 6 chars), role (admin/staff), permissions (toggle switches per feature)
- **Edit user** — Change role, permissions, password (optional), enable/disable account
- **Disable account** — Toggle switch; disabled users cannot log in (403 error)
- **Delete user** — Permanently removes user; cannot delete your own account; cannot delete the last admin
- **"You" badge** — Shows on your own account row

### Business Rules
- Admin has ALL permissions regardless of what's stored in the DB
- Staff with no permissions can log in but sees only the Dashboard
- Nav sidebar automatically hides pages the current user has no permission for
- Cannot deactivate or delete your own account

### API Endpoints — Users
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | /api/users | Admin only | List all users |
| POST | /api/users | Admin only | Create new user |
| PATCH | /api/users/:id | Admin only | Update role/permissions/password/status |
| DELETE | /api/users/:id | Admin only | Delete user |

---

## MODULE 3 — DASHBOARD

### Access: All logged-in users

### KPI Cards (top row — 4 cards)
1. **Today's Sales** — Total revenue from COMPLETE transactions today
2. **Today's Profit** — Total profit from COMPLETE transactions today (shows margin %)
3. **This Month** — Monthly sales + profit from COMPLETE transactions
4. **Low Stock Alerts** — Count of products with stock ≤ 5 (turns red if > 0)

### Charts
1. **7-Day Sales & Profit Trend** — Area chart (line chart with fill), last 7 days, sales (amber) and profit (green) lines
2. **Daily Transactions (7 days)** — Bar chart, count of transactions per day
3. **Top Services** — Horizontal bar chart, top 5 services by job count this month
4. **Payment Methods** — Donut/pie chart, Cash vs GCash split for today's complete transactions

### Tables / Lists
1. **Top Products Sold** — Top 5 parts used this month (from complete transactions), shown with progress bars
2. **Recent Transactions** — Last 5 transactions (any status), shows customer, unit, time, payment method badge, total
3. **Low Stock Alert** — Expandable section at bottom, shows products with stock ≤ 5 with "OUT" or "X left" badges (only shown when there are low-stock items)

### Important Logic
- Dashboard stats ONLY count transactions with `status = "complete"`
- Pending and Ready transactions do NOT appear in revenue figures
- `pendingCount` in dashboard = count of all pending + ready transactions (shown as badge in sidebar)
- Low stock threshold = stock ≤ 5

### API Endpoint
| Method | Path | Description |
|---|---|---|
| GET | /api/dashboard | Returns all dashboard data in one call |

### Dashboard Response Fields
```
todaySales, todayProfit, todayTransactions,
monthSales, monthProfit,
lowStockCount, cashCount, gcashCount, pendingCount,
salesTrend (7 entries: date, sales, profit, transactions),
topProducts (top 5: name, count),
topServices (top 5: name, count),
recentTransactions (last 5: id, customer, unit, total, paymentMethod, status, createdAt),
lowStockProducts (top 5 low-stock: id, name, category, stock)
```

---

## MODULE 4 — POINT OF SALE (POS)

### Layout
- Split-panel layout:
  - **Left panel** (wide): Labor Services section (top) + Parts & Products section (scrollable, bottom)
  - **Right panel** (fixed 320px wide): Current Job / Cart

### Left Panel — Labor Services Section
- **Device type toggle** (Android / iPhone) — filters which services are shown
- **Service buttons** — Grid layout, click to add to cart
  - Shows service name and price
  - Filtered by device type (android or iphone)
- **Custom Service button** — Opens dialog to add a service not in the database
  - Fields: Service description, Price
  - Added to cart with `refId = null`, labeled "CUSTOM"

### Left Panel — Parts & Products Section
- **Search bar** — Live search by name or category
- **Product cards** — Grid layout (2-4 columns depending on screen width)
  - Shows: stock badge (green=in stock, amber=low ≤3, red=OUT), price, name, category
  - Click card = add to cart (regular sale), stock deducted immediately
  - "Pre-Order" button at bottom of each card = add as pre-order (stock NOT deducted)
  - Out of stock cards are dimmed and click-disabled
- **Custom Pre-Order button** — Opens dialog to add a part not in inventory
  - Fields: Item name, Price, Quantity
  - Added as pre-order with `refId = null`, labeled "CUSTOM" + "PRE"

### Cart (Right Panel)
- Lists all added items with:
  - Type badge (wrench icon = service, box icon = product)
  - "PRE" amber badge for pre-orders
  - "CUSTOM" badge for custom items
  - Name, unit price × qty, total price
  - +/- buttons to adjust quantity (removing all qty removes item)
  - Trash button to remove item
- **Subtotal** displayed
- **Labor Discount toggle** (20% off labor only)
  - Only shown when cart has at least one service
  - Calculates: `discountAmount = sum(all service prices) × 0.20`
- **Total** = `subtotal − discountAmount`
- **Two action buttons:**

| Button | Color | Behavior |
|---|---|---|
| Save Pending | Amber/Orange | Creates transaction with status=pending, money NOT recorded yet |
| Complete Job | Green | Creates transaction, immediately patches to status=complete, money recorded in drawer |

### Checkout Modal (opens on both buttons)
- Title changes based on which button was pressed
- Fields: Customer Name, Device / Unit Model, Technician (dropdown), Payment Method (Cash / GCash)
- Shows total amount
- Explains to user: "Save Pending = money recorded on pickup. Complete Job = money recorded now"
- On confirm: API call to create transaction

### Calculations
```
subtotal = sum(item.price × item.qty) for all cart items
laborTotal = sum(item.price × item.qty) for service items only
discountAmount = laborDiscount ? laborTotal × 0.20 : 0
total = subtotal − discountAmount
profit = total − sum(item.cost × item.qty)
change = cashReceived − total (cash payment only, shown on receipt)
```

### Stock Deduction Rules
- Regular product added to cart → stock deducted from DB immediately when transaction is CREATED (not when completed)
- Pre-order product → stock NOT deducted (item doesn't exist in inventory yet)
- Custom items (refId = null) → no stock change

### Receipt Modal
- Opens after successful checkout
- Shows: customer, unit, technician, items list, subtotal, discount, total, payment method, cash received, change (if cash)
- Print button available

### API Calls Made by POS
| Method | Path | When |
|---|---|---|
| GET | /api/products | On load + search |
| GET | /api/services?type=android or iphone | On load + device toggle |
| GET | /api/technicians | On load |
| POST | /api/transactions | On checkout confirm |
| PATCH | /api/transactions/:id | Only when "Complete Job" selected |

---

## MODULE 5 — INVENTORY MANAGEMENT

### Features
- **Tabs:** All / Android / iPhone — filters by device_type
- **Low Stock Badge** — Red badge on "Inventory" nav item showing count of items with stock ≤ 5
- **Search** — Filter by name or category
- **Add Product** button — Opens dialog form
- **Edit Product** — Edit icon on each row
- **Delete Product** — Trash icon on each row

### Product Form Fields
| Field | Type | Notes |
|---|---|---|
| Name | text | Required |
| Category | text | e.g. Battery, Screen, Charging Port |
| Device Type | select | Android / iPhone / Both |
| Cost Price | number | Your purchase cost |
| Selling Price | number | Price charged to customer |
| Stock | integer | Current quantity |

### Product Table Columns
- Name, Category, Device Type badge, Stock (colored by level), Cost, Selling Price, Margin (auto-calculated %), Actions

### Stock Level Display
- Green = stock > 5
- Amber/yellow = stock 1-5 (low)
- Red "OUT" = stock = 0

### Device Type Filter Logic
- Selecting "Android" tab: shows products with `device_type = android` OR `device_type = both`
- Selecting "iPhone" tab: shows products with `device_type = iphone` OR `device_type = both`
- "All" tab: shows everything

### API Endpoints — Products
| Method | Path | Description |
|---|---|---|
| GET | /api/products | List all (supports ?search= and ?deviceType=) |
| POST | /api/products | Create product |
| PUT | /api/products/:id | Update product |
| DELETE | /api/products/:id | Delete product |

---

## MODULE 6 — LABOR SERVICES

### Features
- List of all labor services (name, type, price)
- **Tabs:** Android / iPhone — filters which services are shown
- **Add Service** button — dialog form
- **Edit Service** — edit icon per row
- **Delete Service** — trash icon per row

### Service Form Fields
| Field | Type | Notes |
|---|---|---|
| Name | text | e.g. "Screen Replacement", "Battery Swap" |
| Type | select | Android or iPhone only (no "both" option) |
| Price | number | Labor charge in ₱ |

### API Endpoints — Services
| Method | Path | Description |
|---|---|---|
| GET | /api/services | List all (supports ?type= filter) |
| POST | /api/services | Create service |
| PUT | /api/services/:id | Update service |
| DELETE | /api/services/:id | Delete service |

---

## MODULE 7 — TECHNICIANS

### Features
- List of all technicians
- **Add Technician** button — dialog form
- **Edit Technician** — edit icon
- **Delete Technician** — trash icon

### Technician Form Fields
| Field | Type | Notes |
|---|---|---|
| Name | text | Full name |
| Role | text | Default "Technician"; can be customized (e.g. "Senior Tech") |

### API Endpoints — Technicians
| Method | Path | Description |
|---|---|---|
| GET | /api/technicians | List all |
| POST | /api/technicians | Create technician |
| PUT | /api/technicians/:id | Update technician |
| DELETE | /api/technicians/:id | Delete technician |

---

## MODULE 8 — TRANSACTIONS

### Features
- **Period filter tabs:** Today / Week / Month / All
- **Status filter tabs:** All / Pending / Ready / Complete
- **Search bar** — search by customer name or unit model
- **Stats row** — 6 KPI cards (for current period, complete only):
  - Total Sales, Total Profit, Jobs Done, Cash Txns, GCash Txns, Avg/Job
- **Transaction cards** — each transaction shown as a card with left color bar
- **Side panel** (on large screens) — Top Models, Top Services, Top Products (for current period)

### Transaction Card Layout
- Customer name (bold, large)
- Unit badge (device model)
- Status badge (color-coded)
- Pre-order badge (if any item is pre-order)
- Total amount (top right, bold)
- Profit (shown only if status = complete)
- Date/time, technician, payment method
- Transaction # (padded to 6 digits, e.g. #000003)
- Items list (qty × name)
- Action buttons (depending on status)

### Transaction Status Flow
```
Pending → Ready → Complete
```
| Status | Meaning | Drawer Effect |
|---|---|---|
| pending | Job saved, customer hasn't picked up | No money recorded |
| ready | Device is fixed, waiting for customer pickup | No money recorded |
| complete | Customer picked up and paid | Money recorded in Cash or GCash drawer |

### Status Action Buttons
| Current Status | Button Shown | Next Status |
|---|---|---|
| pending | "Mark Ready" (blue) | → ready |
| ready | "Complete" (green) | → complete |
| complete | None (no further action) | — |

### On Marking Complete
- System auto-creates a drawer entry:
  - If payment method = cash → entry in `cash_drawer_entries` (type = "sale")
  - If payment method = gcash → entry in `gcash_drawer_entries` (type = "sale")
  - Note on entry: `"Sale #X — CustomerName (DeviceModel)"`
  - Running balance is updated

### Delete Transaction
- Confirmation dialog required
- Deletes transaction AND all its transaction_items
- Does NOT reverse stock deduction (stock is not returned)
- Does NOT reverse any drawer entries already made

### API Endpoints — Transactions
| Method | Path | Description |
|---|---|---|
| GET | /api/transactions | List (supports ?period=, ?search=, ?status=) |
| GET | /api/transactions/stats | Stats for period (complete only) |
| POST | /api/transactions | Create transaction |
| PATCH | /api/transactions/:id | Update status |
| DELETE | /api/transactions/:id | Delete transaction + items |

---

## MODULE 9 — CASH DRAWER

### Purpose
Tracks physical cash in the shop drawer.

### Features
- **Current Balance** — shown large at top
- **Deposit button** — add cash to drawer manually
- **Withdraw button** — record cash taken out
- **Transaction log** — full list of all entries (newest first) showing: type badge, amount, note, running balance, timestamp

### Entry Types
| Type | Color | When Created |
|---|---|---|
| sale | Green | Auto — when a cash transaction is marked Complete |
| deposit | Blue | Manual — admin/staff adds cash (e.g. starting float) |
| withdraw | Red | Manual — admin/staff removes cash (e.g. expenses) |

### Running Balance
- Each entry stores a `running_balance` = balance after that entry
- Current balance = `running_balance` of the most recent entry
- If no entries exist, balance = 0

### Deposit/Withdraw Form Fields
- Amount (₱)
- Note (optional description)

### API Endpoints — Cash Drawer
| Method | Path | Description |
|---|---|---|
| GET | /api/cash-drawer | Get current balance + all entries |
| POST | /api/cash-drawer/deposit | Add a deposit entry |
| POST | /api/cash-drawer/withdraw | Add a withdrawal entry |

---

## MODULE 10 — GCASH DRAWER

### Purpose
Tracks GCash payments separately from cash. Identical structure to Cash Drawer but for digital payments.

### Features
- Same as Cash Drawer: current balance, deposit, withdraw, transaction log
- Balance = GCash received − withdrawals

### Entry Types
Same as Cash Drawer: `sale`, `deposit`, `withdraw`

### When Sales Are Recorded
- Auto-created when a transaction with `payment_method = "gcash"` is marked Complete
- Note format: `"Sale #X — CustomerName (DeviceModel)"`

### API Endpoints — GCash Drawer
| Method | Path | Description |
|---|---|---|
| GET | /api/gcash-drawer | Get current balance + all entries |
| POST | /api/gcash-drawer/deposit | Add a deposit entry |
| POST | /api/gcash-drawer/withdraw | Add a withdrawal entry |

---

## MODULE 11 — DEFECTIVE ITEMS

### Purpose
Log parts/products that were found defective or damaged.

### Features
- Table of all defective item records
- **Add Defective Item** button — dialog form
- **Delete** — remove a defective item record

### Defective Item Form Fields
| Field | Type | Notes |
|---|---|---|
| Product | select | Select from products list |
| Quantity | integer | How many units were defective |
| Reason | text | Explanation (e.g. "DOA from supplier", "Cracked during install") |

### Display
- Product name, quantity, reason, date logged
- Note: Recording a defective item does NOT automatically deduct from product stock (stock management is done separately)

### API Endpoints — Defective Items
| Method | Path | Description |
|---|---|---|
| GET | /api/defective-items | List all defective item records |
| POST | /api/defective-items | Log a new defective item |
| DELETE | /api/defective-items/:id | Remove a record |

---

## MODULE 12 — BACKJOBS (Warranty / Return Repairs)

### Purpose
Track repairs that came back — either under warranty or due to technician error.

### Features
- List of all backjob records
- **Status filter** — All / Pending / In Progress / Done
- **Add Backjob** button — dialog form
- **Update Status** — change backjob progress
- **Delete Backjob** — remove record
- **Warranty indicator** — auto-calculated based on original repair date

### Backjob Form Fields
| Field | Type | Notes |
|---|---|---|
| Customer Name | text | |
| Unit / Device | text | |
| Technician | select | From technicians list |
| Issue Description | text | What went wrong |
| Original Repair Date | date | When the device was first repaired |
| Cause | select | `warranty` or `human_error` |

### Warranty Logic
- System auto-calculates `withinWarranty` boolean
- Formula: `daysSinceRepair = today − originalRepairDate`
- `withinWarranty = daysSinceRepair ≤ 30`
- Shows "Within Warranty" or "Out of Warranty" badge on each record

### Backjob Status Flow
```
pending → in_progress → done
```

### Cause Types
| Cause | Meaning |
|---|---|
| warranty | Part failed within 30-day warranty period |
| human_error | Technician made a mistake during repair |

### API Endpoints — Backjobs
| Method | Path | Description |
|---|---|---|
| GET | /api/backjobs | List all (supports ?status= filter) |
| POST | /api/backjobs | Create backjob record |
| PATCH | /api/backjobs/:id | Update status |
| DELETE | /api/backjobs/:id | Delete record |

---

## SIDEBAR / NAVIGATION

### Layout
- Fixed left sidebar, collapsible (icon-only mode when collapsed)
- Shop name "JEGZ MOBILE REPAIR" in header
- Collapse/expand toggle button (hamburger icon)

### Navigation Items
| Icon | Label | Permission Required |
|---|---|---|
| LayoutDashboard | Dashboard | None (always visible) |
| ShoppingCart | Point of Sale | `pos` |
| Package | Inventory | `inventory` |
| Wrench | Labor Services | `services` |
| Users | Technicians | `technicians` |
| Receipt | Transactions | `transactions` |
| Wallet | Cash Drawer | `cash_drawer` |
| Smartphone | GCash Drawer | `gcash_drawer` |
| AlertTriangle | Defective Items | `defective_items` |
| RotateCcw | Backjobs | `backjobs` |
| UserCog | User Management | Admin only |

### Notification Badges on Nav Items
- **Inventory** — Red badge showing count of low-stock products (stock ≤ 5)
- **Transactions** — Amber badge showing count of pending + ready transactions

### Bottom of Sidebar
- **Theme switcher** — Click to expand; 5 themes available
- **User info** — Shows current username + role
- **Logout button** — Destroys session, returns to login page
- **Clock** — Live clock in Asia/Manila timezone (HH:MM:SS)

### Themes Available
| Theme | Description |
|---|---|
| Dark | Dark navy background, amber primary |
| White | White/light background |
| Warm | Warm amber/orange tones |
| Sky Blue | Blue-tinted background |
| Light Violet | Purple-tinted background |

---

## BUSINESS LOGIC SUMMARY

### Profit Calculation
```
profit = total − totalCost
totalCost = sum(item.cost × item.qty) for all items in transaction
```

### Labor Discount (20%)
```
laborTotal = sum of all service-type items in cart
discountAmount = laborTotal × 0.20
total = subtotal − discountAmount
```
- Only applies to services, not products
- Toggle switch on cart panel

### Stock Deduction Timing
- **Regular product sale** → stock deducted at time of transaction CREATION (not at completion)
- **Pre-order product** → stock NOT deducted (product not yet in hand)
- **Custom item** (not linked to inventory) → no stock change ever

### Money Flow Timing
- Money is only recorded in drawers when status → `complete`
- Pending and ready transactions are "on credit" — amount is owed but not yet received
- Dashboard revenue only counts `complete` transactions

### Transaction Number Format
- ID padded to 6 digits: `#000001`, `#000002`, etc.

### Low Stock Threshold
- Alert triggered when `stock ≤ 5`
- "OUT" badge when `stock = 0`
- "X left" amber badge when `1 ≤ stock ≤ 5`

### Warranty Period
- Standard warranty window: 30 days from original repair date
- `withinWarranty = (today − originalRepairDate) ≤ 30 days`

---

## API ROUTE PROTECTION

| Route Group | Protection |
|---|---|
| GET /api/healthz | Public |
| POST /api/auth/login | Public |
| POST /api/auth/logout | Public |
| GET /api/auth/me | Public (returns 401 if not logged in) |
| All other /api/* routes | Requires valid session (401 if not logged in) |
| /api/users (all methods) | Requires admin role (403 if staff) |

---

## RECEIPT SYSTEM

- Receipt modal opens after completing a checkout
- Content:
  - Shop name: JEGZ MOBILE REPAIR
  - Transaction # (padded)
  - Customer name, device/unit model
  - Technician name
  - Datetime
  - Itemized list: qty × name = total per item
  - Subtotal
  - Discount (if applied)
  - Total
  - Payment method
  - Cash received (if cash)
  - Change (if cash: cashReceived − total)
- Print button triggers `window.print()` for physical receipt

---

## SECURITY FEATURES

- Passwords hashed with bcrypt (10 salt rounds)
- Sessions stored in PostgreSQL (not in-memory, survive restarts)
- Session secret from environment variable `SESSION_SECRET`
- Inactive user accounts cannot log in (403 returned)
- Last admin account cannot be deleted (protected at API level)
- Admin cannot delete or deactivate their own account
- All protected routes check session on every request

---

## ENVIRONMENT VARIABLES REQUIRED

| Variable | Required | Description |
|---|---|---|
| DATABASE_URL | Yes | PostgreSQL connection string |
| SESSION_SECRET | Yes | Secret key for session encryption |
| PORT | Yes | Port for API server (auto-set by workflow) |

---

*End of JEGZ Mobile Repair POS System Documentation*
