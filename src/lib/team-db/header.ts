// Set by the proxy from the page address (/w/<shortId>/…) on every request, so
// server actions know their workspace. Any value sent by the browser is dropped.
export const WORKSPACE_HEADER = "x-ek-workspace";
