import { WatchPage } from "@/components/watch-page";
import { WATCH_UI_ENABLED } from "@/lib/voice/watch-channel";

export const metadata = {
  title: WATCH_UI_ENABLED ? "Watch · Lexi" : "Lexi",
};

export default function WatchRoute() {
  if (WATCH_UI_ENABLED) return <WatchPage />;
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center bg-background font-sans">
      <p className="text-sm font-medium uppercase tracking-[0.22em]">Lexi</p>
    </div>
  );
}
