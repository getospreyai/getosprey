/** Telegram connect/connected card — shared between /dashboard and /settings. */
export default function TelegramConnectCard({
  userId,
  telegramChatId,
}: {
  userId: string;
  telegramChatId: number | null;
}) {
  if (telegramChatId != null) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-6 text-center backdrop-blur-md">
        <p className="text-sm font-medium text-white">Telegram connected ✓</p>
        <p className="mt-1 text-xs text-white/50">
          Osprey will message this chat when a deal clears your bar.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-6 text-center backdrop-blur-md">
      <p className="text-sm font-medium text-white">Connect Telegram</p>
      <p className="mt-2 text-sm text-white/60">
        Link your Telegram account and Osprey will message you when a deal clears
        your cash-flow bar.
      </p>
      <a
        href={`https://t.me/OspreyAlphaBot?start=${userId}`}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-4 inline-block rounded-full bg-violet-500 px-5 py-2 text-sm font-medium text-white transition hover:bg-violet-400"
      >
        Open this in Telegram
      </a>
    </div>
  );
}
