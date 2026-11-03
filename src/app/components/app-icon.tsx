import type { ReactNode, SVGProps } from "react";

export type IconName =
  | "arrow-left" | "chevron-down" | "chevron-left" | "chevron-right"
  | "crop" | "download" | "filter" | "folder" | "grid" | "home"
  | "image" | "layers" | "more" | "plus" | "redo" | "save"
  | "search" | "settings" | "sparkles" | "text" | "trash" | "undo" | "upload" | "video";

type IconProps = SVGProps<SVGSVGElement> & { name: IconName };

const paths: Record<IconName, ReactNode> = {
  "arrow-left": <path d="m15 18-6-6 6-6" />,
  "chevron-down": <path d="m7 10 5 5 5-5" />,
  "chevron-left": <path d="m15 18-6-6 6-6" />,
  "chevron-right": <path d="m9 18 6-6-6-6" />,
  crop: <><path d="M6 2v14a2 2 0 0 0 2 2h14" /><path d="M18 22V8a2 2 0 0 0-2-2H2" /></>,
  download: <><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" /></>,
  filter: <path d="M4 5h16l-6 7v5l-4 2v-7Z" />,
  folder: <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2h8.5A1.5 1.5 0 0 1 21 8.5v9A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5Z" />,
  grid: <><rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><rect x="14" y="14" width="6" height="6" rx="1" /></>,
  home: <><path d="m3 11 9-8 9 8" /><path d="M5 10v10h14V10" /><path d="M9 20v-6h6v6" /></>,
  image: <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="8.5" cy="9" r="1.5" /><path d="m21 15-5-5L5 20" /></>,
  layers: <><path d="m12 3 9 5-9 5-9-5Z" /><path d="m3 12 9 5 9-5" /><path d="m3 16 9 5 9-5" /></>,
  more: <><circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" /></>,
  plus: <><path d="M12 5v14" /><path d="M5 12h14" /></>,
  redo: <><path d="m17 3 4 4-4 4" /><path d="M3 17a7 7 0 0 1 7-10h11" /></>,
  save: <><path d="M4 4h13l3 3v13H4Z" /><path d="M8 4v6h8V4" /><path d="M8 20v-6h8v6" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19 15.5a2 2 0 0 0 .4 2.2l.1.1-2.8 2.8-.1-.1a2 2 0 0 0-2.2-.4 2 2 0 0 0-1.2 1.8V22h-4v-.1A2 2 0 0 0 8 20.1a2 2 0 0 0-2.2.4l-.1.1-2.8-2.8.1-.1a2 2 0 0 0 .4-2.2A2 2 0 0 0 1.6 14H1v-4h.6a2 2 0 0 0 1.8-1.2A2 2 0 0 0 3 6.6l-.1-.1 2.8-2.8.1.1A2 2 0 0 0 8 4.2 2 2 0 0 0 9.2 2.4V2h4v.4A2 2 0 0 0 14.4 4a2 2 0 0 0 2.2-.4l.1-.1 2.8 2.8-.1.1a2 2 0 0 0-.4 2.2 2 2 0 0 0 1.8 1.2h.2v4h-.2a2 2 0 0 0-1.8 1.7Z" /></>,
  sparkles: <><path d="m12 3 1.1 3.1L16 7.5l-2.9 1.4L12 12l-1.1-3.1L8 7.5l2.9-1.4Z" /><path d="m18.5 14 .7 2 1.8.8-1.8.9-.7 2-.7-2-1.8-.9 1.8-.8Z" /></>,
  text: <><path d="M5 5h14" /><path d="M12 5v14" /><path d="M8 19h8" /></>,
  trash: <><path d="M4 7h16" /><path d="M9 7V4h6v3" /><path d="m6 7 1 14h10l1-14" /><path d="M10 11v6M14 11v6" /></>,
  undo: <><path d="m7 3-4 4 4 4" /><path d="M21 17a7 7 0 0 0-7-10H3" /></>,
  upload: <><path d="M12 21V9" /><path d="m7 14 5-5 5 5" /><path d="M5 3h14" /></>,
  video: <><rect x="3" y="6" width="13" height="12" rx="2" /><path d="m16 10 5-3v10l-5-3Z" /></>,
};

export function Icon({ name, className, ...props }: IconProps) {
  return (
    <svg aria-hidden="true" className={className} fill="none" height="20" viewBox="0 0 24 24" width="20" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" {...props}>
      {paths[name]}
    </svg>
  );
}
