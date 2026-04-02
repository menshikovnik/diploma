import type { UserDto } from '../types/api';

interface UserCardProps {
  user: UserDto;
  deleting: boolean;
  onDelete: () => void;
}

const rows = (user: UserDto) => [
  { label: 'ID', value: user.id.toString() },
  { label: 'Имя', value: user.firstName },
  { label: 'Фамилия', value: user.lastName },
  { label: 'Email', value: user.email },
];

export function UserCard({ user, deleting, onDelete }: UserCardProps) {
  return (
    <section className="rounded-[24px] border border-emerald-200 bg-[linear-gradient(180deg,#ecfdf5_0%,#ffffff_100%)] p-5 shadow-panel xl:p-6">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-emerald-700">
            Результат
          </p>
          <h2 className="mt-1 text-xl font-semibold text-ink">Пользователь найден</h2>
        </div>
        <div className="rounded-full bg-emerald-600 px-3 py-1 text-xs font-semibold text-white">
          Совпадение подтверждено
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {rows(user).map((row) => (
          <div key={row.label} className="rounded-2xl border border-emerald-100 bg-white/90 px-4 py-3">
            <div className="text-xs uppercase tracking-[0.18em] text-slate-500">{row.label}</div>
            <div className="mt-1 break-words text-sm font-semibold text-ink">{row.value}</div>
          </div>
        ))}
      </div>

      <div className="mt-5">
        <button
          type="button"
          onClick={onDelete}
          disabled={deleting}
          className="min-h-11 w-full rounded-2xl border border-rose-200 bg-rose-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:border-rose-100 disabled:bg-rose-300 sm:w-auto"
        >
          {deleting ? 'Удаление...' : 'Удалить себя из базы'}
        </button>
      </div>
    </section>
  );
}
