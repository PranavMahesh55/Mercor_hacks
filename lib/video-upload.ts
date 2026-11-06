export function validUploadUrl(value: string) {
  try {
    const u = new URL(value);
    return (
      u.protocol === "https:" &&
      u.hostname === "generativelanguage.googleapis.com" &&
      u.pathname.startsWith("/upload/") &&
      !u.username &&
      !u.password
    );
  } catch {
    return false;
  }
}
export function validFileName(value: string) {
  return /^files\/[a-zA-Z0-9_-]+$/.test(value);
}
export function validFileUri(value: string) {
  try {
    const u = new URL(value);
    return (
      u.protocol === "https:" &&
      u.hostname === "generativelanguage.googleapis.com" &&
      /^\/v1beta\/files\/[a-zA-Z0-9_-]+$/.test(u.pathname) &&
      !u.search &&
      !u.hash
    );
  } catch {
    return false;
  }
}
