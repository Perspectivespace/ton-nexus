import type { proof as ru } from "../ru/proof";

export const proof: Record<keyof typeof ru, string> = {
  "proof.needImage": "Needs a PNG, JPG or WebP image.",
  "proof.empty": "Empty file.",
  "proof.tooBig": "File is over 5 MB — compress the screenshot.",
  "proof.mb": "{v} MB",
  "proof.kb": "{n} KB",
  "proof.title": "Completion screenshot",
  "proof.attached": "attached",
  "proof.required": "required",
  "proof.optional": "optional",
  "proof.remove": "Remove",
  "proof.pick": "Choose screenshot",
  "proof.formats": "PNG, JPG or WebP · up to 5 MB",
  "proof.privacy": "Only the reviewer sees it. Location and device data (EXIF) are stripped; the file is deleted within 24 h after review.",
  "proof.screenshot": "Screenshot",
  "proof.expired": "The screenshot was already deleted after the retention period.",
  "proof.alt": "Performer's screenshot",
  "proof.loading": "Loading screenshot…",
  "proof.unavailable": "Screenshot unavailable",
  "proof.deleteNote": "Deleted 24 h after review.",
};
