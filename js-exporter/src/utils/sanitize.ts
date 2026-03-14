export const sanitizeName = (name: string | null | undefined): string => {
  let n = String(name || "file")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[/\\?%*:|"<>]/g, "_");
  n = n.replace(/\s+/g, " ").trim();
  if (!n) n = "file";
  if (n.length > 180) n = n.slice(0, 180);
  return n;
};
