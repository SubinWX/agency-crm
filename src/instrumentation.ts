/** Runs once when the server starts: load the saved time zone before any request. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { loadBusinessTz } = await import("@/server/modules/settings/service");
    await loadBusinessTz();
  }
}
