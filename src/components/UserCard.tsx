import type { UserDto } from '../types/api';

interface UserCardProps {
  user: UserDto;
  score: number;
  deleting: boolean;
  onDelete: () => void;
}

const rows = (user: UserDto, score: number) => [
  { label: 'ID', value: user.id.toString() },
  { label: 'Имя', value: user.firstName },
  { label: 'Фамилия', value: user.lastName },
  { label: 'Email', value: user.email },
  { label: 'Оценка совпадения', value: score.toFixed(2) },
];

export function UserCard({ user, score, deleting, onDelete }: UserCardProps) {
  return (
    <section className="rounded-[28px] border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-5 shadow-panel xl:p-6">
      <div className="mb-5 flex items-start justify-between gap-3">
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
        {rows(user, score).map((row) => (
          <div key={row.label} className="rounded-2xl border border-emerald-100 bg-white/90 px-4 py-3">
            <div className="text-xs uppercase tracking-[0.18em] text-slate-500">{row.label}</div>
            <div className="mt-1 text-sm font-semibold text-ink">{row.value}</div>
          </div>
        ))}
      </div>

      <div className="mt-5 flex justify-end">
        <button
          type="button"
          onClick={onDelete}
          disabled={deleting}
          className="min-h-11 rounded-2xl border border-rose-200 bg-rose-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:border-rose-100 disabled:bg-rose-300"
        >
          {deleting ? 'Удаление...' : 'Удалить себя из базы'}
        </button>
      </div>
    </section>
  );
}
