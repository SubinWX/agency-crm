/**
 * Guided tour content per portal. `el` is a [data-tour] marker; steps whose
 * element isn't on screen (hidden by permissions, or the sidebar on a phone)
 * are skipped automatically. A step without `el` is a centred message.
 */
export type TourPortal = "ADMIN" | "AGENT" | "WORKER" | "CUSTOMER";
export interface TourStep {
  el?: string;
  title: string;
  body: string;
}

export const TOURS: Record<TourPortal, TourStep[]> = {
  ADMIN: [
    { title: "Welcome 👋", body: "This 1-minute tour shows where everything is. You can restart it any time from your profile menu or Help & tutorials." },
    { el: "nav-dashboard", title: "Dashboard", body: "Your day at a glance: today's works, works waiting for approval, money in and out, low stock and open support requests." },
    { el: "nav-calendar", title: "Calendar", body: "How many slots are booked each day. Capacity is shared by all branches — when a day is full, nobody can add more works to it. You can also close dates for holidays here." },
    { el: "nav-works", title: "Works — the daily flow", body: "1) Add a work (or an agent adds it) → 2) assign workers → 3) the worker uploads completion photos → 4) you approve or send it back. Everything is recorded in the work's activity." },
    { el: "nav-customers", title: "Customers", body: "Every customer with their works. From a customer's page you can also give them a login to the customer portal." },
    { el: "nav-agents-brokers", title: "Agents / Brokers", body: "The people who bring in works. Add them with their branch, location and commission %." },
    { el: "nav-workers", title: "Workers", body: "The people who do the works. A worker can only be assigned in the branches you tick for them." },
    { el: "nav-finance", title: "Finance", body: "Invoices (with GST and a PAID stamp on the PDF), payments, expenses, agent & worker commission and salaries." },
    { el: "nav-inventory", title: "Inventory", body: "Products and raw materials, stock per branch, transfers and the full stock history. Stock can never go below zero." },
    { el: "nav-insights", title: "Insights", body: "Graphs (revenue, costs, profit, works per day…) and 14 reports you can download as Excel or PDF." },
    { el: "nav-support", title: "Support", body: "Complaints and requests from staff, agents, workers and customers. Assign, reply, add internal notes, resolve and close." },
    { el: "nav-administration", title: "Administration", body: "Users & logins, roles and permissions, branches, WhatsApp / SMS / Email setup, settings (capacity, GST, invoice) and the audit log." },
    { el: "search", title: "Search everything", body: "Type a name, phone number, WRK-…, INV-… or a payment reference to jump straight to it." },
    { el: "alerts", title: "Alerts", body: "New works, completions waiting for you, payments received and support updates appear here." },
    { el: "profile", title: "Your profile", body: "Change your name, password or picture, open Help & tutorials, restart this tour, or log out." },
    { title: "You're all set ✅", body: "Step-by-step guides for every task are in Help & tutorials (bottom of the menu)." },
  ],
  AGENT: [
    { title: "Welcome 👋", body: "A quick tour of the agent app. Restart it any time from your profile menu." },
    { el: "nav-my-works", title: "My works", body: "Every work you added, with its status — from Submitted to Completed." },
    { el: "nav-new-work", title: "Add a new work", body: "Pick or add the customer → fill in the details and photos → choose a date on the calendar → Submit. Full dates can't be chosen; the app suggests the next free dates." },
    { el: "nav-availability", title: "Availability", body: "See how many slots are left each day before you promise a date to a customer." },
    { el: "nav-my-commission", title: "My commission", body: "Your commission for each approved work, and whether it's pending or paid." },
    { el: "nav-my-score", title: "My score", body: "Your score and status (Gold, Silver, Bronze) based on completed, on-time and cancelled works." },
    { el: "nav-support", title: "Support", body: "Something wrong? Raise a request and follow the replies here." },
    { el: "alerts", title: "Alerts", body: "Date changes, approvals and commission updates appear here." },
    { el: "profile", title: "Your profile", body: "Change your password or picture, see Help & tutorials, or log out." },
  ],
  WORKER: [
    { title: "Welcome 👋", body: "A quick tour of the worker app. Restart it any time from your profile menu." },
    { el: "nav-my-works", title: "My works", body: "Today's jobs are shown first. Use the arrows or the date box to see other days." },
    { title: "Completing a job", body: "Open a job → press Start work → when finished, take completion photos, add a short note and press Mark completed. The office will approve it or ask for a correction." },
    { el: "alerts", title: "Alerts", body: "New assignments, date changes and correction requests appear here." },
    { el: "nav-support", title: "Support", body: "Problem with a job, equipment or the app? Raise a request here." },
    { el: "profile", title: "Your profile", body: "Change your password or picture, see Help & tutorials, or log out." },
  ],
  CUSTOMER: [
    { title: "Welcome 👋", body: "Here you can follow your works, invoices and payments." },
    { el: "portal-works", title: "My works", body: "Each work with its date and status. Open one to see details and completion photos." },
    { el: "portal-invoices", title: "Invoices", body: "Download any invoice as a PDF. Paid invoices carry a PAID stamp." },
    { el: "nav-help-support", title: "Help & support", body: "Questions or a problem with a work? Raise a request and we'll reply here." },
    { el: "profile", title: "Your profile", body: "Change your password or picture, or log out." },
  ],
};
