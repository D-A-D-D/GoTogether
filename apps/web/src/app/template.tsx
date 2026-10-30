// A template, unlike a layout, mounts afresh on every navigation: that is what lets each screen
// arrive with a short rise and fade (see .page-enter in globals.css) instead of snapping in.
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="page-enter flex flex-1 flex-col">{children}</div>;
}
