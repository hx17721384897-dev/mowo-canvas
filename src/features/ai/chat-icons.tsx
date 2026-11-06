export function ChatIcon({ name }: { name: "logo" | "new" | "history" | "expand" | "restore" | "collapse" | "settings" | "rename" }) {
  const paths = {
    logo: <><path d="M5 17V7l7 7 7-7v10" /><path d="m9 7 3 3 3-3" /></>,
    new: <><path d="M20 11a8 8 0 0 1-8 8H5l-3 2V11a8 8 0 0 1 8-8h3" /><path d="M18 2v8M14 6h8" /></>,
    history: <><path d="m7 10 5 5 5-5" /></>,
    expand: <><path d="M14 3h7v7M10 21H3v-7M21 3l-7 7M3 21l7-7" /></>,
    restore: <><path d="M20 4l-6 6M14 4v6h6M4 20l6-6M4 14h6v6" /></>,
    collapse: <><rect x="3" y="4" width="18" height="16" rx="2.5" /><path d="M15 4v16" /></>,
    settings: <><path d="M4 7h16M4 17h16" /><circle cx="9" cy="7" r="2" fill="white" /><circle cx="15" cy="17" r="2" fill="white" /></>,
    rename: <><path d="m15 4 5 5M4 20l1-5L16 4a2 2 0 0 1 4 4L9 19Z" /></>,
  };
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
