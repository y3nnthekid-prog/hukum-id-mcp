export const MK_NUMBER = /^\d{1,4}\/PUU-[IVXL]{1,8}\/\d{4}$/i;
export function isMkBpkUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.origin !== "https://peraturan.bpk.go.id" || url.username || url.password || url.search || url.hash) return false;
    const match = url.pathname.match(/^\/DownloadUjiMateri\/(\d{1,10})\/([^/]+)$/);
    if (!match) return false;
    return /^[\p{L}\p{N}_. ()-]{1,200}\.pdf$/iu.test(decodeURIComponent(match[2]!));
  } catch { return false; }
}
