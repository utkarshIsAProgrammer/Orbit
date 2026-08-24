// Static registration script — served at /registerSW.js for browsers still
// running a cached index.html that references the old plugin-generated file.
// Registers the service worker with `updateViaCache: "none"` so the browser
// revalidates /sw.js on EVERY load instead of serving a stale copy for up to
// 24h. Combined with the SW's skipWaiting/clientsClaim, a deploy's new code
// reaches these users on their very next page load.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .catch(() => {
        /* service workers unsupported or blocked — app works without it */
      });
  });
}
